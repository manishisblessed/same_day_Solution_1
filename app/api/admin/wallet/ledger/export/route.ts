import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getPlatformRevenueWalletConfig } from '@/lib/wallet/platform-revenue-wallet'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/wallet/ledger/export
 * Export wallet ledger as CSV or Excel (admin only).
 * Query params:
 * - format: csv | excel (default: csv)
 * - user_id: filter by retailer_id
 * - wallet_type: primary | aeps | all
 * - scope: all | platform
 * - service_type: filter by service type
 * - transaction_type: filter by transaction type
 * - date_from, date_to: date range
 * - q: search description
 * - limit: max rows (default 10000)
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const format = sp.get('format') || 'csv'
    const limit = Math.min(50000, Math.max(1, parseInt(sp.get('limit') || '10000', 10)))
    const userId = sp.get('user_id')?.trim() || ''
    const walletType = sp.get('wallet_type') || 'primary'
    const scope = sp.get('scope') || 'all'
    const serviceType = sp.get('service_type')?.trim() || ''
    const transactionType = sp.get('transaction_type')?.trim() || ''
    const dateFrom = sp.get('date_from')?.trim() || ''
    const dateTo = sp.get('date_to')?.trim() || ''
    const q = sp.get('q')?.trim() || ''

    const supabase = getSupabaseAdmin()
    let query = supabase
      .from('wallet_ledger')
      .select('id, retailer_id, user_role, wallet_type, fund_category, service_type, transaction_type, credit, debit, opening_balance, closing_balance, balance_after, description, reference_id, status, created_at')

    if (scope === 'platform') {
      const cfg = getPlatformRevenueWalletConfig()
      if (!cfg) {
        return NextResponse.json({ error: 'Platform revenue wallet not configured' }, { status: 400 })
      }
      query = query.eq('retailer_id', cfg.revenueUserId)
    } else if (userId) {
      query = query.eq('retailer_id', userId)
    }

    if (walletType && walletType !== 'all') {
      query = query.eq('wallet_type', walletType)
    }
    if (serviceType && serviceType !== 'all') {
      query = query.eq('service_type', serviceType)
    }
    if (transactionType && transactionType !== 'all') {
      query = query.eq('transaction_type', transactionType)
    }
    if (dateFrom) {
      query = query.gte('created_at', `${dateFrom}T00:00:00`)
    }
    if (dateTo) {
      query = query.lte('created_at', `${dateTo}T23:59:59`)
    }
    if (q) {
      query = query.ilike('description', `%${q.replace(/%/g, '\\%')}%`)
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)

    if (error) {
      console.error('[admin/wallet/ledger/export]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const entries = data || []

    if (format === 'excel') {
      // Generate Excel (XLSX) using simple XML spreadsheet format
      const xmlRows = entries.map((e: any) => {
        const credit = Number(e.credit) || 0
        const debit = Number(e.debit) || 0
        const balance = Number(e.closing_balance ?? e.balance_after ?? 0)
        return `<Row>
          <Cell><Data ss:Type="String">${escapeXml(formatDate(e.created_at))}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.transaction_type || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.service_type || '')}</Data></Cell>
          <Cell><Data ss:Type="Number">${credit}</Data></Cell>
          <Cell><Data ss:Type="Number">${debit}</Data></Cell>
          <Cell><Data ss:Type="Number">${balance}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.status || '')}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(e.description || e.reference_id || '')}</Data></Cell>
        </Row>`
      }).join('\n')

      const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Revenue Wallet Statement">
    <Table>
      <Row>
        <Cell><Data ss:Type="String">Date &amp; Time</Data></Cell>
        <Cell><Data ss:Type="String">Transaction Type</Data></Cell>
        <Cell><Data ss:Type="String">Service</Data></Cell>
        <Cell><Data ss:Type="String">Credit (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Debit (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Balance (₹)</Data></Cell>
        <Cell><Data ss:Type="String">Status</Data></Cell>
        <Cell><Data ss:Type="String">Description</Data></Cell>
      </Row>
      ${xmlRows}
    </Table>
  </Worksheet>
</Workbook>`

      return new NextResponse(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.ms-excel',
          'Content-Disposition': `attachment; filename="revenue-wallet-statement-${new Date().toISOString().split('T')[0]}.xls"`,
        },
      })
    }

    // Default: CSV format
    const csvHeader = 'Date & Time,Transaction Type,Service,Credit (₹),Debit (₹),Balance (₹),Status,Description\n'
    const csvRows = entries.map((e: any) => {
      const credit = Number(e.credit) || 0
      const debit = Number(e.debit) || 0
      const balance = Number(e.closing_balance ?? e.balance_after ?? 0)
      return [
        `"${formatDate(e.created_at)}"`,
        `"${escapeCsv(e.transaction_type || '')}"`,
        `"${escapeCsv(e.service_type || '')}"`,
        credit.toFixed(2),
        debit.toFixed(2),
        balance.toFixed(2),
        `"${escapeCsv(e.status || '')}"`,
        `"${escapeCsv(e.description || e.reference_id || '')}"`,
      ].join(',')
    }).join('\n')

    const csv = csvHeader + csvRows

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="revenue-wallet-statement-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    })
  } catch (e: any) {
    console.error('[admin/wallet/ledger/export]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
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
