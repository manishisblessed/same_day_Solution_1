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
      accountNumber, ifscCode, accountHolderName, amount,
      transferMode, bankId, bankName, beneficiaryMobile, senderName,
      senderMobile, senderEmail, remarks,
    } = body

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

    // Fixed charges for partner payouts (no scheme lookup — that's for retailers)
    const charges = 0
    const totalAmount = amountNum + charges

    // Check partner wallet balance
    const { data: walletBalance, error: balErr } = await supabase.rpc('get_partner_wallet_balance', {
      p_partner_id: partner.id
    })
    if (balErr) {
      console.error('[Partner Payout Transfer] Balance check error:', balErr)
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
        { success: false, error: { code: 'WALLET_FROZEN', message: `Partner wallet is frozen: ${walletInfo.freeze_reason || 'Contact admin'}` } },
        { status: 403 }
      )
    }

    if ((walletBalance || 0) < totalAmount) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient partner wallet balance' },
          wallet_balance: walletBalance || 0,
          amount: amountNum,
          charges,
          total_required: totalAmount
        },
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

    // Duplicate prevention (by partner + account number)
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const { data: recentTx } = await supabase
      .from('payout_transactions')
      .select('id, status, created_at, amount')
      .eq('partner_id', partner.id)
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

    const clientRefId = generateClientRefId(partner.id)

    // Create transaction record (partner_id instead of retailer_id)
    const { data: payoutTx, error: txErr } = await supabase
      .from('payout_transactions')
      .insert({
        partner_id: partner.id,
        retailer_id: null,
        account_number: accountNumber,
        ifsc_code: ifscCode,
        account_holder_name: accountHolderName,
        bank_name: bankName,
        amount: amountNum,
        charges,
        transfer_mode: transferMode,
        client_ref_id: clientRefId,
        status: 'pending',
        remarks: remarks || null,
        wallet_debited: false,
      })
      .select()
      .single()

    if (txErr || !payoutTx) {
      console.error('[Partner Payout Transfer] Insert error:', txErr)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create transaction record' } },
        { status: 500 }
      )
    }

    // Debit partner wallet
    const { data: ledgerId, error: ledgerErr } = await supabase.rpc('debit_partner_wallet', {
      p_partner_id: partner.id,
      p_amount: totalAmount,
      p_payout_transaction_id: payoutTx.id,
      p_description: `Payout to ${accountHolderName} via ${transferMode}`,
      p_reference_id: clientRefId,
    })

    if (ledgerErr) {
      console.error('[Partner Payout Transfer] Wallet debit error:', ledgerErr)
      await supabase.from('payout_transactions').update({ status: 'failed', failure_reason: 'Wallet debit failed' }).eq('id', payoutTx.id)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: ledgerErr.message || 'Failed to debit wallet' } },
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
      // Refund partner wallet on failure
      await supabase.rpc('refund_partner_wallet', {
        p_partner_id: partner.id,
        p_amount: totalAmount,
        p_payout_transaction_id: payoutTx.id,
        p_description: `Payout failed - Refund: ${transferResult.error}`,
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
