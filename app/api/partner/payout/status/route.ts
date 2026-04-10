import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'
import { getTransferStatus } from '@/services/payout'

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

export async function GET(request: NextRequest) {
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

    const supabase = getSupabase()
    const { searchParams } = new URL(request.url)
    const transactionId = searchParams.get('transactionId')
    const clientRefId = searchParams.get('clientRefId')
    const merchantId =
      searchParams.get('merchant_id')?.trim() ||
      searchParams.get('retailer_id')?.trim() ||
      null
    const listMode = searchParams.get('list') === 'true'

    // Load all merchant_ids linked to this partner (for scoping)
    const { data: linkedRows } = await supabase
      .from('partner_merchant_links')
      .select('merchant_id')
      .eq('partner_id', partner.id)
      .eq('is_active', true)

    const linkedMerchantIds = (linkedRows || []).map((r: any) => r.merchant_id as string)

    // List mode: return recent transactions for a merchant (wallet scope)
    if (listMode) {
      if (!merchantId) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message:
                'merchant_id is required for list mode (legacy alias: retailer_id)',
            },
          },
          { status: 400 }
        )
      }

      if (!linkedMerchantIds.includes(merchantId)) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message:
                'Merchant not linked to your partner account. Use GET /api/partner/payout/merchants to list available merchants.',
            },
          },
          { status: 403 }
        )
      }

      const { data: txns } = await supabase
        .from('payout_transactions')
        .select('*')
        .eq('retailer_id', merchantId)
        .order('created_at', { ascending: false })
        .limit(20)

      const rows = txns || []
      const transactions = rows.map((t: Record<string, unknown>) => {
        const rid = t.retailer_id as string | undefined
        const { retailer_id: _legacy, ...rest } = t
        return { ...rest, merchant_id: rid, retailer_id: rid }
      })

      return NextResponse.json({ success: true, transactions })
    }

    // Single transaction status
    if (!transactionId && !clientRefId) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'transactionId or clientRefId required' } },
        { status: 400 }
      )
    }

    let query = supabase.from('payout_transactions').select('*')
    if (transactionId) query = query.eq('id', transactionId)
    else if (clientRefId) query = query.eq('client_ref_id', clientRefId)

    const { data: tx, error: txErr } = await query.single()
    if (txErr || !tx) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Transaction not found' } },
        { status: 404 }
      )
    }

    // Verify this transaction belongs to a merchant linked to the partner
    if (!linkedMerchantIds.includes(tx.retailer_id)) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Transaction does not belong to a merchant linked to your account' } },
        { status: 403 }
      )
    }

    // If still pending/processing and has provider txn_id, check with provider
    if (['pending', 'processing'].includes(tx.status) && tx.transaction_id) {
      try {
        const statusResult = await getTransferStatus({ transactionId: tx.transaction_id })
        if (statusResult.success && statusResult.status && statusResult.status !== tx.status) {
          const updateData: any = { status: statusResult.status, updated_at: new Date().toISOString() }
          if (statusResult.operator_id) updateData.rrn = statusResult.operator_id
          if (statusResult.status === 'failed') updateData.failure_reason = statusResult.status_message
          if (['success', 'failed'].includes(statusResult.status)) updateData.completed_at = new Date().toISOString()

          await supabase.from('payout_transactions').update(updateData).eq('id', tx.id)

          // Auto-refund on failure
          if (statusResult.status === 'failed' && tx.wallet_debited) {
            const total = tx.amount + tx.charges
            await supabase.rpc('add_ledger_entry', {
              p_user_id: tx.retailer_id, p_user_role: 'retailer', p_wallet_type: 'primary',
              p_fund_category: 'payout', p_service_type: 'payout', p_tx_type: 'REFUND',
              p_credit: total, p_debit: 0,
              p_reference_id: `REFUND_${tx.client_ref_id}`, p_transaction_id: tx.id,
              p_status: 'completed', p_remarks: `Payout failed - Auto refund`,
            })
            await supabase.from('payout_transactions').update({ status: 'refunded' }).eq('id', tx.id)
            tx.status = 'refunded'
          } else {
            tx.status = statusResult.status
          }
          tx.rrn = statusResult.operator_id || tx.rrn
        }
      } catch { /* keep existing status */ }
    }

    const showFailure = tx.status === 'failed' || tx.status === 'refunded'

    return NextResponse.json({
      success: true,
      transaction: {
        id: tx.id,
        client_ref_id: tx.client_ref_id,
        provider_txn_id: tx.transaction_id,
        rrn: tx.rrn,
        status: tx.status.toUpperCase(),
        amount: tx.amount,
        charges: tx.charges,
        total_amount: tx.amount + tx.charges,
        account_number: tx.account_number.replace(/\d(?=\d{4})/g, '*'),
        account_holder_name: tx.account_holder_name,
        bank_name: tx.bank_name,
        transfer_mode: tx.transfer_mode,
        failure_reason: showFailure ? tx.failure_reason : undefined,
        remarks: tx.remarks,
        created_at: tx.created_at,
        completed_at: tx.completed_at,
      },
    })
  } catch (error: any) {
    console.error('[Partner Payout Status] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
