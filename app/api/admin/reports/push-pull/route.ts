import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/reports/push-pull
 * Push/Pull report for a single user, sourced from wallet_ledger so it
 * captures pushes/pulls performed by admin, master distributor, AND distributor.
 *
 * Push/pull rows are identified by reference_id prefixes:
 *   ADMIN_PUSH_ / ADMIN_PULL_  -> admin (or MD via admin route)
 *   DIST_PUSH_  / DIST_PULL_   -> distributor
 * From the selected user's perspective: credit = push (funds in), debit = pull (funds out).
 *
 * Query params:
 *   user_id (required), action_type (push|pull|both),
 *   wallet_type, fund_category, date_from, date_to,
 *   page, limit, format (json|csv|excel)
 */

const REF_OR_FILTER =
  'reference_id.ilike.ADMIN_PUSH_%,reference_id.ilike.ADMIN_PULL_%,reference_id.ilike.DIST_PUSH_%,reference_id.ilike.DIST_PULL_%'

export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !isAdminOrFinance(user)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const userId = sp.get('user_id')?.trim() || ''
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    }

    const actionType = sp.get('action_type')?.trim() || '' // push | pull | ''(both)
    const walletType = sp.get('wallet_type')?.trim() || ''
    const fundCategory = sp.get('fund_category')?.trim() || ''
    const dateFrom = sp.get('date_from')?.trim() || ''
    const dateTo = sp.get('date_to')?.trim() || ''
    const format = sp.get('format')?.trim() || 'json'
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
    const limit = format === 'json'
      ? Math.min(100, Math.max(1, parseInt(sp.get('limit') || '25', 10) || 25))
      : Math.min(50000, parseInt(sp.get('limit') || '10000', 10) || 10000)

    const supabase = getSupabaseAdmin()

    const applyFilters = (q: any) => {
      q = q.eq('retailer_id', userId).or(REF_OR_FILTER)
      if (actionType === 'push') q = q.gt('credit', 0)
      else if (actionType === 'pull') q = q.gt('debit', 0)
      if (walletType && walletType !== 'all') q = q.eq('wallet_type', walletType)
      if (fundCategory) q = q.eq('fund_category', fundCategory)
      if (dateFrom) q = q.gte('created_at', `${dateFrom}T00:00:00`)
      if (dateTo) q = q.lte('created_at', `${dateTo}T23:59:59`)
      return q
    }

    const userName = await resolveTargetUserName(supabase, userId)

    if (format === 'json') {
      const baseQuery = supabase
        .from('wallet_ledger')
        .select(
          'id, retailer_id, user_role, wallet_type, fund_category, service_type, transaction_type, credit, debit, opening_balance, closing_balance, balance_after, description, reference_id, status, created_at',
          { count: 'exact' }
        )
      const from = (page - 1) * limit
      const { data, error, count } = await applyFilters(baseQuery)
        .order('created_at', { ascending: false })
        .range(from, from + limit - 1)

      if (error) {
        console.error('[push-pull report]', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      // Totals across full filtered set (not just this page)
      const totalsQuery = supabase.from('wallet_ledger').select('credit, debit')
      const { data: allRows, error: totalsErr } = await applyFilters(totalsQuery)
      if (totalsErr) {
        console.error('[push-pull report totals]', totalsErr)
      }
      let totalPush = 0, totalPull = 0
      for (const r of allRows || []) {
        totalPush += Number(r.credit) || 0
        totalPull += Number(r.debit) || 0
      }

      const entries = (data || []).map((r) => shapeRow(r, userName))

      return NextResponse.json({
        entries,
        total: count ?? 0,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil((count || 0) / limit)),
        summary: { totalPush, totalPull, net: totalPush - totalPull },
      })
    }

    // Export: CSV / Excel
    const exportQuery = supabase
      .from('wallet_ledger')
      .select(
        'id, retailer_id, user_role, wallet_type, fund_category, credit, debit, opening_balance, closing_balance, balance_after, description, reference_id, created_at'
      )
    const { data, error } = await applyFilters(exportQuery)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[push-pull export]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = (data || []).map((r) => shapeRow(r, userName))
    const fileDate = new Date().toISOString().split('T')[0]

    if (format === 'excel') {
      const xmlRows = rows.map((e) => `<Row>
          <Cell><Data ss:Type="String">${escapeXml(formatDate(e.created_at))}</Data></Cell>
          <Cell><Data ss:Type="String">${e.action_type === 'wallet_push' ? 'Push' : 'Pull'}</Data></Cell>
          <Cell><Data ss:Type="Number">${e.action_type === 'wallet_push' ? e.amount : 0}</Data></Cell>
          <Cell><Data ss:Type="Number">${e.action_type === 'wallet_pull' ? e.amount : 0}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.fund_category || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.wallet_type || 'primary')}</Data></Cell>
          <Cell><Data ss:Type="Number">${e.before_balance}</Data></Cell>
          <Cell><Data ss:Type="Number">${e.after_balance}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.performed_by)}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.remarks || '')}</Data></Cell>
        </Row>`).join('\n')

      const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Push Pull Report">
    <Table>
      <Row>
        <Cell><Data ss:Type="String">Date &amp; Time</Data></Cell>
        <Cell><Data ss:Type="String">Action</Data></Cell>
        <Cell><Data ss:Type="String">Push Amount (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Pull Amount (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Fund Category</Data></Cell>
        <Cell><Data ss:Type="String">Wallet</Data></Cell>
        <Cell><Data ss:Type="String">Before Balance (₹)</Data></Cell>
        <Cell><Data ss:Type="String">After Balance (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Performed By</Data></Cell>
        <Cell><Data ss:Type="String">Remarks</Data></Cell>
      </Row>
      ${xmlRows}
    </Table>
  </Worksheet>
</Workbook>`

      return new NextResponse(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.ms-excel',
          'Content-Disposition': `attachment; filename="push-pull-${userId}-${fileDate}.xls"`,
        },
      })
    }

    // CSV
    const csvHeader =
      'Date & Time,Action,Push Amount (₹),Pull Amount (₹),Fund Category,Wallet,Before Balance (₹),After Balance (₹),Performed By,Remarks\n'
    const csvRows = rows.map((e) => [
      `"${formatDate(e.created_at)}"`,
      e.action_type === 'wallet_push' ? 'Push' : 'Pull',
      e.action_type === 'wallet_push' ? e.amount.toFixed(2) : '0.00',
      e.action_type === 'wallet_pull' ? e.amount.toFixed(2) : '0.00',
      `"${escapeCsv(e.fund_category || '')}"`,
      `"${escapeCsv(e.wallet_type || 'primary')}"`,
      e.before_balance.toFixed(2),
      e.after_balance.toFixed(2),
      `"${escapeCsv(e.performed_by)}"`,
      `"${escapeCsv(e.remarks || '')}"`,
    ].join(',')).join('\n')

    return new NextResponse('\uFEFF' + csvHeader + csvRows, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="push-pull-${userId}-${fileDate}.csv"`,
      },
    })
  } catch (e: any) {
    console.error('[push-pull report]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}

function shapeRow(r: any, userName: string) {
  const credit = Number(r.credit) || 0
  const debit = Number(r.debit) || 0
  const isPush = credit > 0
  return {
    id: r.id,
    created_at: r.created_at,
    action_type: isPush ? 'wallet_push' : 'wallet_pull',
    amount: isPush ? credit : debit,
    fund_category: r.fund_category || '',
    wallet_type: r.wallet_type || 'primary',
    before_balance: Number(r.opening_balance) || 0,
    after_balance: Number(r.closing_balance ?? r.balance_after ?? 0),
    performed_by: derivePerformer(r.reference_id, r.description),
    remarks: r.description || '',
    user_name: userName,
    reference_id: r.reference_id || '',
  }
}

function derivePerformer(referenceId: string | null, description: string | null): string {
  const ref = (referenceId || '').toUpperCase()
  const desc = (description || '').toLowerCase()
  if (ref.startsWith('DIST_')) return 'Distributor'
  if (ref.startsWith('ADMIN_')) {
    if (desc.includes('master distributor')) return 'Master Distributor'
    return 'Admin'
  }
  return 'Admin'
}

async function resolveTargetUserName(supabase: any, userId: string): Promise<string> {
  const tables = ['retailers', 'distributors', 'master_distributors'] as const
  for (const table of tables) {
    const { data } = await supabase
      .from(table)
      .select('name, business_name')
      .eq('partner_id', userId)
      .maybeSingle()
    if (data) return data.name || data.business_name || userId
  }
  return userId
}

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoString
  }
}

function escapeCsv(str: string): string {
  return str.replace(/"/g, '""')
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
