import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { initiateBankTransfer, checkTransactionStatus, generateSignature } from '@/services/shadval-pay'
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

    // #region agent log
    console.log('[DBG:a6bed1] GET accounts:', JSON.stringify({ count: accounts?.length || 0, statuses: (accounts || []).map((a: any) => ({ id: a.id?.substring(0,8), verified: a.is_verified, status: a.verification_status })) }))
    // #endregion

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

    // #region agent log
    console.log('[DBG:a6bed1] POST existing check:', JSON.stringify({ hasExisting: !!existing, isVerified: existing?.is_verified, isActive: existing?.is_active }))
    // #endregion

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

    // #region agent log
    console.log('[DBG:a6bed1] POST wallet check:', JSON.stringify({ walletBalance, balanceError: balanceError?.message || null, required: VERIFICATION_CHARGE }))
    // #endregion

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
      p_remarks: `Account verification charge ₹${VERIFICATION_CHARGE} for ${account_number} (${ifsc_code})`,
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

    // Penny drop via ShadvalPay
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

    // #region agent log
    console.log('[DBG:a6bed1] POST penny drop response:', JSON.stringify({ status: apiResult.status, code: apiResult.code, msg: apiResult.message, order_id: apiResult.data?.order_id, utr: apiResult.data?.utr, name: apiResult.data?.fund_account?.name }))
    // #endregion

    let finalStatus = apiResult.status
    let verifiedName = apiResult.data?.fund_account?.name || null
    let resolvedOrderId = apiResult.data?.order_id || null
    let resolvedUtr = apiResult.data?.utr || null

    // If PENDING, poll ShadvalPay status API (up to 3 attempts, 3s apart)
    if (finalStatus === 'PENDING' && refId) {
      console.log('[Settlement-2 Accounts] Transfer PENDING, polling status for:', refId)
      for (let attempt = 1; attempt <= 3; attempt++) {
        await new Promise(r => setTimeout(r, 3000))
        try {
          const statusResult = await checkTransactionStatus({ reference_id: refId })
          console.log(`[Settlement-2 Accounts] Status poll #${attempt}:`, {
            ref: refId,
            apiStatus: statusResult.status,
            txnStatus: statusResult.data?.txn_status,
            name: statusResult.data?.fund_account?.name,
          })
          if (statusResult.status === 'SUCCESS' && statusResult.data) {
            const txnStatus = statusResult.data.txn_status?.toLowerCase() || ''
            if (txnStatus.includes('success')) {
              finalStatus = 'SUCCESS'
              verifiedName = statusResult.data.fund_account?.name || verifiedName
              resolvedOrderId = statusResult.data.order_id || resolvedOrderId
              resolvedUtr = statusResult.data.utr || resolvedUtr
              break
            } else if (txnStatus.includes('fail')) {
              finalStatus = 'FAILED'
              break
            }
          }
        } catch (pollErr) {
          console.error(`[Settlement-2 Accounts] Status poll #${attempt} error:`, pollErr)
        }
      }
    }

    const isSuccess = finalStatus === 'SUCCESS'
    const verificationStatus = isSuccess ? 'SUCCESS' : finalStatus === 'FAILED' ? 'FAILED' : 'PENDING'

    // #region agent log
    console.log('[DBG:a6bed1] POST final decision:', JSON.stringify({ isSuccess, finalStatus, verifiedName, verificationStatus }))
    // #endregion

    // Try full insert first, fallback to basic columns if schema is stale
    let accountRecord: any = null
    let dbError: any = null

    const fullData = {
      retailer_id: user.partner_id,
      account_number,
      ifsc_code: ifsc_code.toUpperCase(),
      account_holder_name: account_holder_name.trim(),
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

    // #region agent log
    console.log('[DBG:a6bed1] POST DB result:', JSON.stringify({ ok: !dbError, err: dbError?.message || null, code: dbError?.code || null, hasRecord: !!accountRecord }))
    // #endregion

    if (dbError) {
      console.error('[Settlement-2 Accounts] DB save failed, refunding charge:', dbError)
      // Refund the ₹4 charge back to retailer
      await (supabaseAdmin as any).rpc('add_ledger_entry', {
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
      }).catch((e: any) => console.error('[Settlement-2 Accounts] Refund failed:', e))

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

    const statusResult = await checkTransactionStatus({ reference_id: account.verification_ref_id })

    // #region agent log
    console.log('[DBG:a6bed1] PATCH status check:', JSON.stringify({ ref: account.verification_ref_id, apiStatus: statusResult.status, code: statusResult.code, txnStatus: statusResult.data?.txn_status, name: statusResult.data?.fund_account?.name, utr: statusResult.data?.utr }))
    // #endregion

    if (statusResult.status === 'SUCCESS' && statusResult.data) {
      const txnStatus = statusResult.data.txn_status?.toLowerCase() || ''
      let newVerificationStatus = 'PENDING'
      let isVerified = false

      if (txnStatus.includes('success')) {
        newVerificationStatus = 'SUCCESS'
        isVerified = true
      } else if (txnStatus.includes('fail')) {
        newVerificationStatus = 'FAILED'
      }

      const updateData: Record<string, any> = {
        is_verified: isVerified,
      }

      // Only set extended columns if they exist (catch and ignore column errors)
      try {
        const { error: updateErr } = await supabaseAdmin
          .from('shadval_settlement_accounts')
          .update({
            verification_status: newVerificationStatus,
            is_verified: isVerified,
            verification_utr: statusResult.data.utr || account.verification_utr,
            verification_order_id: statusResult.data.order_id || account.verification_order_id,
            ...(isVerified ? {
              verified_name: statusResult.data.fund_account?.name || account.verified_name,
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
        txn_status: statusResult.data.txn_status,
      })
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: false,
      error: statusResult.message || 'Status check failed',
      verification_status: 'PENDING',
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
