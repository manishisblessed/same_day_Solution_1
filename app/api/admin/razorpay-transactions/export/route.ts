import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/razorpay-transactions/export
 * Export Razorpay POS transactions in CSV, PDF (HTML), or ZIP format
 * 
 * Query Parameters:
 * - format: 'csv' | 'pdf' | 'zip' (required)
 * - status: Filter by status (CAPTURED, FAILED, PENDING)
 * - date_from / date_to: Date range filter
 * - payment_mode: Filter by payment mode
 * - search: Search across txn_id, rrn, tid, mid, customer_name
 * - settlement_status: Filter by settlement status
 * - card_brand: Filter by card brand
 */
export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user: admin, method } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const format = searchParams.get('format') || 'csv'
    const statusFilter = searchParams.get('status')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')
    const paymentMode = searchParams.get('payment_mode')
    const searchQuery = searchParams.get('search')
    const settlementFilter = searchParams.get('settlement_status')
    const cardBrand = searchParams.get('card_brand')
    const merchantSlug = searchParams.get('merchant_slug') // all | ashvam | teachway | newscenaric | lagoon

    // Build query - fetch all matching transactions (up to 10000 for export)
    let query = supabase
      .from('razorpay_pos_transactions')
      .select('txn_id, amount, payment_mode, display_status, status, transaction_time, tid, device_serial, merchant_name, merchant_slug, customer_name, payer_name, username, txn_type, auth_code, card_number, issuing_bank, card_classification, mid_code, card_brand, card_type, currency, rrn, external_ref, settlement_status, settled_on, receipt_url, posting_date')
      .order('transaction_time', { ascending: false, nullsFirst: false })
      .limit(10000)

    // Apply company filter
    if (merchantSlug && merchantSlug !== 'all') {
      if (merchantSlug === 'ashvam') {
        query = query.or('merchant_slug.eq.ashvam,merchant_slug.is.null')
      } else {
        query = query.eq('merchant_slug', merchantSlug)
      }
    }

    // Apply filters
    if (statusFilter && ['CAPTURED', 'FAILED', 'PENDING'].includes(statusFilter.toUpperCase())) {
      const displayStatus = statusFilter.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : statusFilter.toUpperCase()
      query = query.eq('display_status', displayStatus)
    }

    if (dateFrom) {
      const fromDate = dateFrom.includes('T') ? dateFrom : `${dateFrom}T00:00:00`
      query = query.gte('transaction_time', fromDate)
    }
    if (dateTo) {
      const toDate = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59`
      query = query.lte('transaction_time', toDate)
    }

    if (paymentMode && paymentMode !== 'all') {
      query = query.eq('payment_mode', paymentMode.toUpperCase())
    }

    if (settlementFilter && settlementFilter !== 'all') {
      query = query.eq('settlement_status', settlementFilter.toUpperCase())
    }

    if (cardBrand && cardBrand !== 'all') {
      query = query.eq('card_brand', cardBrand.toUpperCase())
    }

    if (searchQuery && searchQuery.trim()) {
      const s = searchQuery.trim()
      query = query.or(`txn_id.ilike.%${s}%,rrn.ilike.%${s}%,tid.ilike.%${s}%,mid_code.ilike.%${s}%,customer_name.ilike.%${s}%,username.ilike.%${s}%,card_number.ilike.%${s}%`)
    }

    const { data: transactions, error } = await query

    if (error) {
      return NextResponse.json({ error: 'Database error', message: error.message }, { status: 500 })
    }

    const rows = (transactions || []).map((txn: any) => ({
      'Transaction ID': txn.txn_id || '',
      'Date & Time': txn.transaction_time ? new Date(txn.transaction_time).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '',
      'Amount (₹)': txn.amount || 0,
      'Currency': txn.currency || 'INR',
      'Payment Mode': txn.payment_mode || '',
      'Status': txn.display_status === 'SUCCESS' ? 'CAPTURED' : (txn.display_status || txn.status || 'PENDING'),
      'Settlement Status': txn.settlement_status || 'PENDING',
      'Consumer Name': txn.customer_name || txn.payer_name || '',
      'Username': txn.username || '',
      'TID': txn.tid || '',
      'MID': txn.mid_code || '',
      'Card Number': txn.card_number || '',
      'Card Brand': txn.card_brand || '',
      'Card Type': txn.card_type || '',
      'Issuing Bank': txn.issuing_bank || '',
      'Card Classification': txn.card_classification || '',
      'RRN': txn.rrn || '',
      'Auth Code': txn.auth_code || '',
      'External Ref': txn.external_ref || '',
      'Device Serial': txn.device_serial || '',
      'Settled On': txn.settled_on ? new Date(txn.settled_on).toLocaleString('en-IN') : '',
    }))

    const headers = Object.keys(rows[0] || {
      'Transaction ID': '', 'Date & Time': '', 'Amount (₹)': 0, 'Currency': '', 'Payment Mode': '',
      'Status': '', 'Settlement Status': '', 'Consumer Name': '', 'Username': '', 'TID': '', 'MID': '',
      'Card Number': '', 'Card Brand': '', 'Card Type': '', 'Issuing Bank': '', 'Card Classification': '',
      'RRN': '', 'Auth Code': '', 'External Ref': '', 'Device Serial': '', 'Settled On': ''
    })

    const escapeCsv = (val: any) => {
      const str = String(val ?? '')
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const timestamp = new Date().toISOString().split('T')[0]
    const totalAmount = rows.reduce((sum, r) => sum + (Number(r['Amount (₹)']) || 0), 0)

    if (format === 'csv') {
      const csvLines = [
        headers.map(escapeCsv).join(','),
        ...rows.map(row => headers.map(h => escapeCsv((row as any)[h])).join(','))
      ]
      const csvContent = csvLines.join('\n')

      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="razorpay_transactions_${timestamp}.csv"`
        }
      })
    }

    if (format === 'pdf') {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Razorpay Transactions Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 20px; color: #333; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 3px solid #2563eb; }
    .header h1 { color: #1e40af; font-size: 22px; }
    .header .logo { font-size: 14px; color: #64748b; }
    .meta { display: flex; gap: 30px; margin-bottom: 15px; padding: 10px 15px; background: #f8fafc; border-radius: 8px; font-size: 12px; }
    .meta span { color: #64748b; }
    .meta strong { color: #1e293b; }
    .summary { display: flex; gap: 20px; margin-bottom: 20px; }
    .summary-card { flex: 1; padding: 12px 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
    .summary-card .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .summary-card .value { font-size: 20px; font-weight: 700; color: #1e293b; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { background: #1e40af; color: #fff; padding: 8px 6px; text-align: left; font-weight: 600; white-space: nowrap; }
    td { padding: 6px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
    tr:nth-child(even) { background: #f8fafc; }
    tr:hover { background: #eff6ff; }
    .status-captured { color: #16a34a; font-weight: 600; }
    .status-failed { color: #dc2626; font-weight: 600; }
    .status-pending { color: #ca8a04; font-weight: 600; }
    .amount { text-align: right; font-weight: 600; }
    .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
    @media print { 
      body { margin: 10px; } 
      .summary-card { border: 1px solid #ccc; }
      @page { size: landscape; margin: 10mm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Razorpay POS Transactions Report</h1>
    <div class="logo">Same Day Solution Pvt. Ltd.</div>
  </div>
  <div class="meta">
    <div><span>Generated:</span> <strong>${new Date().toLocaleString('en-IN')}</strong></div>
    <div><span>Total Records:</span> <strong>${rows.length}</strong></div>
    ${dateFrom ? `<div><span>From:</span> <strong>${dateFrom}</strong></div>` : ''}
    ${dateTo ? `<div><span>To:</span> <strong>${dateTo}</strong></div>` : ''}
    ${statusFilter ? `<div><span>Status:</span> <strong>${statusFilter}</strong></div>` : ''}
    ${paymentMode && paymentMode !== 'all' ? `<div><span>Payment Mode:</span> <strong>${paymentMode}</strong></div>` : ''}
  </div>
  <div class="summary">
    <div class="summary-card">
      <div class="label">Total Transactions</div>
      <div class="value">${rows.length}</div>
    </div>
    <div class="summary-card">
      <div class="label">Total Amount</div>
      <div class="value">₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
    </div>
    <div class="summary-card">
      <div class="label">Captured</div>
      <div class="value" style="color: #16a34a">${rows.filter(r => r['Status'] === 'CAPTURED').length}</div>
    </div>
    <div class="summary-card">
      <div class="label">Failed</div>
      <div class="value" style="color: #dc2626">${rows.filter(r => r['Status'] === 'FAILED').length}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        ${headers.map(h => `<th>${h}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows.map((row, i) => {
        const statusClass = row['Status'] === 'CAPTURED' ? 'status-captured' : row['Status'] === 'FAILED' ? 'status-failed' : 'status-pending'
        return `<tr>
          <td>${i + 1}</td>
          ${headers.map(h => {
            if (h === 'Status') return `<td class="${statusClass}">${(row as any)[h]}</td>`
            if (h === 'Amount (₹)') return `<td class="amount">₹${Number((row as any)[h]).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>`
            return `<td>${String((row as any)[h] || '-')}</td>`
          }).join('')}
        </tr>`
      }).join('')}
    </tbody>
  </table>
  <div class="footer">
    Report generated by Same Day Solution Pvt. Ltd. &mdash; ${new Date().toLocaleString('en-IN')}
  </div>
</body>
</html>`.trim()

      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="razorpay_transactions_${timestamp}.html"`
        }
      })
    }

    if (format === 'zip') {
      // Generate CSV content
      const csvLines = [
        headers.map(escapeCsv).join(','),
        ...rows.map(row => headers.map(h => escapeCsv((row as any)[h])).join(','))
      ]
      const csvContent = csvLines.join('\n')

      // Generate JSON content
      const jsonContent = JSON.stringify({
        report: 'Razorpay POS Transactions',
        generated_at: new Date().toISOString(),
        filters: { status: statusFilter, date_from: dateFrom, date_to: dateTo, payment_mode: paymentMode, search: searchQuery },
        summary: {
          total_transactions: rows.length,
          total_amount: totalAmount,
          captured: rows.filter(r => r['Status'] === 'CAPTURED').length,
          failed: rows.filter(r => r['Status'] === 'FAILED').length,
          pending: rows.filter(r => r['Status'] === 'PENDING').length,
        },
        transactions: rows
      }, null, 2)

      // Return both files as JSON (client will create ZIP)
      return NextResponse.json({
        success: true,
        files: {
          csv: {
            filename: `razorpay_transactions_${timestamp}.csv`,
            content: csvContent,
            type: 'text/csv'
          },
          json: {
            filename: `razorpay_transactions_${timestamp}.json`,
            content: jsonContent,
            type: 'application/json'
          }
        },
        summary: {
          total_transactions: rows.length,
          total_amount: totalAmount,
        }
      })
    }

    return NextResponse.json({ error: 'Invalid format. Use csv, pdf, or zip.' }, { status: 400 })

  } catch (error: any) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Internal server error', message: error.message }, { status: 500 })
  }
}

