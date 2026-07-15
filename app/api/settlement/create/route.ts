import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { addCorsHeaders } from '@/lib/cors'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { calculatePayoutCharge } from '@/lib/scheme/scheme.service'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'

// Generate idempotency key using crypto
function generateIdempotencyKey(prefix: string): string {
  const timestamp = Date.now()
  const random = crypto.randomUUID ? crypto.randomUUID() : `${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`
  return `${prefix}_${timestamp}_${random}`
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Legacy fallback: settlement_charge_slabs table
async function calculateLegacySettlementCharge(supabase: SupabaseClient, amount: number): Promise<number> {
  const { data: slabs, error } = await supabase
    .from('settlement_charge_slabs')
    .select('charge')
    .eq('is_active', true)
    .lte('min_amount', amount)
    .gte('max_amount', amount)
    .order('charge', { ascending: true })
    .limit(1)
    .single()

  if (error || !slabs) {
    if (amount <= 49999) return 20
    if (amount <= 99999) return 30
    if (amount <= 149999) return 50
    return 70
  }

  return parseFloat(slabs.charge.toString())
}

interface SettlementChargeResult {
  charge: number
  scheme_id: string | null
  scheme_name: string | null
  resolved_via: string | null
  commission_split: {
    distributor_commission: number
    md_commission: number
    company_earning: number
  } | null
}

async function calculateSettlementCharge(
  supabase: SupabaseClient,
  userId: string,
  userRole: string,
  amount: number
): Promise<SettlementChargeResult> {
  // Try scheme engine first
  try {
    let distributorId: string | undefined
    let mdId: string | undefined

    if (userRole === 'retailer') {
      const { data: retailer } = await supabase
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', userId)
        .maybeSingle()
      distributorId = retailer?.distributor_id || undefined
      mdId = retailer?.master_distributor_id || undefined
    } else if (userRole === 'distributor') {
      const { data: dist } = await supabase
        .from('distributors')
        .select('master_distributor_id')
        .eq('partner_id', userId)
        .maybeSingle()
      mdId = dist?.master_distributor_id || undefined
    }

    const breakdown = await calculatePayoutCharge(userId, userRole, amount, 'IMPS', distributorId, mdId)

    if (breakdown && breakdown.retailer_charge > 0) {
      console.log(`[Settlement] Scheme charge: ₹${breakdown.retailer_charge} from "${breakdown.scheme_name}" via ${breakdown.resolved_via}`)
      return {
        charge: breakdown.retailer_charge,
        scheme_id: breakdown.scheme_id,
        scheme_name: breakdown.scheme_name,
        resolved_via: breakdown.resolved_via,
        commission_split: {
          distributor_commission: breakdown.distributor_commission,
          md_commission: breakdown.md_commission,
          company_earning: breakdown.company_earning,
        },
      }
    }
  } catch (err) {
    console.warn('[Settlement] Scheme engine failed, falling back to legacy:', err)
  }

  // Fallback to legacy settlement_charge_slabs
  const legacyCharge = await calculateLegacySettlementCharge(supabase, amount)
  console.log(`[Settlement] Legacy charge: ₹${legacyCharge}`)
  return {
    charge: legacyCharge,
    scheme_id: null,
    scheme_name: null,
    resolved_via: 'legacy_slabs',
    commission_split: null,
  }
}

// Check settlement limits
async function checkSettlementLimits(
  supabase: SupabaseClient,
  user_id: string,
  user_role: string,
  amount: number
): Promise<{ allowed: boolean; reason?: string }> {
  // First check retailer-specific settlement limit tier (per-transaction limit)
  if (user_role === 'retailer') {
    const { data: retailer } = await supabase
      .from('retailers')
      .select('settlement_limit_tier')
      .eq('partner_id', user_id)
      .single()

    if (retailer?.settlement_limit_tier) {
      const limitTier = parseFloat(retailer.settlement_limit_tier.toString())
      if (amount > limitTier) {
        return {
          allowed: false,
          reason: `Settlement amount ₹${amount} exceeds your limit of ₹${limitTier.toLocaleString('en-IN')}. Please contact admin to increase your limit.`
        }
      }
    }
  }

  // Get daily settlement limit
  const { data: limit } = await supabase
    .from('user_limits')
    .select('limit_amount, is_enabled, is_overridden')
    .eq('user_id', user_id)
    .eq('user_role', user_role)
    .eq('wallet_type', 'primary')
    .eq('limit_type', 'daily_settlement')
    .single()

  if (limit && limit.is_enabled && !limit.is_overridden) {
    // Check today's settlement amount
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStart = today.toISOString()

    const { data: todaySettlements } = await supabase
      .from('settlements')
      .select('amount')
      .eq('user_id', user_id)
      .eq('status', 'success')
      .gte('created_at', todayStart)

    const todayTotal = (todaySettlements || []).reduce((sum, s) => sum + parseFloat(s.amount.toString()), 0)

    if (todayTotal + amount > parseFloat(limit.limit_amount.toString())) {
      return {
        allowed: false,
        reason: `Daily settlement limit exceeded. Limit: ₹${limit.limit_amount}, Used: ₹${todayTotal}, Requested: ₹${amount}`
      }
    }
  }

  return { allowed: true }
}

export async function POST(request: NextRequest) {
  const rl = rateLimit(request, RATE_LIMITS.transfer)
  if (rl.limited) return rl.response!

  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    // Get current user with fallback
    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[Settlement Create] Auth:', method, '|', user?.email || 'none')
    
    if (!user || !user.partner_id) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    // Only retailers, distributors, and master distributors can create settlements
    if (!['retailer', 'distributor', 'master_distributor'].includes(user.role)) {
      return NextResponse.json(
        { error: 'Forbidden: Invalid user role' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      amount,
      bank_account_number,
      bank_ifsc,
      bank_account_name,
      settlement_mode = 'instant'
    } = body

    // Validation
    if (!amount || !bank_account_number || !bank_ifsc || !bank_account_name) {
      return NextResponse.json(
        { error: 'amount, bank_account_number, bank_ifsc, and bank_account_name are required' },
        { status: 400 }
      )
    }

    if (!['instant', 't+1'].includes(settlement_mode)) {
      return NextResponse.json(
        { error: 'Invalid settlement_mode' },
        { status: 400 }
      )
    }

    const amountDecimal = parseFloat(amount)
    if (!Number.isFinite(amountDecimal) || amountDecimal <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount' },
        { status: 400 }
      )
    }

    // Check wallet balance
    const { data: walletBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user.partner_id,
      p_wallet_type: 'primary'
    })

    // Check if settlement is held
    const { data: wallet } = await supabase
      .from('wallets')
      .select('is_settlement_held, is_frozen')
      .eq('user_id', user.partner_id)
      .eq('wallet_type', 'primary')
      .single()

    if (wallet?.is_settlement_held) {
      return NextResponse.json(
        { error: 'Settlement is held. Please contact admin.' },
        { status: 403 }
      )
    }

    if (wallet?.is_frozen) {
      return NextResponse.json(
        { error: 'Wallet is frozen. Cannot create settlement.' },
        { status: 403 }
      )
    }

    // Calculate charge via scheme engine (with legacy fallback)
    const chargeResult = await calculateSettlementCharge(supabase, user.partner_id, user.role, amountDecimal)
    const charge = chargeResult.charge
    const netAmount = amountDecimal - charge

    // Check if sufficient balance (including charge)
    if ((walletBalance || 0) < amountDecimal) {
      return NextResponse.json(
        {
          error: 'Insufficient balance',
          available_balance: walletBalance || 0,
          required_amount: amountDecimal,
          charge: charge,
          net_amount: netAmount
        },
        { status: 400 }
      )
    }

    // Check limits
    const limitCheck = await checkSettlementLimits(supabase, user.partner_id, user.role, amountDecimal)
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: limitCheck.reason },
        { status: 403 }
      )
    }

    // FIX: Prevent duplicate pending settlements (race condition protection)
    // Check if there's already a pending/processing settlement for this user
    const { data: existingSettlement } = await supabase
      .from('settlements')
      .select('id, status, amount, created_at')
      .eq('user_id', user.partner_id)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingSettlement) {
      return NextResponse.json(
        { 
          error: 'A settlement is already in progress',
          existing_settlement_id: existingSettlement.id,
          existing_amount: existingSettlement.amount,
          existing_status: existingSettlement.status,
          message: 'Please wait for the current settlement to complete or be rejected before creating a new one.'
        },
        { status: 409 } // Conflict
      )
    }

    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey(`SETTLE_${user.partner_id}`)

    // Create settlement record
    const { data: settlement, error: settlementError } = await supabase
      .from('settlements')
      .insert({
        user_id: user.partner_id,
        user_role: user.role,
        settlement_mode: settlement_mode,
        amount: amountDecimal,
        charge: charge,
        net_amount: netAmount,
        bank_account_number: bank_account_number,
        bank_ifsc: bank_ifsc,
        bank_account_name: bank_account_name,
        status: 'pending',
        idempotency_key: idempotencyKey,
        ...(chargeResult.scheme_id ? {
          scheme_id: chargeResult.scheme_id,
          charge_breakdown: {
            scheme_name: chargeResult.scheme_name,
            resolved_via: chargeResult.resolved_via,
            ...chargeResult.commission_split,
          },
        } : {}),
      })
      .select()
      .single()

    if (settlementError || !settlement) {
      console.error('Error creating settlement:', settlementError)
      return NextResponse.json(
        { error: 'Failed to create settlement' },
        { status: 500 }
      )
    }

    // Debit wallet (including charge) - always debit for both instant and T+1
    const ledgerStatus = settlement_mode === 'instant' ? 'pending' : 'hold'
    const { data: ledgerId, error: ledgerError } = await supabase.rpc('add_ledger_entry', {
      p_user_id: user.partner_id,
      p_user_role: user.role,
      p_wallet_type: 'primary',
      p_fund_category: 'settlement',
      p_service_type: 'settlement',
      p_tx_type: 'PAYOUT',
      p_credit: 0,
      p_debit: amountDecimal, // Total amount including charge
      p_reference_id: idempotencyKey,
      p_transaction_id: settlement.id,
      p_status: ledgerStatus, // Hold for T+1, pending for instant (waiting admin release)
      p_remarks: `Settlement request (${settlement_mode}) - Amount: ₹${amountDecimal}, Charge: ₹${charge}, Net: ₹${netAmount}`
    })

    if (ledgerError) {
      console.error('Error debiting wallet:', ledgerError)
      // Update settlement status to failed
      await supabase
        .from('settlements')
        .update({ status: 'failed', failure_reason: 'Failed to debit wallet' })
        .eq('id', settlement.id)

      return NextResponse.json(
        { error: 'Failed to debit wallet' },
        { status: 500 }
      )
    }

    // Update settlement with ledger entry
    await supabase
      .from('settlements')
      .update({ ledger_entry_id: ledgerId })
      .eq('id', settlement.id)

    // Handle instant vs T+1 settlement
    if (settlement_mode === 'instant') {
      // For instant settlement, mark as processing - admin will release via /api/admin/settlement/release
      await supabase
        .from('settlements')
        .update({
          status: 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', settlement.id)

      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, user, {
        activity_type: 'settlement_create',
        activity_category: 'settlement',
        activity_description: `Settlement request of ₹${amountDecimal} via ${settlement_mode}`,
        reference_id: settlement.id,
        reference_table: 'settlements',
        metadata: { amount: amountDecimal, settlement_mode },
      }).catch(() => {})

      return NextResponse.json({
        success: true,
        settlement_id: settlement.id,
        amount: amountDecimal,
        charge: charge,
        net_amount: netAmount,
        status: 'processing',
        message: 'Settlement created. Waiting for admin approval and release.'
      })
    } else {
      // For T+1, mark as pending and hold the ledger entry
      await supabase
        .from('settlements')
        .update({
          status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('id', settlement.id)

      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, user, {
        activity_type: 'settlement_create',
        activity_category: 'settlement',
        activity_description: `Settlement request of ₹${amountDecimal} via ${settlement_mode}`,
        reference_id: settlement.id,
        reference_table: 'settlements',
        metadata: { amount: amountDecimal, settlement_mode },
      }).catch(() => {})

      return NextResponse.json({
        success: true,
        settlement_id: settlement.id,
        amount: amountDecimal,
        charge: charge,
        net_amount: netAmount,
        status: 'pending',
        message: 'T+1 settlement created. Will be processed tomorrow after admin approval.'
      })
    }
  } catch (error: any) {
    console.error('Error creating settlement:', error)
    return NextResponse.json(
      { error: 'Failed to create settlement' },
      { status: 500 }
    )
  }
}

