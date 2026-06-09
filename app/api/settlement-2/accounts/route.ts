import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { initiateBankTransfer, generateSignature } from '@/services/shadval-pay'
import type { ShadvalTransferRequest } from '@/services/shadval-pay'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VERIFICATION_CHARGE = 4.00
const PENNY_DROP_AMOUNT = 1.00

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/settlement-2/accounts
 * List verified bank accounts for the current retailer
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user || user.role !== 'retailer') {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    const { data: accounts, error } = await supabaseAdmin
      .from('shadval_settlement_accounts')
      .select('*')
      .eq('retailer_id', user.partner_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[Settlement-2 Accounts] Fetch error:', error)
      const response = NextResponse.json({ success: false, error: 'Failed to fetch accounts' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      accounts: accounts || [],
      count: accounts?.length || 0,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Settlement-2 Accounts] Error:', error)
    const response = NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return addCorsHeaders(request, response)
  }
}

/**
 * POST /api/settlement-2/accounts
 * Add & verify a bank account via penny drop (Rs.1 transfer)
 * Debit Rs.4 verification charge from retailer wallet → company revenue
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user || user.role !== 'retailer') {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { account_number, ifsc_code, account_holder_name, contact_name, contact_email, contact_mobile } = body

    if (!account_number || !ifsc_code || !account_holder_name) {
      const response = NextResponse.json(
        { success: false, error: 'account_number, ifsc_code, and account_holder_name are required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifsc_code)) {
      const response = NextResponse.json({ success: false, error: 'Invalid IFSC code format' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    // Check for existing account
    const { data: existing } = await supabaseAdmin
      .from('shadval_settlement_accounts')
      .select('id, is_verified, is_active')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', account_number)
      .eq('ifsc_code', ifsc_code.toUpperCase())
      .maybeSingle()

    if (existing?.is_verified && existing?.is_active) {
      const response = NextResponse.json(
        { success: false, error: 'This account is already verified and active' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Check wallet balance for verification charge
    const { data: walletBalance, error: balanceError } = await (supabaseAdmin as any).rpc('get_wallet_balance', {
      p_retailer_id: user.partner_id,
    })

    if (balanceError || walletBalance === null || walletBalance === undefined) {
      console.error('[Settlement-2 Accounts] Wallet balance error:', balanceError)
      const response = NextResponse.json({ success: false, error: 'Failed to check wallet balance' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    if (walletBalance < VERIFICATION_CHARGE) {
      const response = NextResponse.json(
        {
          success: false,
          error: `Insufficient wallet balance. Verification charge is ₹${VERIFICATION_CHARGE}. Current balance: ₹${walletBalance}`,
          wallet_balance: walletBalance,
          required: VERIFICATION_CHARGE,
        },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const refId = `SV2_VERIFY_${user.partner_id}_${Date.now()}`

    // Debit verification charge from retailer wallet
    const { data: chargeLedgerId, error: chargeError } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
      p_user_id: user.partner_id,
      p_user_role: 'retailer',
      p_wallet_type: 'primary',
      p_fund_category: 'service',
      p_service_type: 'shadval_settlement',
      p_tx_type: 'ACCOUNT_VERIFICATION_CHARGE',
      p_credit: 0,
      p_debit: VERIFICATION_CHARGE,
      p_reference_id: refId,
      p_transaction_id: null,
      p_status: 'completed',
      p_remarks: `Account verification charge ₹${VERIFICATION_CHARGE} for ${account_number} (${ifsc_code})`,
    })

    if (chargeError) {
      console.error('[Settlement-2 Accounts] Charge debit error:', chargeError)
      const response = NextResponse.json({ success: false, error: 'Failed to debit verification charge' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    // Credit verification charge to company revenue
    let revenueLedgerId: string | null = null
    const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
    const revenueUserRole = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'
    if (revenueUserId) {
      const { data: revId, error: revError } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: revenueUserId,
        p_user_role: revenueUserRole,
        p_wallet_type: 'primary',
        p_fund_category: 'revenue',
        p_service_type: 'shadval_settlement',
        p_tx_type: 'COMPANY_REVENUE',
        p_credit: VERIFICATION_CHARGE,
        p_debit: 0,
        p_reference_id: `REV_${refId}`,
        p_transaction_id: null,
        p_status: 'completed',
        p_remarks: `Account verification revenue ₹${VERIFICATION_CHARGE} from retailer ${user.partner_id}`,
      })
      if (!revError) revenueLedgerId = revId
      else console.error('[Settlement-2 Accounts] Revenue credit error:', revError)
    }

    // Perform penny drop verification via Shadval Pay API
    const pennyDropRequest: ShadvalTransferRequest = {
      amount: PENNY_DROP_AMOUNT,
      mode: 'IMPS',
      fund_account: {
        name: account_holder_name.trim(),
        ifsc: ifsc_code.toUpperCase(),
        account_number: account_number,
      },
      contact_details: {
        name: contact_name || user.name || account_holder_name,
        email: contact_email || user.email || '',
        mobile: contact_mobile || user.phone || '',
      },
      reference_id: refId,
      latitude: '0',
      longitude: '0',
      narration: 'Account Verification',
    }

    console.log('[Settlement-2 Accounts] Initiating penny drop:', {
      ref: refId,
      account: account_number.substring(0, 4) + '****',
      ifsc: ifsc_code,
      retailer: user.partner_id,
    })

    const apiResult = await initiateBankTransfer(pennyDropRequest)

    const isSuccess = apiResult.status === 'SUCCESS'
    const verifiedName = apiResult.data?.fund_account?.name || null

    // Upsert account record
    const accountData = {
      retailer_id: user.partner_id,
      account_number: account_number,
      ifsc_code: ifsc_code.toUpperCase(),
      account_holder_name: account_holder_name.trim(),
      is_verified: isSuccess,
      verification_ref_id: refId,
      verification_order_id: apiResult.data?.order_id || null,
      verification_utr: apiResult.data?.utr || null,
      verification_status: isSuccess ? 'SUCCESS' : apiResult.status === 'FAILED' ? 'FAILED' : 'PENDING',
      verification_charges: VERIFICATION_CHARGE,
      verification_ledger_id: chargeLedgerId,
      verification_revenue_id: revenueLedgerId,
      verified_name: verifiedName,
      verified_at: isSuccess ? new Date().toISOString() : null,
      contact_name: contact_name || null,
      contact_email: contact_email || null,
      contact_mobile: contact_mobile || null,
      is_active: true,
    }

    let accountRecord
    if (existing) {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('shadval_settlement_accounts')
        .update(accountData)
        .eq('id', existing.id)
        .select()
        .single()
      if (updateError) console.error('[Settlement-2 Accounts] Update error:', updateError)
      accountRecord = updated
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('shadval_settlement_accounts')
        .insert(accountData)
        .select()
        .single()
      if (insertError) console.error('[Settlement-2 Accounts] Insert error:', insertError)
      accountRecord = inserted
    }

    const response = NextResponse.json({
      success: true,
      verified: isSuccess,
      verification_status: accountData.verification_status,
      account: accountRecord,
      api_message: apiResult.message,
      verified_name: verifiedName,
      charge_deducted: VERIFICATION_CHARGE,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Settlement-2 Accounts] Error:', error)
    const response = NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return addCorsHeaders(request, response)
  }
}

/**
 * DELETE /api/settlement-2/accounts
 * Deactivate an account (soft delete)
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user || user.role !== 'retailer') {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('id')

    if (!accountId) {
      const response = NextResponse.json({ success: false, error: 'Account ID is required' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    const { error } = await supabaseAdmin
      .from('shadval_settlement_accounts')
      .update({ is_active: false })
      .eq('id', accountId)
      .eq('retailer_id', user.partner_id)

    if (error) {
      const response = NextResponse.json({ success: false, error: 'Failed to deactivate account' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({ success: true, message: 'Account deactivated' })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    const response = NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return addCorsHeaders(request, response)
  }
}
