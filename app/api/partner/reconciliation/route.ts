import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SETTLEMENT_TYPES = ['settlement', 'pos_settlement', 'withdrawal']
const TRANSACTION_TYPES = ['credit', 'debit', 'bbps', 'aeps', 'pos', 'commission']

function formatGroupKey(dateStr: string, groupBy: string): string {
  if (groupBy === 'monthly') return dateStr.slice(0, 7)
  return dateStr.slice(0, 10)
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user?.partner_id || user.role !== 'partner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const partnerId = user.partner_id
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    const groupBy = searchParams.get('group_by') || 'daily'

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'start_date and end_date are required' },
        { status: 400 }
      )
    }

    const startISO = new Date(startDate).toISOString()
    const endISO = new Date(endDate + 'T23:59:59.999Z').toISOString()

    const [settlementRes, transactionRes] = await Promise.all([
      supabase
        .from('partner_wallet_ledger')
        .select('id, partner_id, transaction_type, status, created_at, credit, debit, closing_balance, description, reference_id')
        .eq('partner_id', partnerId)
        .in('transaction_type', SETTLEMENT_TYPES)
        .gte('created_at', startISO)
        .lte('created_at', endISO)
        .order('created_at', { ascending: true }),

      supabase
        .from('partner_wallet_ledger')
        .select('id, transaction_type, status, created_at, credit, debit')
        .eq('partner_id', partnerId)
        .in('transaction_type', TRANSACTION_TYPES)
        .gte('created_at', startISO)
        .lte('created_at', endISO)
        .order('created_at', { ascending: true }),
    ])

    if (settlementRes.error) {
      console.error('[reconciliation] settlement query', settlementRes.error)
      return NextResponse.json({ error: settlementRes.error.message }, { status: 500 })
    }
    if (transactionRes.error) {
      console.error('[reconciliation] transaction query', transactionRes.error)
      return NextResponse.json({ error: transactionRes.error.message }, { status: 500 })
    }

    const settlements = settlementRes.data || []
    const transactionRows = transactionRes.data || []

    const txnGroupMap = new Map<string, { totalCredit: number; totalDebit: number; transactionCount: number }>()
    for (const row of transactionRows) {
      const key = formatGroupKey(row.created_at, groupBy)
      const entry = txnGroupMap.get(key) || { totalCredit: 0, totalDebit: 0, transactionCount: 0 }
      entry.totalCredit += row.credit || 0
      entry.totalDebit += row.debit || 0
      entry.transactionCount += 1
      txnGroupMap.set(key, entry)
    }

    const transactions = Array.from(txnGroupMap.entries()).map(([date, data]) => ({
      date,
      totalCredit: Math.round(data.totalCredit * 100) / 100,
      totalDebit: Math.round(data.totalDebit * 100) / 100,
      transactionCount: data.transactionCount,
    }))

    const settlementGroupMap = new Map<string, number>()
    for (const row of settlements) {
      const key = formatGroupKey(row.created_at, groupBy)
      settlementGroupMap.set(key, (settlementGroupMap.get(key) || 0) + (row.debit || 0))
    }

    const allDates = new Set([...txnGroupMap.keys(), ...settlementGroupMap.keys()])
    const sortedDates = Array.from(allDates).sort()

    let matchedCount = 0
    const comparison = sortedDates.map(date => {
      const transactionTotal = Math.round((txnGroupMap.get(date)?.totalCredit || 0) * 100) / 100
      const settlementTotal = Math.round((settlementGroupMap.get(date) || 0) * 100) / 100
      const difference = Math.round((transactionTotal - settlementTotal) * 100) / 100
      const status = Math.abs(difference) <= 1 ? 'matched' : 'mismatch'
      if (status === 'matched') matchedCount++
      return { date, transactionTotal, settlementTotal, difference, status }
    })

    const totalTransactionAmount = Math.round(
      transactionRows.reduce((sum, r) => sum + (r.credit || 0), 0) * 100
    ) / 100
    const totalSettlementAmount = Math.round(
      settlements.reduce((sum, r) => sum + (r.debit || 0), 0) * 100
    ) / 100

    const summary = {
      totalTransactions: transactionRows.length,
      totalSettlements: settlements.length,
      totalTransactionAmount,
      totalSettlementAmount,
      netDifference: Math.round((totalTransactionAmount - totalSettlementAmount) * 100) / 100,
      matchRate: sortedDates.length > 0
        ? Math.round((matchedCount / sortedDates.length) * 10000) / 100
        : 100,
    }

    return NextResponse.json({
      settlements,
      transactions,
      comparison,
      summary,
    })
  } catch (e: any) {
    console.error('[reconciliation] GET', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
