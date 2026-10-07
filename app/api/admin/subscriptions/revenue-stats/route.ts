import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

const IST_OFFSET_MIN = 330 // Asia/Kolkata = UTC+5:30

/** Wall-clock parts (year/month/day) for "now" in IST. */
function istParts(base: Date) {
  const ist = new Date(base.getTime() + IST_OFFSET_MIN * 60_000)
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate() }
}

/** Convert an IST wall-clock instant (y, m, d, h, min) to the equivalent UTC Date. */
function istToUtc(y: number, m: number, d: number, h = 0, min = 0) {
  return new Date(Date.UTC(y, m, d, h, min, 0) - IST_OFFSET_MIN * 60_000)
}

/** YYYY-MM-DD for a UTC instant, expressed in IST. */
function istDateKey(iso: string) {
  const ist = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000)
  const y = ist.getUTCFullYear()
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0')
  const d = String(ist.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * GET /api/admin/subscriptions/revenue-stats
 *
 * Period revenue for the platform revenue wallet, computed non-destructively
 * from wallet_ledger. Month-to-date "resets to 0 on the 1st" (IST) so the
 * operations team can read per-day revenue without touching the real balance.
 *
 * Query:
 *  - month=YYYY-MM  (optional; defaults to the current IST month)
 *
 * Returns { configured, month:{...}, today:{...}, avgPerDay, daysElapsed, daily:[...] }
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
    const revenueUserRole = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'
    if (!revenueUserId || !['retailer', 'distributor', 'master_distributor'].includes(revenueUserRole)) {
      return NextResponse.json({
        configured: false,
        message: 'Set SUBSCRIPTION_REVENUE_USER_ID to enable revenue statistics.',
      })
    }

    const now = new Date()
    const nowParts = istParts(now)

    // Resolve the target month (IST). Defaults to the current month.
    let year = nowParts.y
    let month = nowParts.m // 0-indexed
    const monthParam = request.nextUrl.searchParams.get('month')?.trim()
    const monthMatch = monthParam?.match(/^(\d{4})-(\d{2})$/)
    if (monthMatch) {
      year = parseInt(monthMatch[1], 10)
      month = parseInt(monthMatch[2], 10) - 1
      if (month < 0 || month > 11) {
        return NextResponse.json({ error: 'Invalid month; expected YYYY-MM' }, { status: 400 })
      }
    }

    const monthStartUtc = istToUtc(year, month, 1) // 1st 00:00 IST
    const nextMonthStartUtc = istToUtc(year, month + 1, 1) // next month 1st 00:00 IST
    const isCurrentMonth = year === nowParts.y && month === nowParts.m
    // For the current month we only need data up to "now"; past months use full range.
    const rangeEndUtc = isCurrentMonth ? now : nextMonthStartUtc
    const todayStartUtc = istToUtc(nowParts.y, nowParts.m, nowParts.d) // today 00:00 IST

    const supabase = getSupabaseAdmin()

    // Sum server-side by paging completed ledger rows for the period.
    // Month-scoped, so the row count stays bounded (a handful of pages at most).
    const PAGE = 1000
    let offset = 0
    let monthCredit = 0
    let monthDebit = 0
    let todayCredit = 0
    let todayDebit = 0
    const dailyMap = new Map<string, { credit: number; debit: number }>()

    // Pre-seed every day of the month up to the range end with zeros so
    // "no-transaction" days still appear (and the 1st reads 0 correctly).
    for (
      let cursor = new Date(monthStartUtc);
      cursor < rangeEndUtc;
      cursor = new Date(cursor.getTime() + 24 * 60 * 60_000)
    ) {
      dailyMap.set(istDateKey(cursor.toISOString()), { credit: 0, debit: 0 })
    }

    // Safety cap: 100 pages (100k rows) — far beyond any realistic month.
    for (let guard = 0; guard < 100; guard++) {
      const { data, error } = await supabase
        .from('wallet_ledger')
        .select('credit, debit, created_at')
        .eq('retailer_id', revenueUserId)
        .eq('wallet_type', 'primary')
        .eq('status', 'completed')
        .gte('created_at', monthStartUtc.toISOString())
        .lt('created_at', rangeEndUtc.toISOString())
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE - 1)

      if (error) {
        return NextResponse.json({ configured: true, error: error.message }, { status: 500 })
      }

      const rows = data || []
      for (const r of rows) {
        const credit = Number(r.credit) || 0
        const debit = Number(r.debit) || 0
        const createdAt = new Date(r.created_at)

        monthCredit += credit
        monthDebit += debit

        if (isCurrentMonth && createdAt >= todayStartUtc) {
          todayCredit += credit
          todayDebit += debit
        }

        const key = istDateKey(r.created_at)
        const bucket = dailyMap.get(key) || { credit: 0, debit: 0 }
        bucket.credit += credit
        bucket.debit += debit
        dailyMap.set(key, bucket)
      }

      if (rows.length < PAGE) break
      offset += PAGE
    }

    // Optional: cumulative revenue strictly before a cut-off date (IST), e.g. before=2026-10-01.
    let before: { cutoff: string; credit: number; debit: number; net: number } | null = null
    const beforeMatch = request.nextUrl.searchParams.get('before')?.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (beforeMatch) {
      const cutoffUtc = istToUtc(parseInt(beforeMatch[1], 10), parseInt(beforeMatch[2], 10) - 1, parseInt(beforeMatch[3], 10))
      let bCredit = 0
      let bDebit = 0
      let bOffset = 0
      for (let guard = 0; guard < 500; guard++) {
        const { data, error } = await supabase
          .from('wallet_ledger')
          .select('credit, debit')
          .eq('retailer_id', revenueUserId)
          .eq('wallet_type', 'primary')
          .eq('status', 'completed')
          .lt('created_at', cutoffUtc.toISOString())
          .order('created_at', { ascending: true })
          .range(bOffset, bOffset + PAGE - 1)
        if (error) return NextResponse.json({ configured: true, error: error.message }, { status: 500 })
        const rows = data || []
        for (const r of rows) {
          bCredit += Number(r.credit) || 0
          bDebit += Number(r.debit) || 0
        }
        if (rows.length < PAGE) break
        bOffset += PAGE
      }
      before = { cutoff: beforeMatch[0], credit: bCredit, debit: bDebit, net: bCredit - bDebit }
    }

    const daysElapsed = isCurrentMonth
      ? nowParts.d
      : new Date(Date.UTC(year, month + 1, 0)).getUTCDate() // days in that month
    const monthNet = monthCredit - monthDebit
    const avgPerDay = daysElapsed > 0 ? monthNet / daysElapsed : 0

    const daily = [...dailyMap.entries()]
      .map(([date, v]) => ({ date, credit: v.credit, debit: v.debit, net: v.credit - v.debit }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)) // most recent first

    return NextResponse.json({
      configured: true,
      user_id: revenueUserId,
      month: {
        year,
        month: month + 1,
        from: monthStartUtc.toISOString(),
        to: rangeEndUtc.toISOString(),
        credit: monthCredit,
        debit: monthDebit,
        net: monthNet,
      },
      today: {
        date: `${nowParts.y}-${String(nowParts.m + 1).padStart(2, '0')}-${String(nowParts.d).padStart(2, '0')}`,
        credit: todayCredit,
        debit: todayDebit,
        net: todayCredit - todayDebit,
        applicable: isCurrentMonth,
      },
      before,
      daysElapsed,
      avgPerDay,
      daily,
    })
  } catch (e: any) {
    console.error('[Revenue stats]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
