/**
 * POST /api/admin/reversal/knteer-refund
 * Issue refund for a FAILED/PENDING Knteer transaction.
 * Also reverses commission if not already reversed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { refundKnteerPayout } from '@/lib/knteer/refund'
import { reverseServiceCommission } from '@/lib/commission/distribute-service-commission'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['admin', 'finance_executive']

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || !ALLOWED_ROLES.includes(admin.role as string)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
    }

    const { transaction_id, skip_provider_check } = await request.json()
    if (!transaction_id) {
      return NextResponse.json({ success: false, error: 'transaction_id required' }, { status: 400 })
    }

    // Fetch the transaction
    const { data: tx, error: fetchErr } = await supabaseAdmin
      .from('knteer_payout_transactions')
      .select('id, retailer_id, user_role, amount, charges, actual_wallet_debit, total_debit, partner_trans_id, status, wallet_debited')
      .eq('id', transaction_id)
      .single()

    if (fetchErr || !tx) {
      return NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 })
    }

    if (!['PENDING', 'FAILED'].includes(tx.status)) {
      return NextResponse.json({ success: false, error: `Cannot refund a ${tx.status} transaction` }, { status: 400 })
    }

    if (!tx.wallet_debited) {
      return NextResponse.json({ success: false, error: 'Wallet was not debited — no refund needed' }, { status: 400 })
    }

    // Attempt refund
    const refund = await refundKnteerPayout(
      supabaseAdmin,
      {
        id: tx.id,
        retailer_id: tx.retailer_id,
        user_role: tx.user_role || 'retailer',
        partner_trans_id: tx.partner_trans_id,
        actual_wallet_debit: parseFloat(String(tx.actual_wallet_debit || tx.total_debit || tx.amount)),
        charges: parseFloat(String(tx.charges || 0)),
        amount: parseFloat(String(tx.amount)),
      },
      { skipProviderCheck: !!skip_provider_check, note: `admin:${admin.email}` }
    )

    // Reverse commission if refund happened (or already done)
    if (refund.refunded || refund.alreadyRefunded) {
      await reverseServiceCommission({
        supabase: supabaseAdmin,
        service: 'knteer_payout',
        refPrefix: 'KNTEER',
        refKey: tx.partner_trans_id,
        transactionUuid: tx.id,
      }).catch(e => console.warn('[AdminKnteerRefund] Commission reversal warn:', e?.message))

      // Update transaction status to FAILED if it was PENDING
      if (tx.status === 'PENDING') {
        await supabaseAdmin
          .from('knteer_payout_transactions')
          .update({
            status: 'FAILED',
            failure_reason: `Admin-initiated refund by ${admin.email}`,
            status_message: `Manually refunded by admin (${admin.email})`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tx.id)
      }
    }

    return NextResponse.json({
      success: true,
      refund: {
        refunded: refund.refunded,
        already_refunded: refund.alreadyRefunded,
        blocked_provider_success: refund.blockedProviderSuccess,
        critical: refund.critical,
        error: refund.error,
        provider_utr: refund.providerUtr,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
