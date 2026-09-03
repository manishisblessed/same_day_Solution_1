import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type EntityType = 'retailer' | 'partner'

/**
 * Mark POS transactions as MANUALLY settled.
 *
 * Used when a retailer's/partner's T+1 is paused and their daily payout is done by
 * hand (or was already paid out-of-band). Stamping `settlement_mode = 'MANUAL'`
 * permanently removes the row from the T+1 auto-settle queries (which only pick up
 * `settlement_mode IS NULL`), so a manually paid transaction can never be
 * auto-credited a second time.
 *
 * - Retailer (default): matches `retailer_id`, only rows with `wallet_credited = false`.
 *   Sets settlement_mode='MANUAL' + manual audit fields.
 * - Partner: matches `partner_id`, only rows with `partner_wallet_credited = false`.
 *   Sets settlement_mode='MANUAL', partner_wallet_credited=true + manual audit fields.
 *
 * Only ever touches rows still pending and not already settled by any mode
 * (settlement_mode IS NULL), so it is safe to re-run.
 *
 * Access: admin, sub-admin (both resolve to role 'admin') and finance_executive.
 */
export async function POST(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (!isAdminOrFinance(admin)) {
      return NextResponse.json({ error: 'Admin or finance access required to mark manual settlements' }, { status: 403 })
    }

    const body = await request.json()
    const { partner_id, txn_ids, from, to, note, entity_type = 'retailer' } = body as {
      partner_id?: string
      txn_ids?: string[]
      from?: string
      to?: string
      note?: string
      entity_type?: EntityType
    }

    if (!partner_id) {
      return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
    }
    if (!note || !note.trim()) {
      return NextResponse.json({ error: 'A reference / remark note is required' }, { status: 400 })
    }
    const isPartner = entity_type === 'partner'
    const hasIds = Array.isArray(txn_ids) && txn_ids.length > 0
    const hasRange = !!from && !!to
    if (!hasIds && !hasRange) {
      return NextResponse.json(
        { error: 'Provide either txn_ids[] or both from and to (date range) to select transactions.' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()

    const updatePayload: Record<string, any> = {
      settlement_mode: 'MANUAL',
      manual_settled_at: new Date().toISOString(),
      manual_settled_by: admin.partner_id || admin.id || admin.email || 'admin',
      manual_settlement_note: note.trim(),
    }
    // Partners settle via their own wallet flag; stamping it true (alongside the
    // MANUAL mode) removes the row from getPendingPartnerT1Transactions.
    if (isPartner) updatePayload.partner_wallet_credited = true

    let query = supabase
      .from('razorpay_pos_transactions')
      .update(updatePayload, { count: 'exact' })
      .is('settlement_mode', null)

    if (isPartner) {
      query = query.eq('partner_id', partner_id).eq('partner_wallet_credited', false)
    } else {
      query = query.eq('retailer_id', partner_id).eq('wallet_credited', false)
    }

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

    const marked = count ?? data?.length ?? 0
    console.log(
      `[MarkManual] ${entity_type} ${partner_id}: ${marked} txn(s) marked MANUAL by ${admin.email}`
    )

    return NextResponse.json({
      success: true,
      marked,
      txn_ids: (data || []).map((r: any) => r.id),
      message: `${marked} transaction(s) marked as manually settled. They are now excluded from T+1 auto-settlement.`,
    })
  } catch (err: any) {
    console.error('[MarkManual] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Preview the pending (auto-settleable) transactions for a retailer or partner, so
 * an admin/finance user can see exactly what would be marked manual before committing.
 * Query params: partner_id (required), entity_type ('retailer'|'partner'), from, to (optional ISO range).
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
    const entity_type = (searchParams.get('entity_type') as EntityType) || 'retailer'
    const isPartner = entity_type === 'partner'

    if (!partner_id) {
      return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    let query = supabase
      .from('razorpay_pos_transactions')
      .select('id, txn_id, transaction_time, gross_amount, amount, display_status', { count: 'exact' })
      .is('settlement_mode', null)
      .order('transaction_time', { ascending: true })
      .limit(1000)

    if (isPartner) {
      query = query.eq('partner_id', partner_id).eq('partner_wallet_credited', false)
    } else {
      query = query
        .eq('retailer_id', partner_id)
        .eq('wallet_credited', false)
        .eq('t1_excluded_pre_start', false)
    }

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
