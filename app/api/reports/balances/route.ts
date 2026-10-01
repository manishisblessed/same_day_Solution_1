import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { isPrivilegedRole } from '@/lib/security/downline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/balances?date=YYYY-MM-DD&role=&q=&format=json|csv
 * All-user opening & closing wallet balance for a day.
 * Uses the all_user_balances() RPC which includes users with no activity.
 * Admin/finance: all users. Non-privileged callers are blocked.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
    }
    if (!isPrivilegedRole(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const date = (
      sp.get('date') ||
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    ).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date (expected YYYY-MM-DD)' }, { status: 400 })
    }
    const roleFilter = sp.get('role')?.trim() || null
    const q = sp.get('q')?.trim() || null
    const format = sp.get('format')?.trim() || 'json'

    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase.rpc('all_user_balances', {
      p_date: date,
      p_role: roleFilter || null,
      p_q: q || null,
    })

    if (error) {
      console.error('[reports/balances] RPC error:', error.message)
      return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 })
    }

    const rows = (data || []).map((r: any) => ({
      user_id: r.user_id,
      user_role: r.user_role,
      name: r.user_name || r.user_id,
      opening: Number(r.opening) || 0,
      closing: Number(r.closing) || 0,
    }))

    const totals = {
      opening: 0,
      closing: 0,
      users: rows.length,
    }
    for (const r of rows) {
      totals.opening += r.opening
      totals.closing += r.closing
    }
    totals.opening = Number(totals.opening.toFixed(2))
    totals.closing = Number(totals.closing.toFixed(2))

    if (format === 'csv') {
      const header = ['User ID', 'Name', 'Role', 'Opening', 'Closing', 'Net Change'].join(',')
      const body = rows
        .map((r: any) => [
          r.user_id,
          `"${(r.name || '').replace(/"/g, '""')}"`,
          r.user_role,
          r.opening.toFixed(2),
          r.closing.toFixed(2),
          (r.closing - r.opening).toFixed(2),
        ].join(','))
        .join('\n')
      return new NextResponse('\uFEFF' + header + '\n' + body, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="balances-${date}.csv"`,
        },
      })
    }

    return NextResponse.json({ success: true, date, rows, totals })
  } catch (error: any) {
    console.error('[reports/balances] error:', error)
    return NextResponse.json({ error: error.message || 'Failed to build report' }, { status: 500 })
  }
}
