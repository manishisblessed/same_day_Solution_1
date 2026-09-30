import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import {
  reserveIdempotencyKey,
  finalizeIdempotencyKey,
  getIdempotencyKeyFromHeaders,
} from '@/lib/security/idempotency'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const rl = rateLimit(request, RATE_LIMITS.transfer)
  if (rl.limited) return rl.response!

  const idemKey = getIdempotencyKeyFromHeaders(request.headers)
  const IDEM_SCOPE = 'md_wallet_transfer'

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user: md, method } = await getCurrentUserWithFallback(request)
    console.log('[MD Wallet Transfer] Auth:', method, '|', md?.email || 'none')

    if (!md) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (md.role !== 'master_distributor') {
      return NextResponse.json({ error: 'Unauthorized: Master distributor access required' }, { status: 403 })
    }

    const body = await request.json()
    const {
      target_id,
      target_role, // 'distributor' or 'retailer'
      action, // 'push' or 'pull'
      amount,
      fund_category, // 'cash' or 'online'
      remarks,
      tpin,
    } = body

    if (!target_id || !target_role || !action || !amount || !fund_category) {
      return NextResponse.json(
        { error: 'target_id, target_role, action, amount, and fund_category are required' },
        { status: 400 }
      )
    }

    if (!['distributor', 'retailer'].includes(target_role)) {
      return NextResponse.json({ error: 'target_role must be "distributor" or "retailer"' }, { status: 400 })
    }

    if (!['push', 'pull'].includes(action)) {
      return NextResponse.json({ error: 'action must be "push" or "pull"' }, { status: 400 })
    }

    if (!['cash', 'online'].includes(fund_category)) {
      return NextResponse.json({ error: 'fund_category must be "cash" or "online"' }, { status: 400 })
    }

    const amountDecimal = parseFloat(amount)
    if (!Number.isFinite(amountDecimal) || amountDecimal <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    // Verify the target belongs to this master distributor
    const targetTable = target_role === 'distributor' ? 'distributors' : 'retailers'
    const { data: target, error: targetError } = await supabase
      .from(targetTable)
      .select('*')
      .eq('partner_id', target_id)
      .eq('master_distributor_id', md.partner_id)
      .single()

    if (targetError || !target) {
      return NextResponse.json(
        { error: `${target_role === 'distributor' ? 'Distributor' : 'Retailer'} not found or does not belong to you` },
        { status: 404 }
      )
    }

    // Idempotency: dedup repeated submits of the same push/pull
    if (idemKey) {
      const reservation = await reserveIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, userId: md.partner_id })
      if (!reservation.fresh) {
        if (reservation.status === 'completed' && reservation.cachedResponse) {
          return NextResponse.json(reservation.cachedResponse)
        }
        return NextResponse.json(
          { error: 'A transfer with this idempotency key is already being processed.', code: 'IDEMPOTENT_REPLAY' },
          { status: 409 }
        )
      }
    }

    if (action === 'push') {
      // Push funds: Debit master distributor, Credit target (DT/RT)
      const { data: mdBalance } = await supabase.rpc('get_wallet_balance_v2', {
        p_user_id: md.partner_id,
        p_wallet_type: 'primary',
      })

      if ((mdBalance || 0) < amountDecimal) {
        return NextResponse.json(
          { error: 'Insufficient balance', available_balance: mdBalance || 0, requested_amount: amountDecimal },
          { status: 400 }
        )
      }

      const ref = `MD_PUSH_${Date.now()}`

      const { error: debitError } = await supabase.rpc('debit_wallet_v2', {
        p_user_id: md.partner_id,
        p_user_role: 'master_distributor',
        p_wallet_type: 'primary',
        p_fund_category: fund_category,
        p_service_type: 'admin',
        p_amount: amountDecimal,
        p_debit: amountDecimal,
        p_transaction_id: null,
        p_reference_id: ref,
        p_remarks: remarks || `Fund push to ${target_role} ${target.name} (${target.partner_id})`,
      })

      if (debitError) {
        console.error('Error debiting MD wallet:', debitError)
        if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' })
        return NextResponse.json({ error: 'Failed to debit master distributor wallet' }, { status: 500 })
      }

      const { error: creditError } = await supabase.rpc('credit_wallet_v2', {
        p_user_id: target_id,
        p_user_role: target_role,
        p_wallet_type: 'primary',
        p_fund_category: fund_category,
        p_service_type: 'admin',
        p_amount: amountDecimal,
        p_credit: amountDecimal,
        p_transaction_id: null,
        p_reference_id: ref,
        p_remarks: remarks || `Fund received from master distributor ${md.name} (${md.partner_id})`,
      })

      if (creditError) {
        console.error('Error crediting target wallet:', creditError)
        // Reverse MD debit
        await supabase.rpc('credit_wallet_v2', {
          p_user_id: md.partner_id,
          p_user_role: 'master_distributor',
          p_wallet_type: 'primary',
          p_fund_category: fund_category,
          p_service_type: 'admin',
          p_amount: amountDecimal,
          p_credit: amountDecimal,
          p_transaction_id: null,
          p_reference_id: `REVERSE_${Date.now()}`,
          p_remarks: 'Reversal: Failed to credit target wallet',
        })
        if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' })
        return NextResponse.json({ error: 'Failed to credit target wallet' }, { status: 500 })
      }

      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, md, {
        activity_type: 'md_wallet_transfer',
        activity_category: 'master_dist',
        activity_description: `Master distributor pushed ₹${amountDecimal} to ${target_role} ${target_id}`,
        reference_table: 'wallet_ledger',
      }).catch(() => {})

      const pushPayload = {
        success: true,
        message: `Funds pushed successfully to ${target_role}`,
        amount: amountDecimal,
        fund_category,
        md_balance: (mdBalance || 0) - amountDecimal,
      }
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'completed', response: pushPayload })
      return NextResponse.json(pushPayload)
    } else {
      // Pull funds: Debit target (DT/RT), Credit master distributor
      // Require the target's TPIN to authorize debit from their wallet
      if (!tpin || tpin.length !== 4) {
        return NextResponse.json({ error: "Target's 4-digit TPIN is required for pull transfers" }, { status: 400 })
      }

      const tpinFn = target_role === 'distributor' ? 'verify_distributor_tpin' : 'verify_retailer_tpin'
      const tpinParam = target_role === 'distributor' ? 'p_distributor_id' : 'p_retailer_id'
      const { data: tpinResult, error: tpinError } = await supabase.rpc(tpinFn, {
        [tpinParam]: target_id,
        p_tpin: tpin,
      } as any)
      if (tpinError || !tpinResult?.success) {
        const msg = tpinResult?.error || tpinError?.message || 'TPIN verification failed'
        if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' })
        return NextResponse.json({ error: msg }, { status: 403 })
      }

      const { data: targetBalance } = await supabase.rpc('get_wallet_balance_v2', {
        p_user_id: target_id,
        p_wallet_type: 'primary',
      })

      if ((targetBalance || 0) < amountDecimal) {
        return NextResponse.json(
          { error: `${target_role === 'distributor' ? 'Distributor' : 'Retailer'} has insufficient balance`, available_balance: targetBalance || 0, requested_amount: amountDecimal },
          { status: 400 }
        )
      }

      const ref = `MD_PULL_${Date.now()}`

      const { error: debitError } = await supabase.rpc('debit_wallet_v2', {
        p_user_id: target_id,
        p_user_role: target_role,
        p_wallet_type: 'primary',
        p_fund_category: fund_category,
        p_service_type: 'admin',
        p_amount: amountDecimal,
        p_debit: amountDecimal,
        p_transaction_id: null,
        p_reference_id: ref,
        p_remarks: remarks || `Fund pulled by master distributor ${md.name} (${md.partner_id})`,
      })

      if (debitError) {
        console.error('Error debiting target wallet:', debitError)
        if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' })
        return NextResponse.json({ error: 'Failed to debit target wallet' }, { status: 500 })
      }

      const { error: creditError } = await supabase.rpc('credit_wallet_v2', {
        p_user_id: md.partner_id,
        p_user_role: 'master_distributor',
        p_wallet_type: 'primary',
        p_fund_category: fund_category,
        p_service_type: 'admin',
        p_amount: amountDecimal,
        p_credit: amountDecimal,
        p_transaction_id: null,
        p_reference_id: ref,
        p_remarks: remarks || `Fund pulled from ${target_role} ${target.name} (${target.partner_id})`,
      })

      if (creditError) {
        console.error('Error crediting MD wallet:', creditError)
        // Reverse target debit
        await supabase.rpc('credit_wallet_v2', {
          p_user_id: target_id,
          p_user_role: target_role,
          p_wallet_type: 'primary',
          p_fund_category: fund_category,
          p_service_type: 'admin',
          p_amount: amountDecimal,
          p_credit: amountDecimal,
          p_transaction_id: null,
          p_reference_id: `REVERSE_${Date.now()}`,
          p_remarks: 'Reversal: Failed to credit master distributor wallet',
        })
        if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' })
        return NextResponse.json({ error: 'Failed to credit master distributor wallet' }, { status: 500 })
      }

      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, md, {
        activity_type: 'md_wallet_transfer',
        activity_category: 'master_dist',
        activity_description: `Master distributor pulled ₹${amountDecimal} from ${target_role} ${target_id}`,
        reference_table: 'wallet_ledger',
      }).catch(() => {})

      const pullPayload = {
        success: true,
        message: `Funds pulled successfully from ${target_role}`,
        amount: amountDecimal,
        fund_category,
      }
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'completed', response: pullPayload })
      return NextResponse.json(pullPayload)
    }
  } catch (error: any) {
    console.error('Error in MD fund transfer:', error)
    if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
    return NextResponse.json({ error: 'Failed to transfer funds' }, { status: 500 })
  }
}
