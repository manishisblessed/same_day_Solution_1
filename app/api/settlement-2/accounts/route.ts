import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { verifyAccount, getVerificationBalance } from '@/services/shadval-pay'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VERIFICATION_CHARGE_BASE = 4.00
const GST_PERCENT = 18
const VERIFICATION_GST = Math.round(VERIFICATION_CHARGE_BASE * GST_PERCENT / 100 * 100) / 100
const VERIFICATION_CHARGE = Math.round((VERIFICATION_CHARGE_BASE + VERIFICATION_GST) * 100) / 100

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

async function ensureColumns() {
  try {
    await supabaseAdmin.rpc('exec_sql' as any, {
      query: `ALTER TABLE shadval_settlement_accounts
        ADD COLUMN IF NOT EXISTS verification_order_id TEXT,
        ADD COLUMN IF NOT EXISTS verification_utr TEXT,
        ADD COLUMN IF NOT EXISTS verification_status TEXT,
        ADD COLUMN IF NOT EXISTS verification_charges DECIMAL(12,2) DEFAULT 4.00,
        ADD COLUMN IF NOT EXISTS verification_ledger_id TEXT,
        ADD COLUMN IF NOT EXISTS verification_revenue_id TEXT,
        ADD COLUMN IF NOT EXISTS verified_name TEXT,
        ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS verification_ref_id TEXT,
        ADD COLUMN IF NOT EXISTS contact_name TEXT,
        ADD COLUMN IF NOT EXISTS contact_email TEXT,
        ADD COLUMN IF NOT EXISTS contact_mobile TEXT;
        NOTIFY pgrst, 'reload schema';`
    })
  } catch {
    // exec_sql RPC may not exist — that's fine, columns may already be there
  }
}

let columnsChecked = false

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
    const { user } = await getCurrentUserWithFallback(request)
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

    console.log('[Settlement-2 Accounts] GET accounts:', accounts?.length || 0)

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
    const { user } = await getCurrentUserWithFallback(request)
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

    const trimmedName = account_holder_name.trim()
    if (trimmedName.length < 3) {
      const response = NextResponse.json(
        { success: false, error: 'Beneficiary name must be at least 3 characters' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    if (!/^[A-Za-z\s.]+$/.test(trimmedName)) {
      const response = NextResponse.json(
        { success: false, error: 'Beneficiary name must contain only letters, spaces, and dots' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    if (!contact_mobile || !/^\d{10}$/.test(contact_mobile)) {
      const response = NextResponse.json(
        { success: false, error: 'A valid 10-digit mobile number is required for verification' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifsc_code)) {
      const response = NextResponse.json({ success: false, error: 'Invalid IFSC code format' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    // One-time attempt to ensure DB columns exist
    if (!columnsChecked) {
      await ensureColumns()
      columnsChecked = true
    }

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

    // Pre-flight: check verification wallet balance
    const balanceCheck = await getVerificationBalance()
    if (balanceCheck.status !== 'SUCCESS') {
      console.log('[Settlement-2 Accounts] Verification service pre-check failed:', balanceCheck.code, balanceCheck.message)
      const response = NextResponse.json({
        success: false,
        error: 'Verification service is currently unavailable. Please try again later. No charge deducted.',
      }, { status: 503 })
      return addCorsHeaders(request, response)
    }

    // Debit verification charge
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
      p_remarks: `Account verification charge ₹${VERIFICATION_CHARGE_BASE} + GST ₹${VERIFICATION_GST} = ₹${VERIFICATION_CHARGE} for ${account_number} (${ifsc_code})`,
    })

    if (chargeError) {
      console.error('[Settlement-2 Accounts] Charge debit error:', chargeError)
      const response = NextResponse.json({ success: false, error: 'Failed to debit verification charge' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    // Credit to company revenue
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

    // Account Verification via ShadvalPay Verification API
    console.log('[Settlement-2 Accounts] Initiating account verification:', {
      ref: refId,
      account: account_number.substring(0, 4) + '****',
      ifsc: ifsc_code,
      retailer: user.partner_id,
    })

    const apiResult = await verifyAccount({
      account_number,
      ifsc_code: ifsc_code.toUpperCase(),
      ref_num: refId,
      latitude: '28.6139',
      longitude: '77.2090',
    })

    console.log('[Settlement-2 Accounts] Verification response:', JSON.stringify({
      status: apiResult.status,
      code: apiResult.code,
      msg: apiResult.message,
      verification_status: apiResult.data?.verification_status,
      name_at_bank: apiResult.data?.name_at_bank,
    }))

    // Refund if service is unavailable (not user's fault)
    const isServiceUnavailable = apiResult.code === 'NETWORK_ERROR' ||
      (!apiResult.status && !apiResult.code)
    if (isServiceUnavailable) {
      console.log('[Settlement-2 Accounts] Verification service unavailable, refunding ₹4 to retailer:', user.partner_id)
      const { error: refundErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: 'retailer',
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'shadval_settlement',
        p_tx_type: 'ACCOUNT_VERIFICATION_REFUND',
        p_credit: VERIFICATION_CHARGE,
        p_debit: 0,
        p_reference_id: `REFUND_${refId}`,
        p_transaction_id: null,
        p_status: 'completed',
        p_remarks: `Auto-refund: Verification service unavailable (${apiResult.code || 'NO_RESPONSE'}). ₹${VERIFICATION_CHARGE} returned.`,
      })
      if (refundErr) console.error('[Settlement-2 Accounts] Refund failed:', refundErr)

      if (revenueLedgerId && revenueUserId) {
        const { error: revRefundErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
          p_user_id: revenueUserId,
          p_user_role: revenueUserRole,
          p_wallet_type: 'primary',
          p_fund_category: 'revenue',
          p_service_type: 'shadval_settlement',
          p_tx_type: 'REVENUE_REVERSAL',
          p_credit: 0,
          p_debit: VERIFICATION_CHARGE,
          p_reference_id: `REV_REFUND_${refId}`,
          p_transaction_id: null,
          p_status: 'completed',
          p_remarks: `Reversal: verification service unavailable for ${account_number}`,
        })
        if (revRefundErr) console.error('[Settlement-2 Accounts] Revenue reversal failed:', revRefundErr)
      }

      const response = NextResponse.json({
        success: false,
        error: 'Verification service is currently unavailable. Your ₹4 verification charge has been refunded. Please try again later.',
        refunded: true,
        charge_refunded: VERIFICATION_CHARGE,
      }, { status: 503 })
      return addCorsHeaders(request, response)
    }

    // Determine verification result
    const isSuccess = apiResult.status === 'SUCCESS' && apiResult.data?.verification_status === true
    const isPending = apiResult.status === 'PENDING' ||
      (apiResult.status === 'SUCCESS' && apiResult.data?.verification_status === false)
    const verifiedName = apiResult.data?.name_at_bank?.trim() || null
    const resolvedOrderId = apiResult.data?.order_id || null
    const verificationStatus = isSuccess ? 'SUCCESS' : isPending ? 'PENDING' : 'FAILED'

    // Build user-friendly failure detail
    let failureReason = ''
    if (!isSuccess && !isPending) {
      const code = (apiResult.code || '').toUpperCase()
      const msg = (apiResult.message || '').toLowerCase()
      if (msg.includes('invalid account') || msg.includes('account not found') || msg.includes('no such account'))
        failureReason = 'The account number does not exist or is inactive. Please double-check and re-enter.'
      else if (msg.includes('invalid ifsc') || msg.includes('ifsc not found'))
        failureReason = 'The IFSC code is invalid. Please verify the branch IFSC from your bank passbook or cheque book.'
      else if (msg.includes('closed') || msg.includes('frozen') || msg.includes('blocked'))
        failureReason = 'This bank account appears to be closed, frozen, or blocked. Contact your bank.'
      else if (msg.includes('name') && msg.includes('mismatch'))
        failureReason = 'The account holder name does not match bank records. Enter the name exactly as it appears in bank records.'
      else if (code === 'SP104' || msg.includes('bad request'))
        failureReason = 'Invalid request. Please check all details (account number, IFSC) and try again.'
      else if (code === 'SP105' || msg.includes('duplicate'))
        failureReason = 'A verification for this account was already submitted. Please wait a few minutes and try again.'
      else
        failureReason = apiResult.message || 'Verification failed. Please verify your account number and IFSC code are correct.'
    }

    // Try full insert first, fallback to basic columns if schema is stale
    let accountRecord: any = null
    let dbError: any = null

    const resolvedHolderName = (isSuccess && verifiedName && verifiedName.length >= 3)
      ? verifiedName
      : account_holder_name.trim()

    const fullData = {
      retailer_id: user.partner_id,
      account_number,
      ifsc_code: ifsc_code.toUpperCase(),
      account_holder_name: resolvedHolderName,
      is_verified: isSuccess,
      verification_ref_id: refId,
      verification_order_id: resolvedOrderId,
      verification_utr: null,
      verification_status: verificationStatus,
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

    // Basic columns guaranteed to exist from original table creation
    const basicData: Record<string, any> = {
      retailer_id: user.partner_id,
      account_number,
      ifsc_code: ifsc_code.toUpperCase(),
      account_holder_name: account_holder_name.trim(),
      is_verified: isSuccess,
      is_active: true,
    }

    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('shadval_settlement_accounts').update(fullData).eq('id', existing.id).select().single()
      if (error?.code === 'PGRST204') {
        console.log('[Settlement-2 Accounts] Column missing on update, using basic columns')
        const { data: d2, error: e2 } = await supabaseAdmin
          .from('shadval_settlement_accounts').update(basicData).eq('id', existing.id).select().single()
        accountRecord = d2; dbError = e2
      } else {
        accountRecord = data; dbError = error
      }
    } else {
      const { data, error } = await supabaseAdmin
        .from('shadval_settlement_accounts').insert(fullData).select().single()
      if (error?.code === 'PGRST204') {
        console.log('[Settlement-2 Accounts] Column missing on insert, using basic columns')
        const { data: d2, error: e2 } = await supabaseAdmin
          .from('shadval_settlement_accounts').insert(basicData).select().single()
        accountRecord = d2; dbError = e2
      } else {
        accountRecord = data; dbError = error
      }
    }

    if (dbError) {
      console.error('[Settlement-2 Accounts] DB save failed, refunding charge:', dbError)
      // Refund the ₹4 charge back to retailer
      const { error: dbRefundErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: 'retailer',
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'shadval_settlement',
        p_tx_type: 'ACCOUNT_VERIFICATION_REFUND',
        p_credit: VERIFICATION_CHARGE,
        p_debit: 0,
        p_reference_id: `REFUND_${refId}`,
        p_transaction_id: null,
        p_status: 'completed',
        p_remarks: `Refund: account verification failed for ${account_number} (${ifsc_code}). DB error: ${dbError.message}`,
      })
      if (dbRefundErr) console.error('[Settlement-2 Accounts] Refund failed:', dbRefundErr)

      const response = NextResponse.json({
        success: false,
        error: 'Verification initiated but failed to save account. ₹4 has been refunded. Please contact support if the issue persists.',
      }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      verified: isSuccess,
      verification_status: verificationStatus,
      account: accountRecord,
      api_message: apiResult.message,
      verified_name: verifiedName,
      charge_deducted: VERIFICATION_CHARGE,
      ...(failureReason ? { failure_reason: failureReason } : {}),
      ...(isPending ? { pending_message: 'Your verification is being processed. The bank is confirming the account details. Please check back in a few minutes using the Re-check button.' } : {}),
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Settlement-2 Accounts] Error:', error)
    const response = NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return addCorsHeaders(request, response)
  }
}

/**
 * PATCH /api/settlement-2/accounts
 * Re-check verification status for a PENDING account
 */
export async function PATCH(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'retailer') {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { account_id } = body

    if (!account_id) {
      const response = NextResponse.json({ success: false, error: 'account_id is required' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    const { data: account, error: fetchErr } = await supabaseAdmin
      .from('shadval_settlement_accounts')
      .select('*')
      .eq('id', account_id)
      .eq('retailer_id', user.partner_id)
      .maybeSingle()

    if (fetchErr || !account) {
      const response = NextResponse.json({ success: false, error: 'Account not found' }, { status: 404 })
      return addCorsHeaders(request, response)
    }

    if (account.is_verified) {
      const response = NextResponse.json({ success: true, verified: true, account })
      return addCorsHeaders(request, response)
    }

    if (!account.verification_ref_id) {
      const response = NextResponse.json({ success: false, error: 'No verification reference found' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    console.log('[Settlement-2 Accounts] Re-checking verification:', {
      ref: account.verification_ref_id,
      accountId: account_id,
    })

    // Re-verify the account using the verification API
    const recheckResult = await verifyAccount({
      account_number: account.account_number,
      ifsc_code: account.ifsc_code,
      ref_num: `RECHECK_${account.verification_ref_id}`,
      latitude: '28.6139',
      longitude: '77.2090',
    })

    const isVerified = recheckResult.status === 'SUCCESS' && recheckResult.data?.verification_status === true
    const newVerificationStatus = isVerified ? 'SUCCESS' : recheckResult.status === 'PENDING' ? 'PENDING' : 'FAILED'
    const verifiedName = recheckResult.data?.name_at_bank?.trim() || null

    try {
      const { error: updateErr } = await supabaseAdmin
        .from('shadval_settlement_accounts')
        .update({
          verification_status: newVerificationStatus,
          is_verified: isVerified,
          verification_order_id: recheckResult.data?.order_id || account.verification_order_id,
          ...(isVerified ? {
            verified_name: verifiedName || account.verified_name,
            verified_at: new Date().toISOString(),
          } : {}),
        })
        .eq('id', account_id)

      if (updateErr?.code === 'PGRST204') {
        await supabaseAdmin
          .from('shadval_settlement_accounts')
          .update({ is_verified: isVerified })
          .eq('id', account_id)
      }
    } catch (e) {
      await supabaseAdmin
        .from('shadval_settlement_accounts')
        .update({ is_verified: isVerified })
        .eq('id', account_id)
    }

    const { data: refreshed } = await supabaseAdmin
      .from('shadval_settlement_accounts')
      .select('*')
      .eq('id', account_id)
      .single()

    const response = NextResponse.json({
      success: true,
      verified: isVerified,
      verification_status: newVerificationStatus,
      account: refreshed || account,
      name_at_bank: verifiedName,
      message: recheckResult.message,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Settlement-2 Accounts] PATCH error:', error)
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
    const { user } = await getCurrentUserWithFallback(request)
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
