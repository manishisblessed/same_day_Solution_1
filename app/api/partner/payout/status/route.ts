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
    const listMode = searchParams.get('list') === 'true'

    // List mode: return recent transactions for this partner
    if (listMode) {
      const { data: txns } = await supabase
        .from('payout_transactions')
        .select('*')
        .eq('partner_id', partner.id)
        .order('created_at', { ascending: false })
        .limit(20)

      const transactions = (txns || []).map((t: Record<string, unknown>) => ({
        id: t.id,
        client_ref_id: t.client_ref_id,
        provider_txn_id: t.transaction_id,
        rrn: t.rrn,
        status: (t.status as string || '').toUpperCase(),
        amount: t.amount,
        charges: t.charges,
        total_amount: (t.amount as number) + (t.charges as number || 0),
        account_number: (t.account_number as string || '').replace(/\d(?=\d{4})/g, '*'),
        account_holder_name: t.account_holder_name,
        bank_name: t.bank_name,
        transfer_mode: t.transfer_mode,
        created_at: t.created_at,
        completed_at: t.completed_at,
      }))

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

    // Verify this transaction belongs to this partner
    if (tx.partner_id !== partner.id) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Transaction does not belong to your account' } },
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
          if (statusResult.status === 'failed' && tx.wallet_debited && tx.partner_id) {
            const total = tx.amount + (tx.charges || 0)
            await supabase.rpc('refund_partner_wallet', {
              p_partner_id: tx.partner_id,
              p_amount: total,
              p_payout_transaction_id: tx.id,
              p_description: 'Payout failed - Auto refund',
              p_reference_id: `REFUND_${tx.client_ref_id}`,
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
        total_amount: tx.amount + (tx.charges || 0),
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
