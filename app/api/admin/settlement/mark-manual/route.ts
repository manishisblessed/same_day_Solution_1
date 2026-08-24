import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOnly, isAdminOrFinance } from '@/lib/auth-roles'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Mark POS transactions as MANUALLY settled.
 *
 * Used when a retailer's T+1 is paused and their daily payout is done by hand.
 * Stamping `settlement_mode = 'MANUAL'` permanently removes the row from the T+1
 * auto-settle query (which only picks up `settlement_mode IS NULL`), so a manually
 * paid transaction can never be auto-credited a second time.
 *
 * Only ever touches rows that are still pending (wallet_credited = false) and not
 * already settled by any mode (settlement_mode IS NULL), so it is safe to re-run.
 */
export async function POST(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (!isAdminOnly(admin)) {
      return NextResponse.json({ error: 'Admin access required to mark manual settlements' }, { status: 403 })
    }

    const body = await request.json()
    const { partner_id, txn_ids, from, to, note } = body as {
      partner_id?: string
      txn_ids?: string[]
      from?: string
      to?: string
      note?: string
    }

    if (!partner_id) {
      return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
    }
    const hasIds = Array.isArray(txn_ids) && txn_ids.length > 0
    const hasRange = !!from && !!to
    if (!hasIds && !hasRange) {
      return NextResponse.json(
        { error: 'Provide either txn_ids[] or both from and to (date range) to select transactions.' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()

    let query = supabase
      .from('razorpay_pos_transactions')
      .update(
        {
          settlement_mode: 'MANUAL',
          manual_settled_at: new Date().toISOString(),
          manual_settled_by: admin.partner_id || admin.id || admin.email || 'admin',
          manual_settlement_note: note || null,
        },
        { count: 'exact' }
      )
      .eq('retailer_id', partner_id)
      .eq('wallet_credited', false)
      .is('settlement_mode', null)

    if (hasIds) {
      query = query.in('id', txn_ids as string[])
    } else {
      query = query.gte('transaction_time', from as string).lte('transaction_time', to as string)
    }

    const { data, error, count } = await query.select('id')

    if (error) {
      console.error('[MarkManual] Update error:', error)
      return NextResponse.json({ error: 'Failed to mark transactions as manual' }, { status: 500 })
    }

    console.log(
      `[MarkManual] Retailer ${partner_id}: ${count ?? data?.length ?? 0} txn(s) marked MANUAL by ${admin.email}`
    )

    return NextResponse.json({
      success: true,
      marked: count ?? data?.length ?? 0,
      txn_ids: (data || []).map((r: any) => r.id),
      message: `${count ?? data?.length ?? 0} transaction(s) marked as manually settled. They are now excluded from T+1 auto-settlement.`,
    })
  } catch (err: any) {
    console.error('[MarkManual] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Preview the pending (auto-settleable) transactions for a retailer, so an admin
 * can see exactly what would be marked manual before committing.
 * Query params: partner_id (required), from, to (optional ISO date range).
 */
export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (!isAdminOrFinance(admin)) {
      return NextResponse.json({ error: 'Admin or finance access required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const partner_id = searchParams.get('partner_id')
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    if (!partner_id) {
      return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    let query = supabase
      .from('razorpay_pos_transactions')
      .select('id, txn_id, transaction_time, gross_amount, amount, display_status', { count: 'exact' })
      .eq('retailer_id', partner_id)
      .eq('wallet_credited', false)
      .eq('t1_excluded_pre_start', false)
      .is('settlement_mode', null)
      .order('transaction_time', { ascending: true })
      .limit(1000)

    if (from) query = query.gte('transaction_time', from)
    if (to) query = query.lte('transaction_time', to)

    const { data, error, count } = await query

    if (error) {
      console.error('[MarkManual] Preview error:', error)
      return NextResponse.json({ error: 'Failed to load pending transactions' }, { status: 500 })
    }

    const total = (data || []).reduce(
      (sum: number, t: any) => sum + parseFloat(t.gross_amount || t.amount || '0'),
      0
    )

    return NextResponse.json({
      success: true,
      count: count ?? data?.length ?? 0,
      total_gross: Math.round(total * 100) / 100,
      transactions: data || [],
    })
  } catch (err: any) {
    console.error('[MarkManual] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
