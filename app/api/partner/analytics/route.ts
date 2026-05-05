import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'partner' || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const partnerId = user.partner_id
    const period = request.nextUrl.searchParams.get('period') || '30d'
    const days = PERIOD_DAYS[period] || 30

    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceISO = since.toISOString()

    const [walletRes, commissionRes] = await Promise.all([
      supabase
        .from('partner_wallet_ledger')
        .select('transaction_type, status, created_at, credit, debit, closing_balance')
        .eq('partner_id', partnerId)
        .gte('created_at', sinceISO)
        .order('created_at', { ascending: true }),
      supabase
        .from('commission_ledger')
        .select('commission_amount, created_at, service_type')
        .eq('user_id', partnerId)
        .gte('created_at', sinceISO)
        .order('created_at', { ascending: true }),
    ])

    if (walletRes.error) {
      console.error('[Partner Analytics] wallet query error:', walletRes.error)
      return NextResponse.json({ error: walletRes.error.message }, { status: 500 })
    }
    if (commissionRes.error) {
      console.error('[Partner Analytics] commission query error:', commissionRes.error)
      return NextResponse.json({ error: commissionRes.error.message }, { status: 500 })
    }

    const walletRows = walletRes.data || []
    const commissionRows = commissionRes.data || []

    const toDateKey = (iso: string) => iso.slice(0, 10)

    // Build a map of all dates in the period for consistent output
    const dateMap = new Map<string, { transactions: number; revenue: number; commission: number }>()
    for (let d = 0; d < days; d++) {
      const dt = new Date(since)
      dt.setDate(since.getDate() + d)
      const key = dt.toISOString().slice(0, 10)
      dateMap.set(key, { transactions: 0, revenue: 0, commission: 0 })
    }

    const apiMap = new Map<string, { transactions: number; revenue: number }>()
    let totalRevenue = 0
    let totalTransactions = 0

    for (const row of walletRows) {
      const key = toDateKey(row.created_at)
      const entry = dateMap.get(key)
      const credit = Number(row.credit) || 0

      if (entry) {
        entry.transactions++
        entry.revenue += credit
      }

      totalTransactions++
      totalRevenue += credit

      const txType = row.transaction_type || 'unknown'
      const api = apiMap.get(txType) || { transactions: 0, revenue: 0 }
      api.transactions++
      api.revenue += credit
      apiMap.set(txType, api)
    }

    let totalCommission = 0

    for (const row of commissionRows) {
      const key = toDateKey(row.created_at)
      const entry = dateMap.get(key)
      const amount = Number(row.commission_amount) || 0

      if (entry) {
        entry.commission += amount
      }

      totalCommission += amount
    }

    const sortedDates = Array.from(dateMap.entries()).sort(([a], [b]) => a.localeCompare(b))

    const volumeTrends = sortedDates.map(([date, v]) => ({
      date,
      transactions: v.transactions,
      revenue: v.revenue,
    }))

    const revenueVsCommission = sortedDates.map(([date, v]) => ({
      date,
      revenue: v.revenue,
      commission: v.commission,
    }))

    const topApis = Array.from(apiMap.entries())
      .map(([type, v]) => ({ type, transactions: v.transactions, revenue: v.revenue }))
      .sort((a, b) => b.transactions - a.transactions)
      .slice(0, 10)

    const summary = {
      totalRevenue,
      totalCommission,
      totalTransactions,
      avgTransactionValue: totalTransactions > 0 ? totalRevenue / totalTransactions : 0,
    }

    return NextResponse.json({
      volumeTrends,
      revenueVsCommission,
      topApis,
      summary,
    })
  } catch (err: any) {
    console.error('[Partner Analytics] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
