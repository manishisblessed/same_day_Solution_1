/**
 * POST /api/admin/reversal/knteer-mark-failed
 *
 * Force-marks a Knteer transaction as FAILED when the provider has confirmed
 * the payout did not succeed. Intended for the rare case where our DB shows
 * SUCCESS but Knteer confirms failure (e.g. incorrect beneficiary details,
 * returned funds).
 *
 * Safety:
 *  - Requires admin or finance_executive role.
 *  - Re-checks live Knteer status before updating — blocks the update if the
 *    provider still shows SUCCESS+UTR (prevents accidental mis-marking).
 *  - Can be bypassed via `skip_provider_check: true` for cases where Knteer
 *    returns "record not found" but we have confirmed via UTR check with bank.
 *  - Appends an audit trail (failure_reason, status_message, updated_at).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { checkKnteerStatus } from '@/services/knteer-payout'

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

    const { transaction_id, skip_provider_check, reason } = await request.json()
    if (!transaction_id) {
      return NextResponse.json({ success: false, error: 'transaction_id required' }, { status: 400 })
    }

    // Fetch the transaction
    const { data: tx, error: fetchErr } = await supabaseAdmin
      .from('knteer_payout_transactions')
      .select('id, partner_trans_id, status, wallet_debited, failure_reason')
      .eq('id', transaction_id)
      .single()

    if (fetchErr || !tx) {
      return NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 })
    }

    if (tx.status === 'FAILED') {
      return NextResponse.json({ success: true, already_failed: true, message: 'Transaction is already marked FAILED' })
    }

    // Provider re-check: if provider still shows SUCCESS+UTR, block the update
    if (!skip_provider_check) {
      try {
        const providerResult = await checkKnteerStatus(tx.partner_trans_id)
        if (providerResult.success && providerResult.status === 'success' && providerResult.utr) {
          return NextResponse.json({
            success: false,
            blocked_provider_success: true,
            provider_utr: providerResult.utr,
            error: `Provider still shows SUCCESS with UTR ${providerResult.utr}. Cannot mark as failed. Use skip_provider_check only if you have bank confirmation.`,
          }, { status: 409 })
        }
      } catch (e: any) {
        // Provider check failed — log but allow update (prefer trusting admin)
        console.warn('[KnteerMarkFailed] Provider re-check error, proceeding:', e?.message)
      }
    }

    const adminNote = reason
      ? `${reason} — Admin: ${admin.email}`
      : `Admin-marked as FAILED by ${admin.email}`

    const { error: updateErr } = await supabaseAdmin
      .from('knteer_payout_transactions')
      .update({
        status: 'FAILED',
        failure_reason: adminNote,
        status_message: `Manually marked FAILED by admin (${admin.email}) — Knteer confirmed failure`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction_id)

    if (updateErr) throw new Error(updateErr.message)

    console.log('[KnteerMarkFailed] Marked FAILED:', {
      txId: transaction_id,
      partner_trans_id: tx.partner_trans_id,
      prev_status: tx.status,
      admin: admin.email,
      skip_provider_check,
    })

    return NextResponse.json({
      success: true,
      already_failed: false,
      previous_status: tx.status,
      message: `Transaction marked as FAILED. Wallet was ${tx.wallet_debited ? '' : 'NOT '}debited — ${tx.wallet_debited ? 'refund can now be issued from the Reversals tab' : 'no refund needed'}.`,
      wallet_debited: tx.wallet_debited,
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
