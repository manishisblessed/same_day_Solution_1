import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'
import { initiateTransfer, generateClientRefId, getPayoutBalance } from '@/services/payout'
import { getTransferLimits } from '@/services/payout/config'

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
    if (!partner.permissions.includes('payout') && !partner.permissions.includes('all')) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Missing required permission: payout' } },
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

    const {
      merchant_id: merchantIdBody,
      retailer_id: retailerIdLegacy,
      accountNumber, ifscCode, accountHolderName, amount,
      transferMode, bankId, bankName, beneficiaryMobile, senderName,
      senderMobile, senderEmail, remarks,
    } = body

    const merchantIdRaw = merchantIdBody ?? retailerIdLegacy
    const retailer_id =
      merchantIdRaw !== undefined && merchantIdRaw !== null
        ? String(merchantIdRaw).trim()
        : ''

    if (!retailer_id) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message:
              'merchant_id is required — the Same Day merchant identifier whose wallet is debited (legacy alias: retailer_id)',
          },
        },
        { status: 400 }
      )
    }
    if (!accountNumber || !ifscCode || !accountHolderName || !amount || !transferMode) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'accountNumber, ifscCode, accountHolderName, amount, transferMode are required' } },
        { status: 400 }
      )
    }
    if (bankId === undefined || bankId === null || !bankName) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'bankId and bankName are required' } },
        { status: 400 }
      )
    }
    if (!beneficiaryMobile || !senderName || !senderMobile) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'beneficiaryMobile, senderName, senderMobile are required' } },
        { status: 400 }
      )
    }

    const mobileRegex = /^[6-9]\d{9}$/
    if (!mobileRegex.test(beneficiaryMobile)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid beneficiary mobile number' } },
        { status: 400 }
      )
    }
    if (!mobileRegex.test(senderMobile)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid sender mobile number' } },
        { status: 400 }
      )
    }
    if (!['IMPS', 'NEFT'].includes(transferMode)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'transferMode must be IMPS or NEFT' } },
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

    const limits = getTransferLimits()
    if (amountNum < limits.min) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: `Minimum transfer: ₹${limits.min}` } },
        { status: 400 }
      )
    }
    if (amountNum > limits.max) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: `Maximum transfer: ₹${limits.max}` } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Verify retailer exists
    const { data: retailer } = await supabase
      .from('retailers')
      .select('partner_id, name, email, distributor_id, master_distributor_id')
      .eq('partner_id', retailer_id)
      .maybeSingle()

    if (!retailer) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Retailer not found' } },
        { status: 404 }
      )
    }

    // Resolve charges via scheme
    let charges = 0
    let resolvedSchemeId: string | null = null
    let resolvedSchemeName: string | null = null
    try {
      const { data: schemeResult } = await (supabase as any).rpc('resolve_scheme_for_user', {
        p_user_id: retailer_id, p_user_role: 'retailer', p_service_type: 'payout',
        p_distributor_id: retailer.distributor_id || null, p_md_id: retailer.master_distributor_id || null,
      })
      if (schemeResult?.[0]) {
        resolvedSchemeId = schemeResult[0].scheme_id
        resolvedSchemeName = schemeResult[0].scheme_name
        const { data: chargeResult } = await (supabase as any).rpc('calculate_payout_charge_from_scheme', {
          p_scheme_id: schemeResult[0].scheme_id, p_amount: amountNum, p_transfer_mode: transferMode,
        })
        if (chargeResult?.[0] && parseFloat(chargeResult[0].retailer_charge) > 0) {
          charges = parseFloat(chargeResult[0].retailer_charge)
        }
      }
    } catch { /* use default */ }

    const totalAmount = amountNum + charges

    // Check retailer wallet
    const { data: walletBalance, error: balErr } = await (supabase as any).rpc('get_wallet_balance', { p_retailer_id: retailer_id })
    if (balErr) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check wallet balance' } },
        { status: 500 }
      )
    }
    if (walletBalance < totalAmount) {
      return NextResponse.json(
        { success: false, error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient wallet balance' }, wallet_balance: walletBalance, amount: amountNum, charges, total_required: totalAmount },
        { status: 400 }
      )
    }

    // Check provider balance
    const providerBalance = await getPayoutBalance()
    if (!providerBalance.success || (providerBalance.available_balance || 0) < amountNum) {
      return NextResponse.json(
        { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Payout service temporarily unavailable' } },
        { status: 503 }
      )
    }

    // Duplicate prevention
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const { data: recentTx } = await supabase
      .from('payout_transactions')
      .select('id, status, created_at, amount')
      .eq('retailer_id', retailer_id)
      .eq('account_number', accountNumber)
      .gte('created_at', twoMinAgo)
      .in('status', ['pending', 'processing', 'success'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentTx) {
      const secAgo = Math.round((Date.now() - new Date(recentTx.created_at).getTime()) / 1000)
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: `Transaction to this account initiated ${secAgo}s ago. Wait ${120 - secAgo}s.` }, duplicate_prevention: true, wait_seconds: 120 - secAgo },
        { status: 429 }
      )
    }

    const clientRefId = generateClientRefId(retailer_id)

    // Create transaction record
    const { data: payoutTx, error: txErr } = await supabase
      .from('payout_transactions')
      .insert({
        retailer_id, account_number: accountNumber, ifsc_code: ifscCode,
        account_holder_name: accountHolderName, bank_name: bankName,
        amount: amountNum, charges, transfer_mode: transferMode,
        client_ref_id: clientRefId, status: 'pending', remarks: remarks || null,
        wallet_debited: false,
        ...(resolvedSchemeId ? { scheme_id: resolvedSchemeId, scheme_name: resolvedSchemeName, retailer_charge: charges } : {}),
      })
      .select()
      .single()

    if (txErr || !payoutTx) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create transaction record' } },
        { status: 500 }
      )
    }

    // Debit wallet
    const { data: ledgerId, error: ledgerErr } = await (supabase as any).rpc('debit_wallet_bbps', {
      p_retailer_id: retailer_id, p_transaction_id: payoutTx.id,
      p_amount: totalAmount, p_description: `Payout to ${accountHolderName} via ${transferMode}`,
      p_reference_id: clientRefId,
    })
    if (ledgerErr) {
      await supabase.from('payout_transactions').update({ status: 'failed', failure_reason: 'Wallet debit failed' }).eq('id', payoutTx.id)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to debit wallet' } },
        { status: 500 }
      )
    }
    await supabase.from('payout_transactions').update({ wallet_debited: true, wallet_debit_id: ledgerId, status: 'processing' }).eq('id', payoutTx.id)

    // Call SparkUpTech
    const transferResult = await initiateTransfer({
      accountNumber, ifscCode, accountHolderName, amount: amountNum,
      transferMode: transferMode as 'IMPS' | 'NEFT',
      bankId: parseInt(bankId), bankName, beneficiaryMobile, senderName, senderMobile,
      senderEmail: senderEmail || '', remarks: remarks || `Payout - ${clientRefId}`, clientRefId,
    })

    // Handle timeout — keep as processing, don't refund
    if ((transferResult as any).is_timeout) {
      await supabase.from('payout_transactions').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', payoutTx.id)
      return NextResponse.json({
        success: true, message: 'Transfer initiated. Processing may take a few minutes.',
        transaction_id: payoutTx.id, client_ref_id: clientRefId, status: 'PROCESSING',
        amount: amountNum, charges, total_debited: totalAmount,
        account_number: accountNumber.replace(/\d(?=\d{4})/g, '*'),
        account_holder_name: accountHolderName, bank_name: bankName, transfer_mode: transferMode,
      })
    }

    if (!transferResult.success) {
      // Refund on failure
      await (supabase as any).rpc('refund_wallet_bbps', {
        p_retailer_id: retailer_id, p_transaction_id: payoutTx.id,
        p_amount: totalAmount, p_description: `Payout failed - Refund: ${transferResult.error}`,
        p_reference_id: `REFUND_${clientRefId}`,
      })
      await supabase.from('payout_transactions').update({ status: 'failed', failure_reason: transferResult.error, updated_at: new Date().toISOString() }).eq('id', payoutTx.id)
      return NextResponse.json(
        { success: false, error: { code: 'TRANSFER_FAILED', message: transferResult.error || 'Transfer failed' }, refunded: true },
        { status: 400 }
      )
    }

    await supabase.from('payout_transactions').update({ transaction_id: transferResult.transaction_id, status: transferResult.status || 'processing', updated_at: new Date().toISOString() }).eq('id', payoutTx.id)

    return NextResponse.json({
      success: true,
      message: transferResult.remark || 'Transfer initiated successfully',
      transaction_id: payoutTx.id,
      provider_txn_id: transferResult.transaction_id,
      client_ref_id: transferResult.client_ref_id || clientRefId,
      status: (transferResult.status || 'processing').toUpperCase(),
      amount: amountNum, charges, total_debited: totalAmount,
      account_number: accountNumber.replace(/\d(?=\d{4})/g, '*'),
      account_holder_name: accountHolderName, bank_name: bankName, transfer_mode: transferMode,
    })
  } catch (error: any) {
    console.error('[Partner Payout Transfer] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
