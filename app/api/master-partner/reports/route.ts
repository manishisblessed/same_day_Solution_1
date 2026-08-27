import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Read-only reporting for a Master Channel Partner over its CHILD partners.
 *
 * "Members" = partners whose master_partner_id = this master partner. All data
 * is hard-scoped to that member set; a master partner can only observe, never
 * mutate, its partners. Reporting spans all services even though commission is
 * POS-only.
 *
 * Widgets: total transactions, active/transacting members, member-wise count,
 * member-wise details, service-wise breakdown, overall summary (+ the master
 * partner's own POS override earnings).
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

    // --- Member set (child partners) ---
    const { data: members, error: membersErr } = await supabase
      .from('partners')
      .select('id, name, business_name, email, phone, status')
      .eq('master_partner_id', masterId)
    if (membersErr) return NextResponse.json({ error: membersErr.message }, { status: 500 })

    const memberList = members || []
    const memberIds = memberList.map((m: any) => m.id)
    const nameById = new Map(memberList.map((m: any) => [m.id, m.business_name || m.name || m.id]))

    if (memberIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          summary: { totalMembers: 0, activeMembers: 0, totalTransactions: 0, totalPosGross: 0, totalOverrideEarned: 0 },
          memberWise: [],
          serviceBreakdown: [],
        },
      })
    }

    // --- All partner ledger rows (unified view across services) + POS gross ---
    const [ledgerRes, posRes, overrideRes] = await Promise.all([
      supabase
        .from('partner_wallet_ledger')
        .select('partner_id, transaction_type, service_type, credit, debit, created_at')
        .in('partner_id', memberIds)
        .gte('created_at', startISO)
        .lte('created_at', endISO),
      supabase
        .from('razorpay_pos_transactions')
        .select('partner_id, amount, partner_mdr_amount, created_at')
        .in('partner_id', memberIds)
        .gte('created_at', startISO)
        .lte('created_at', endISO),
      // The master partner's own POS override earnings in the period.
      supabase
        .from('partner_wallet_ledger')
        .select('credit, created_at')
        .eq('partner_id', masterId)
        .eq('service_type', 'pos_master_override')
        .gte('created_at', startISO)
        .lte('created_at', endISO),
    ])

    if (ledgerRes.error) return NextResponse.json({ error: ledgerRes.error.message }, { status: 500 })

    const ledgerRows = ledgerRes.data || []
    const posRows = posRes.data || []
    const overrideRows = overrideRes.data || []

    // --- Member-wise aggregation ---
    const perMember = new Map<string, { transactions: number; posGross: number; posCount: number; credit: number; debit: number }>()
    for (const id of memberIds) perMember.set(id, { transactions: 0, posGross: 0, posCount: 0, credit: 0, debit: 0 })

    const activeMembers = new Set<string>()
    let totalTransactions = 0

    for (const row of ledgerRows) {
      const m = perMember.get(row.partner_id)
      if (!m) continue
      m.transactions++
      m.credit += Number(row.credit) || 0
      m.debit += Number(row.debit) || 0
      totalTransactions++
      activeMembers.add(row.partner_id)
    }

    let totalPosGross = 0
    for (const row of posRows) {
      const m = perMember.get(row.partner_id)
      if (!m) continue
      m.posGross += Number(row.amount) || 0
      m.posCount++
      totalPosGross += Number(row.amount) || 0
      activeMembers.add(row.partner_id)
    }

    // --- Service-wise / transaction-type breakdown ---
    const serviceMap = new Map<string, { type: string; count: number; credit: number; debit: number }>()
    for (const row of ledgerRows) {
      const key = row.service_type || row.transaction_type || 'unknown'
      const e = serviceMap.get(key) || { type: key, count: 0, credit: 0, debit: 0 }
      e.count++
      e.credit += Number(row.credit) || 0
      e.debit += Number(row.debit) || 0
      serviceMap.set(key, e)
    }
    if (posRows.length > 0) {
      serviceMap.set('pos', {
        type: 'pos',
        count: posRows.length,
        credit: Math.round(totalPosGross * 100) / 100,
        debit: 0,
      })
    }

    const totalOverrideEarned = Math.round(overrideRows.reduce((s, r) => s + (Number(r.credit) || 0), 0) * 100) / 100

    const memberWise = memberList.map((m: any) => {
      const agg = perMember.get(m.id)!
      return {
        partner_id: m.id,
        name: nameById.get(m.id),
        email: m.email,
        phone: m.phone,
        status: m.status,
        transactionCount: agg.transactions,
        posCount: agg.posCount,
        posGross: Math.round(agg.posGross * 100) / 100,
        credit: Math.round(agg.credit * 100) / 100,
        debit: Math.round(agg.debit * 100) / 100,
        isActive: activeMembers.has(m.id),
      }
    }).sort((a, b) => b.transactionCount - a.transactionCount)

    const serviceBreakdown = Array.from(serviceMap.values())
      .map((s) => ({ ...s, credit: Math.round(s.credit * 100) / 100, debit: Math.round(s.debit * 100) / 100 }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalMembers: memberIds.length,
          activeMembers: activeMembers.size,
          totalTransactions: totalTransactions + posRows.length,
          totalPosGross: Math.round(totalPosGross * 100) / 100,
          totalOverrideEarned,
        },
        memberWise,
        serviceBreakdown,
      },
    })
  } catch (err: any) {
    console.error('[MCP Reports] GET error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
