import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { initiateBankTransfer, checkTransactionStatus, getBalance } from '@/services/shadval-pay'
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
      .replace(/[^A-Za-z\s\-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (trimmedName.length < 3) {
      const response = NextResponse.json(
        { success: false, error: 'Beneficiary name must be at least 3 characters (only letters, spaces, and hyphens allowed)' },
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
      .select('id, is_verified, is_active, verification_status')
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

    // Don't charge again while a verification is already in progress for this account
    if (existing?.is_active && (existing as any)?.verification_status === 'PENDING') {
      const response = NextResponse.json(
        {
          success: false,
          error: 'Verification for this account is already in progress. Please use the Re-check button on the account instead of submitting again (no extra charge).',
          verification_status: 'PENDING',
        },
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

    // PENNY prefix distinguishes payout-based penny-drop refs from legacy SV2_VERIFY_ refs
    // (which used the async verification API and can't be status-checked).
    const refId = `SV2_PENNY_${user.partner_id}_${Date.now()}`

    // Pre-flight: check payout wallet balance (penny drop sends Rs.1 via the payout API)
    const balanceCheck = await getBalance()
    if (balanceCheck.status !== 'SUCCESS') {
      console.log('[Settlement-2 Accounts] Payout service pre-check failed:', balanceCheck.code, balanceCheck.message)
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

    // Penny drop: send Rs.1 via the payout API. Unlike the async verification API
    // (which only ever replies "Request Submitted" with no way to fetch the result),
    // the payout API returns SUCCESS/FAILED/PENDING synchronously, confirms the
    // beneficiary name, and PENDING refs can be polled via check_status.
    console.log('[Settlement-2 Accounts] Initiating penny-drop verification:', {
      ref: refId,
      account: account_number.substring(0, 4) + '****',
      ifsc: ifsc_code,
      retailer: user.partner_id,
    })

    const apiResult = await initiateBankTransfer({
      amount: 1,
      mode: 'IMPS',
      fund_account: {
        name: trimmedName,
        ifsc: ifsc_code.toUpperCase(),
        account_number,
      },
      contact_details: {
        name: contact_name || trimmedName,
        email: contact_email || user.email || '',
        mobile: contact_mobile,
      },
      reference_id: refId,
      latitude: '28.6139',
      longitude: '77.2090',
      narration: 'Account Verification',
    })

    console.log('[Settlement-2 Accounts] Penny-drop response:', JSON.stringify({
      status: apiResult.status,
      code: apiResult.code,
      msg: apiResult.message,
      utr: apiResult.data?.utr,
      name: apiResult.data?.fund_account?.name,
    }))

    // Refund if service is unavailable (not user's fault)
    const isServiceUnavailable = apiResult.code === 'NETWORK_ERROR' ||
      apiResult.code === 'PROVIDER_ERROR' ||
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

    // Determine verification result from the penny-drop transfer.
    // SUCCESS  -> Rs.1 landed in the account: it exists and is active. Verified.
    // PENDING  -> bank is processing; poll check_status via Re-check.
    // FAILED   -> definitive rejection with a reason from the bank.
    const isSuccess = apiResult.status === 'SUCCESS'
    const isPending = apiResult.status === 'PENDING'
    const isFailed = !isSuccess && !isPending
    const rawBankName = apiResult.data?.fund_account?.name?.trim() || null
    const verifiedName = rawBankName
      ? rawBankName.replace(/[^A-Za-z\s\-]/g, '').replace(/\s+/g, ' ').trim() || rawBankName
      : null
    const resolvedOrderId = apiResult.data?.order_id || null
    const resolvedUtr = apiResult.data?.utr || null
    const verificationStatus = isSuccess ? 'SUCCESS' : isPending ? 'PENDING' : 'FAILED'

    // Build user-friendly failure detail
    let failureReason = ''
    if (isFailed) {
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
      else if (msg.includes('duplicate'))
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
      verification_utr: resolvedUtr,
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
      ...(isPending ? { pending_message: 'Your verification is being processed by the bank. Please check back in a few minutes using the Re-check button.' } : {}),
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

    const isPennyRef = account.verification_ref_id.startsWith('SV2_PENNY_')

    let isVerified = false
    let isStillPending = false
    let verifiedName: string | null = null
    let resolvedOrderId: string | null = null
    let resolvedUtr: string | null = null
    let newRefId: string | null = null
    let providerMessage = ''

    if (isPennyRef) {
      // Penny-drop refs are real payout transactions: poll the status API
      const statusResult = await checkTransactionStatus({ reference_id: account.verification_ref_id })
      providerMessage = statusResult.data?.status_message || statusResult.message || ''
      const txnStatus = (statusResult.data?.txn_status || '').toUpperCase()
      if (statusResult.status === 'SUCCESS' && txnStatus.includes('SUCCESS')) {
        isVerified = true
        verifiedName = statusResult.data?.fund_account?.name?.trim() || null
        resolvedOrderId = statusResult.data?.order_id || null
        resolvedUtr = statusResult.data?.utr || null
      } else if (statusResult.status === 'SUCCESS' && (txnStatus.includes('PENDING') || txnStatus.includes('PROCESS'))) {
        isStillPending = true
      } else if (statusResult.code === 'NETWORK_ERROR') {
        isStillPending = true
        providerMessage = 'Could not reach verification service. Please try again.'
      }
      // anything else (FAILED / not found) -> FAILED
    } else {
      // Legacy ref from the old async verification API — its result can never be fetched.
      // Run a fresh Rs.1 penny drop at no extra charge to the retailer (they already paid).
      newRefId = `SV2_PENNY_${user.partner_id}_${Date.now()}`
      const pennyResult = await initiateBankTransfer({
        amount: 1,
        mode: 'IMPS',
        fund_account: {
          name: account.account_holder_name || 'NA',
          ifsc: account.ifsc_code,
          account_number: account.account_number,
        },
        contact_details: {
          name: account.contact_name || account.account_holder_name || 'NA',
          email: account.contact_email || user.email || '',
          mobile: account.contact_mobile || user.phone || '9999999999',
        },
        reference_id: newRefId,
        latitude: '28.6139',
        longitude: '77.2090',
        narration: 'Account Verification Re-check',
      })
      providerMessage = pennyResult.message || ''
      if (pennyResult.status === 'SUCCESS') {
        isVerified = true
        verifiedName = pennyResult.data?.fund_account?.name?.trim() || null
        resolvedOrderId = pennyResult.data?.order_id || null
        resolvedUtr = pennyResult.data?.utr || null
      } else if (pennyResult.status === 'PENDING' || pennyResult.code === 'NETWORK_ERROR' || pennyResult.code === 'PROVIDER_ERROR') {
        isStillPending = true
      }
    }

    const newVerificationStatus = isVerified ? 'SUCCESS' : isStillPending ? 'PENDING' : 'FAILED'

    try {
      const { error: updateErr } = await supabaseAdmin
        .from('shadval_settlement_accounts')
        .update({
          verification_status: newVerificationStatus,
          is_verified: isVerified,
          verification_order_id: resolvedOrderId || account.verification_order_id,
          verification_utr: resolvedUtr || account.verification_utr,
          ...(newRefId ? { verification_ref_id: newRefId } : {}),
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
      message: providerMessage,
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
