import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { resolveDownline, downlineToIdSet, isPrivilegedRole } from '@/lib/security/downline'
import { getDailyUserReport } from '@/lib/reports/daily'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/daily?date=YYYY-MM-DD&role=&q=&format=json|csv
 * Per-user daily report (Opening/Push/Pull/Credit/Debit/Commission/Closing).
 *  - admin/finance: all users.
 *  - MD/DT: own downline only.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const sp = request.nextUrl.searchParams
    const date = (sp.get('date') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date (expected YYYY-MM-DD)' }, { status: 400 })
    }
    const roleFilter = sp.get('role')?.trim() || ''
    const q = sp.get('q')?.trim().toLowerCase() || ''
    const format = sp.get('format')?.trim() || 'json'

    const supabase = getSupabaseAdmin()

    // Scope resolution.
    let scopeIds: string[] | null = null
    if (!isPrivilegedRole(user.role)) {
      const downline = await resolveDownline(supabase, user)
      scopeIds = downlineToIdSet(downline, user.partner_id)
      if (scopeIds.length === 0) {
        return NextResponse.json({ success: true, date, rows: [], totals: emptyTotals() })
      }
    }

    const report = await getDailyUserReport(supabase, date, scopeIds)

    let rows = report.rows
    if (roleFilter) rows = rows.filter((r) => r.user_role === roleFilter)
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.user_id.toLowerCase().includes(q))

    if (format === 'csv') {
      const header = [
        'User ID', 'Name', 'Role', 'Opening', 'Push', 'Pull', 'Credit (Settlement)', 'Refunds', 'Commission', 'Total Credit', 'Debit', 'Closing', 'Recon Delta', 'Txns',
      ].join(',')
      const body = rows
        .map((r) => {
          const settlement = Number((r.credit - r.push - r.refunds - r.commission).toFixed(2))
          return [
            r.user_id,
            `"${r.name.replace(/"/g, '""')}"`,
            r.user_role,
            r.opening.toFixed(2),
            r.push.toFixed(2),
            r.pull.toFixed(2),
            settlement.toFixed(2),
            r.refunds.toFixed(2),
            r.commission.toFixed(2),
            r.credit.toFixed(2),
            r.debit.toFixed(2),
            r.closing.toFixed(2),
            r.reconDelta.toFixed(2),
            r.txnCount,
          ].join(',')
        })
        .join('\n')
      return new NextResponse('\uFEFF' + header + '\n' + body, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="daily-report-${date}.csv"`,
        },
      })
    }

    return NextResponse.json({
      success: true,
      date,
      rows,
      totals: report.rows === rows ? report.totals : recomputeTotals(rows),
      source: report.source,
    })
  } catch (error: any) {
    console.error('[reports/daily] error:', error)
    return NextResponse.json({ error: error.message || 'Failed to build report' }, { status: 500 })
  }
}

function emptyTotals() {
  return { opening: 0, push: 0, pull: 0, credit: 0, refunds: 0, debit: 0, commission: 0, closing: 0, reconDelta: 0, users: 0 }
}

function recomputeTotals(rows: any[]) {
  const t = emptyTotals()
  t.users = rows.length
  for (const r of rows) {
    t.opening += r.opening
    t.push += r.push
    t.pull += r.pull
    t.credit += r.credit
    t.refunds += r.refunds
    t.debit += r.debit
    t.commission += r.commission
    t.closing += r.closing
    t.reconDelta += r.reconDelta
  }
  for (const k of Object.keys(t) as (keyof typeof t)[]) {
    if (k !== 'users') t[k] = Number((t[k] as number).toFixed(2))
  }
  return t
}
