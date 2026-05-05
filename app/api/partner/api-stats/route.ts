import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user?.partner_id || user.role !== 'partner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const partnerId = user.partner_id
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || '30d'
    const days = PERIOD_DAYS[period] ?? 30

    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceISO = since.toISOString()

    const [ledgerRes, apiKeysRes, partnerRes] = await Promise.all([
      supabase
        .from('partner_wallet_ledger')
        .select('id, status, transaction_type, created_at, credit, debit')
        .eq('partner_id', partnerId)
        .gte('created_at', sinceISO)
        .order('created_at', { ascending: true }),

      supabase
        .from('partner_api_keys')
        .select('id, is_active')
        .eq('partner_id', partnerId),

      supabase
        .from('partners')
        .select('webhook_url')
        .eq('id', partnerId)
        .maybeSingle(),
    ])

    if (ledgerRes.error) {
      console.error('[api-stats] ledger query', ledgerRes.error)
      return NextResponse.json({ error: ledgerRes.error.message }, { status: 500 })
    }
    if (apiKeysRes.error) {
      console.error('[api-stats] api_keys query', apiKeysRes.error)
      return NextResponse.json({ error: apiKeysRes.error.message }, { status: 500 })
    }

    const rows = ledgerRes.data || []
    const totalApiCalls = rows.length
    const successCount = rows.filter(r => r.status === 'completed').length
    const failureCount = rows.filter(r => r.status === 'failed').length
    const errorRate = totalApiCalls > 0
      ? Math.round((failureCount / totalApiCalls) * 10000) / 100
      : 0

    const dailyMap = new Map<string, number>()
    for (const row of rows) {
      const date = row.created_at.slice(0, 10)
      dailyMap.set(date, (dailyMap.get(date) || 0) + 1)
    }
    const dailyUsage = Array.from(dailyMap.entries()).map(([date, count]) => ({
      date,
      count,
    }))

    const typeMap = new Map<string, number>()
    for (const row of rows) {
      const type = row.transaction_type || 'unknown'
      typeMap.set(type, (typeMap.get(type) || 0) + 1)
    }
    const usageByType = Array.from(typeMap.entries()).map(([type, count]) => ({
      type,
      count,
    }))

    const keys = apiKeysRes.data || []
    const apiKeys = {
      total: keys.length,
      active: keys.filter(k => k.is_active).length,
    }

    return NextResponse.json({
      totalApiCalls,
      successCount,
      failureCount,
      errorRate,
      dailyUsage,
      usageByType,
      apiKeys,
      webhookUrl: partnerRes.data?.webhook_url || null,
    })
  } catch (e: any) {
    console.error('[api-stats] GET', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
