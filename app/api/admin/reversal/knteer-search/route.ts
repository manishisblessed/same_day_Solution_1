/**
 * GET /api/admin/reversal/knteer-search
 * Search knteer_payout_transactions for the Reversals_KNTEER admin tab.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['admin', 'finance_executive']

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || !ALLOWED_ROLES.includes(admin.role as string)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const start = sp.get('start') || ''
    const end = sp.get('end') || ''
    const statusParam = (sp.get('status') || 'REFUNDABLE').toUpperCase()
    const search = (sp.get('search') || '').trim()
    const limit = Math.min(parseInt(sp.get('limit') || '200', 10) || 200, 1000)

    const supabase = getSupabase()

    const SELECT_COLS = [
      'id', 'retailer_id', 'user_role', 'partner_trans_id', 'knteer_trans_id',
      'account_number', 'ifsc_code', 'account_holder_name', 'bank_name',
      'amount', 'charges', 'total_debit', 'actual_wallet_debit',
      'status', 'status_message', 'failure_reason', 'utr', 'payment_mode',
      'wallet_debited', 'created_at', 'updated_at', 'completed_at',
      'distributor_id', 'md_id', 'narration', 'remarks',
    ].join(', ')

    let query = supabase
      .from('knteer_payout_transactions')
      .select(SELECT_COLS)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (start) query = query.gte('created_at', `${start}T00:00:00`)
    if (end) query = query.lte('created_at', `${end}T23:59:59`)

    if (statusParam === 'REFUNDABLE') {
      query = query.in('status', ['PENDING', 'FAILED'])
    } else if (['PENDING', 'FAILED', 'SUCCESS'].includes(statusParam)) {
      query = query.eq('status', statusParam)
    }

    if (search) {
      query = query.or(
        `retailer_id.ilike.%${search}%,partner_trans_id.ilike.%${search}%,` +
        `account_number.ilike.%${search}%,account_holder_name.ilike.%${search}%,` +
        `utr.ilike.%${search}%,knteer_trans_id.ilike.%${search}%`
      )
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const txns = data || []

    // Check which have been refunded via wallet_ledger
    const refundRefs = txns.map(t => `REFUND_${t.partner_trans_id}`)
    const { data: refundedLedger } = await supabase
      .from('wallet_ledger')
      .select('reference_id')
      .in('reference_id', refundRefs)
      .gt('credit', 0)

    const refundedSet = new Set((refundedLedger || []).map(r => r.reference_id))

    const rows = txns.map(tx => ({
      ...tx,
      is_refunded: refundedSet.has(`REFUND_${tx.partner_trans_id}`),
      refundable: !refundedSet.has(`REFUND_${tx.partner_trans_id}`) && tx.wallet_debited && ['FAILED', 'PENDING'].includes(tx.status),
    }))

    const stats = {
      total: rows.length,
      pending: rows.filter(r => r.status === 'PENDING').length,
      failed: rows.filter(r => r.status === 'FAILED').length,
      success: rows.filter(r => r.status === 'SUCCESS').length,
      already_refunded: rows.filter(r => r.is_refunded).length,
      refundable: rows.filter(r => r.refundable).length,
      refundable_amount: rows.filter(r => r.refundable)
        .reduce((s, r) => s + parseFloat(String(r.actual_wallet_debit || r.total_debit || 0)), 0),
    }

    return NextResponse.json({ success: true, transactions: rows, stats })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
