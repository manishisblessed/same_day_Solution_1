import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Every POS transaction across a Master Channel Partner's CHILD partners, with
 * the master commission earned per transaction (net credited + TDS withheld).
 *
 * Hard-scoped to partners whose master_partner_id = this master. The master can
 * observe child POS activity and exactly what it earned, but never mutate.
 *
 * Query params: start_date, end_date (YYYY-MM-DD), partner_id (filter to one
 * child), limit (default 50, max 200), offset. Returns the paginated rows, a
 * total row count, and a period summary of commission/TDS/gross.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'master_partner' || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const supabase = getSupabaseAdmin()
    const masterId = user.partner_id

    const { searchParams } = new URL(request.url)
    const now = new Date()
    const defaultStart = new Date(now)
    defaultStart.setDate(now.getDate() - 30)
    const startISO = new Date(searchParams.get('start_date') || defaultStart.toISOString().slice(0, 10)).toISOString()
    const endISO = new Date((searchParams.get('end_date') || now.toISOString().slice(0, 10)) + 'T23:59:59.999Z').toISOString()
    const filterPartner = searchParams.get('partner_id') || null
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)))
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10))

    // Child partner set.
    const { data: members, error: membersErr } = await supabase
      .from('partners')
      .select('id, name, business_name')
      .eq('master_partner_id', masterId)
    if (membersErr) return NextResponse.json({ error: membersErr.message }, { status: 500 })

    const memberList = members || []
    const nameById = new Map(memberList.map((m: any) => [m.id, m.business_name || m.name || m.id]))
    let scopeIds = memberList.map((m: any) => m.id)
    if (filterPartner) scopeIds = scopeIds.filter((id: string) => id === filterPartner)

    if (scopeIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          transactions: [],
          total: 0,
          summary: { count: 0, grossVolume: 0, commissionNet: 0, tdsTotal: 0, creditedCount: 0 },
        },
      })
    }

    // Paginated rows for display.
    const { data: rows, error: rowsErr, count } = await supabase
      .from('razorpay_pos_transactions')
      .select(
        'id, txn_id, created_at, amount, payment_mode, status, display_status, merchant_slug, partner_id, partner_mdr_amount, master_partner_commission_amount, master_partner_commission_tds, master_partner_commission_credited',
        { count: 'exact' }
      )
      .in('partner_id', scopeIds)
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 })

    // Period summary over the full filtered set (lightweight numeric columns only).
    const { data: sumRows, error: sumErr } = await supabase
      .from('razorpay_pos_transactions')
      .select('amount, master_partner_commission_amount, master_partner_commission_tds, master_partner_commission_credited')
      .in('partner_id', scopeIds)
      .gte('created_at', startISO)
      .lte('created_at', endISO)
    if (sumErr) return NextResponse.json({ error: sumErr.message }, { status: 500 })

    let grossVolume = 0
    let commissionNet = 0
    let tdsTotal = 0
    let creditedCount = 0
    for (const r of sumRows || []) {
      grossVolume += Number(r.amount) || 0
      commissionNet += Number(r.master_partner_commission_amount) || 0
      tdsTotal += Number(r.master_partner_commission_tds) || 0
      if (r.master_partner_commission_credited) creditedCount++
    }

    const transactions = (rows || []).map((r: any) => ({
      id: r.id,
      txn_id: r.txn_id,
      created_at: r.created_at,
      amount: Number(r.amount) || 0,
      payment_mode: r.payment_mode,
      status: r.display_status || r.status,
      merchant_slug: r.merchant_slug,
      partner_id: r.partner_id,
      partner_name: nameById.get(r.partner_id) || r.partner_id,
      commission_net: r.master_partner_commission_amount != null ? Number(r.master_partner_commission_amount) : null,
      commission_tds: r.master_partner_commission_tds != null ? Number(r.master_partner_commission_tds) : null,
      commission_credited: !!r.master_partner_commission_credited,
    }))

    return NextResponse.json({
      success: true,
      data: {
        transactions,
        total: count || 0,
        summary: {
          count: (sumRows || []).length,
          grossVolume: Math.round(grossVolume * 100) / 100,
          commissionNet: Math.round(commissionNet * 100) / 100,
          tdsTotal: Math.round(tdsTotal * 100) / 100,
          creditedCount,
        },
      },
    })
  } catch (err: any) {
    console.error('[MCP Transactions] GET error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
