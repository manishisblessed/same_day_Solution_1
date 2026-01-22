import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders } from '@/lib/cors'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    // Get current user with fallback
    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[Reports Transactions] Auth:', method, '|', user?.email || 'none')
    
    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)

    // Extract filters (support both date_from/date_to and start/end)
    const dateFrom = searchParams.get('date_from') || searchParams.get('start')
    const dateTo = searchParams.get('date_to') || searchParams.get('end')
    const service = searchParams.get('service') // bbps, aeps, settlement, pos
    const status = searchParams.get('status')
    const user_id = searchParams.get('user_id')
    const limit = parseInt(searchParams.get('limit') || '10000') // Increased for exports
    const offset = parseInt(searchParams.get('offset') || '0')
    const format = searchParams.get('format') || 'json' // json, csv, pdf, zip

    let results: any[] = []
    let total = 0

    // Fetch transactions based on service type
    if (!service || service === 'bbps') {
      let bbpsQuery = supabase
        .from('bbps_transactions')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (user.role === 'retailer' && user.partner_id) {
        bbpsQuery = bbpsQuery.eq('retailer_id', user.partner_id)
      }

      if (dateFrom) bbpsQuery = bbpsQuery.gte('created_at', dateFrom)
      if (dateTo) bbpsQuery = bbpsQuery.lte('created_at', dateTo)
      if (status) bbpsQuery = bbpsQuery.eq('status', status)
      if (user_id) bbpsQuery = bbpsQuery.eq('retailer_id', user_id)

      bbpsQuery = bbpsQuery.range(offset, offset + limit - 1)

      const { data: bbpsData, count: bbpsCount } = await bbpsQuery

      if (bbpsData) {
        results = results.concat(bbpsData.map(tx => ({
          ...tx,
          service_type: 'bbps',
          transaction_id: tx.id
        })))
        total += bbpsCount || 0
      }
    }

    if (!service || service === 'aeps') {
      let aepsQuery = supabase
        .from('aeps_transactions')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (user.role === 'retailer' && user.partner_id) {
        aepsQuery = aepsQuery.eq('user_id', user.partner_id)
      }

      if (dateFrom) aepsQuery = aepsQuery.gte('created_at', dateFrom)
      if (dateTo) aepsQuery = aepsQuery.lte('created_at', dateTo)
      if (status) aepsQuery = aepsQuery.eq('status', status)
      if (user_id) aepsQuery = aepsQuery.eq('user_id', user_id)

      aepsQuery = aepsQuery.range(offset, offset + limit - 1)

      const { data: aepsData, count: aepsCount } = await aepsQuery

      if (aepsData) {
        results = results.concat(aepsData.map(tx => ({
          ...tx,
          service_type: 'aeps',
          transaction_id: tx.id
        })))
        total += aepsCount || 0
      }
    }

    if (!service || service === 'settlement') {
      let settlementQuery = supabase
        .from('settlements')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (user.role === 'retailer' && user.partner_id) {
        settlementQuery = settlementQuery.eq('user_id', user.partner_id)
      }

      if (dateFrom) settlementQuery = settlementQuery.gte('created_at', dateFrom)
      if (dateTo) settlementQuery = settlementQuery.lte('created_at', dateTo)
      if (status) settlementQuery = settlementQuery.eq('status', status)
      if (user_id) settlementQuery = settlementQuery.eq('user_id', user_id)

      settlementQuery = settlementQuery.range(offset, offset + limit - 1)

      const { data: settlementData, count: settlementCount } = await settlementQuery

      if (settlementData) {
        results = results.concat(settlementData.map(tx => ({
          ...tx,
          service_type: 'settlement',
          transaction_id: tx.id
        })))
        total += settlementCount || 0
      }
    }

    // Sort by created_at descending
    results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    // Prepare data for export
    const headers = ['Service Type', 'Transaction ID', 'User ID', 'Amount', 'Status', 'Created At']
    const rows = results.map(row => [
      row.service_type,
      row.transaction_id || row.id,
      row.user_id || row.retailer_id,
      row.amount || row.bill_amount || 0,
      row.status,
      row.created_at
    ])

    // Format response
    if (format === 'csv') {
      const csvRows = [
        headers.join(','),
        ...rows.map(row => 
          row.map(cell => {
            const cellStr = String(cell || '')
            if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
              return `"${cellStr.replace(/"/g, '""')}"`
            }
            return cellStr
          }).join(',')
        )
      ]

      return new NextResponse(csvRows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="transactions_${Date.now()}.csv"`
        }
      })
    }

    if (format === 'pdf') {
      // Generate HTML-based PDF
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Transaction Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 10px; }
    th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
    th { background-color: #f2f2f2; font-weight: bold; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    .metadata { margin-top: 20px; font-size: 12px; color: #666; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>Transaction Report</h1>
  <div class="metadata">
    <strong>Generated:</strong> ${new Date().toLocaleString()}<br>
    <strong>Total Records:</strong> ${total}<br>
    ${dateFrom ? `<strong>From:</strong> ${dateFrom}<br>` : ''}
    ${dateTo ? `<strong>To:</strong> ${dateTo}` : ''}
  </div>
  <table>
    <thead>
      <tr>
        ${headers.map(h => `<th>${h}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows.map(row => 
        `<tr>${row.map(cell => `<td>${String(cell || '')}</td>`).join('')}</tr>`
      ).join('')}
    </tbody>
  </table>
</body>
</html>
      `.trim()

      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html',
          'Content-Disposition': `attachment; filename="transactions_${Date.now()}.html"`
        }
      })
    }

    if (format === 'zip') {
      // For ZIP, create CSV and HTML versions
      const csvContent = [
        headers.join(','),
        ...rows.map(row => 
          row.map(cell => {
            const cellStr = String(cell || '')
            if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
              return `"${cellStr.replace(/"/g, '""')}"`
            }
            return cellStr
          }).join(',')
        )
      ].join('\n')

      const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Transaction Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 10px; }
    th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
    th { background-color: #f2f2f2; font-weight: bold; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    .metadata { margin-top: 20px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <h1>Transaction Report</h1>
  <div class="metadata">
    <strong>Generated:</strong> ${new Date().toLocaleString()}<br>
    <strong>Total Records:</strong> ${total}
  </div>
  <table>
    <thead>
      <tr>
        ${headers.map(h => `<th>${h}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows.map(row => 
        `<tr>${row.map(cell => `<td>${String(cell || '')}</td>`).join('')}</tr>`
      ).join('')}
    </tbody>
  </table>
</body>
</html>
      `.trim()

      // Return JSON with both files (client can create ZIP)
      return new NextResponse(JSON.stringify({
        files: {
          'transactions.csv': csvContent,
          'transactions.html': htmlContent
        },
        note: 'ZIP format requires server-side library. Returning file contents as JSON.'
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="transactions_${Date.now()}.json"`
        }
      })
    }

    return NextResponse.json({
      success: true,
      data: results,
      total,
      limit,
      offset
    })
  } catch (error: any) {
    console.error('Error in transactions report:', error)
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    )
  }
}

