import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { initiateBankTransfer } from '@/services/shadval-pay'
import type { ShadvalTransferRequest } from '@/services/shadval-pay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * POST /api/partner/settlement/transfer
 * Initiate settlement transfer to a verified account
 */
export async function POST(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const e = error as PartnerAuthError
      return NextResponse.json(
        { success: false, error: { code: e.code, message: e.message } },
        { status: e.status }
      )
    }

    const { partner } = authResult
    const access = partnerCanUseApi(partner, 'settlement')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: access.message } },
        { status: 403 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { account_id, amount, mode = 'IMPS', narration } = body

    if (!account_id || !amount) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'account_id and amount are required' } },
        { status: 400 }
      )
    }

    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid amount' } },
        { status: 400 }
      )
    }

    const validModes = ['IMPS', 'NEFT', 'RTGS']
    if (!validModes.includes(mode)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid mode. Must be IMPS, NEFT, or RTGS' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Fetch verified account
    const { data: account, error: acctError } = await supabase
      .from('shadval_settlement_accounts')
      .select('*')
      .eq('id', account_id)
      .eq('retailer_id', partner.id)
      .eq('is_verified', true)
      .eq('is_active', true)
      .maybeSingle()

    if (acctError || !account) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Verified account not found' } },
        { status: 404 }
      )
    }

    // Check partner wallet balance
    const { data: walletBalance, error: balErr } = await supabase.rpc('get_partner_wallet_balance', {
      p_partner_id: partner.id
    })

    if (balErr || walletBalance === null) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check wallet balance' } },
        { status: 500 }
      )
    }

    // Check if wallet is frozen
    const { data: walletInfo } = await supabase
      .from('partner_wallets')
      .select('is_frozen, freeze_reason')
      .eq('partner_id', partner.id)
      .maybeSingle()

    if (walletInfo?.is_frozen) {
      return NextResponse.json(
        { success: false, error: { code: 'WALLET_FROZEN', message: `Wallet is frozen: ${walletInfo.freeze_reason || 'Contact admin'}` } },
        { status: 403 }
      )
    }

    // For partner settlement: charges are 0 (direct debit of transfer amount)
    const charges = 0
    const totalRequired = amountNum + charges

    if (walletBalance < totalRequired) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: `Insufficient balance. Required: ₹${totalRequired}. Available: ₹${walletBalance}` },
          wallet_balance: walletBalance,
          amount: amountNum,
          charges,
          total_required: totalRequired,
        },
        { status: 400 }
      )
    }

    // Duplicate prevention
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const { data: recentTx } = await supabase
      .from('shadval_settlement')
      .select('id, status, created_at')
      .eq('retailer_id', partner.id)
      .eq('account_number', account.account_number)
      .gte('created_at', twoMinAgo)
      .in('status', ['SUCCESS', 'PENDING'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentTx) {
      const secAgo = Math.round((Date.now() - new Date(recentTx.created_at).getTime()) / 1000)
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: `Transaction to this account initiated ${secAgo}s ago. Wait ${120 - secAgo}s.` }, wait_seconds: 120 - secAgo },
        { status: 429 }
      )
    }

    const refId = `PSV2_${partner.id}_${Date.now()}`

    // Create transaction record
    const { data: txRecord, error: txErr } = await supabase
      .from('shadval_settlement')
      .insert({
        retailer_id: partner.id,
        account_number: account.account_number,
        ifsc_code: account.ifsc_code,
        account_holder_name: account.account_holder_name,
        amount: amountNum,
        charges,
        total_debit: amountNum + charges,
        mode,
        reference_id: refId,
        status: 'PENDING',
        contact_name: account.contact_name || partner.name,
        contact_email: account.contact_email || '',
        contact_mobile: account.contact_mobile || '',
        narration: narration || 'Partner Settlement Transfer',
      })
      .select()
      .single()

    if (txErr || !txRecord) {
      console.error('[Partner Settlement Transfer] Insert error:', txErr)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create transaction record' } },
        { status: 500 }
      )
    }

    // Debit partner wallet
    const { error: debitErr } = await supabase.rpc('debit_partner_wallet', {
      p_partner_id: partner.id,
      p_amount: totalRequired,
      p_payout_transaction_id: txRecord.id,
      p_description: `Settlement transfer ₹${amountNum} to ${account.account_number} (${account.account_holder_name})`,
      p_reference_id: refId,
    })

    if (debitErr) {
      console.error('[Partner Settlement Transfer] Wallet debit error:', debitErr)
      await supabase.from('shadval_settlement').update({ status: 'FAILED', status_message: 'Wallet debit failed' }).eq('id', txRecord.id)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to debit wallet' } },
        { status: 500 }
      )
    }

    // Initiate bank transfer via Shadval Pay
    const transferRequest: ShadvalTransferRequest = {
      amount: amountNum,
      mode: mode as 'IMPS' | 'NEFT' | 'RTGS',
      fund_account: {
        name: account.account_holder_name,
        ifsc: account.ifsc_code,
        account_number: account.account_number,
      },
      contact_details: {
        name: account.contact_name || partner.name || account.account_holder_name,
        email: account.contact_email || '',
        mobile: account.contact_mobile || '',
      },
      reference_id: refId,
      latitude: '28.6139',
      longitude: '77.2090',
      narration: narration || 'Partner Settlement Transfer',
    }

    const apiResult = await initiateBankTransfer(transferRequest)
    const isSuccess = apiResult.status === 'SUCCESS'
    const isFailed = apiResult.status === 'FAILED'
    const finalStatus = isSuccess ? 'SUCCESS' : isFailed ? 'FAILED' : 'PENDING'

    // Update transaction with API result
    await supabase
      .from('shadval_settlement')
      .update({
        status: finalStatus,
        order_id: apiResult.data?.order_id || null,
        internal_ref_id: apiResult.data?.internal_ref_id || null,
        utr: apiResult.data?.utr || null,
        status_message: apiResult.message,
        provider_timestamp: apiResult.data?.timestamp || null,
      })
      .eq('id', txRecord.id)

    // Refund on failure
    if (isFailed) {
      try {
        await supabase.rpc('refund_partner_wallet', {
          p_partner_id: partner.id,
          p_amount: totalRequired,
          p_payout_transaction_id: txRecord.id,
          p_description: `Settlement failed - Refund: ${apiResult.message}`,
          p_reference_id: `REFUND_${refId}`,
        })
      } catch {}
    }

    return NextResponse.json({
      success: !isFailed,
      message: apiResult.message,
      transaction: {
        id: txRecord.id,
        reference_id: refId,
        order_id: apiResult.data?.order_id || null,
        utr: apiResult.data?.utr || null,
        amount: amountNum,
        charges,
        total_debited: totalRequired,
        mode,
        status: finalStatus,
        account_number: account.account_number,
        account_holder_name: account.account_holder_name,
        ifsc_code: account.ifsc_code,
      },
      ...(isFailed ? { refunded: true } : {}),
    })
  } catch (error: any) {
    console.error('[Partner Settlement Transfer] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
