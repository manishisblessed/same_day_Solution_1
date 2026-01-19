import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
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
    
    // Get current user
    const user = await getCurrentUserServer()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)

    // Extract filters (support both date_from/date_to and start/end)
    const dateFrom = searchParams.get('date_from') || searchParams.get('start')
    const dateTo = searchParams.get('date_to') || searchParams.get('end')
    const user_id = searchParams.get('user_id')
    const user_role = searchParams.get('user_role')
    const wallet_type = searchParams.get('wallet_type')
    const fund_category = searchParams.get('fund_category')
    const service_type = searchParams.get('service_type')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '10000') // Increased for exports
    const offset = parseInt(searchParams.get('offset') || '0')
    const format = searchParams.get('format') || 'json' // json, csv, pdf, zip

    // Build query
    let query = supabase
      .from('wallet_ledger')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    // Role-based filtering
    if (user.role === 'retailer' && user.partner_id) {
      query = query.eq('retailer_id', user.partner_id)
    } else if (user.role === 'distributor' && user.partner_id) {
      // Distributors can see their retailers
      query = query.eq('user_role', 'retailer')
      // TODO: Add distributor_id filtering when available
    } else if (user.role === 'master_distributor' && user.partner_id) {
      // Master distributors can see their distributors and retailers
      // TODO: Add hierarchical filtering
    }
    // Admin can see all

    // Apply filters
    if (dateFrom) {
      query = query.gte('created_at', dateFrom)
    }
    if (dateTo) {
      query = query.lte('created_at', dateTo)
    }
    if (user_id) {
      query = query.eq('retailer_id', user_id) // Using retailer_id for backward compatibility
    }
    if (user_role) {
      query = query.eq('user_role', user_role)
    }
    if (wallet_type) {
      query = query.eq('wallet_type', wallet_type)
    }
    if (fund_category) {
      query = query.eq('fund_category', fund_category)
    }
    if (service_type) {
      query = query.eq('service_type', service_type)
    }
    if (status) {
      query = query.eq('status', status)
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching ledger:', error)
      return NextResponse.json(
        { error: 'Failed to fetch ledger' },
        { status: 500 }
      )
    }

    // Prepare data for export
    const headers = ['ID', 'User ID', 'Wallet Type', 'Fund Category', 'Service Type', 'Transaction Type', 'Credit', 'Debit', 'Opening Balance', 'Closing Balance', 'Status', 'Created At']
    const rows = (data || []).map(row => [
      row.id,
      row.retailer_id || row.user_id,
      row.wallet_type || 'primary',
      row.fund_category || '',
      row.service_type || '',
      row.transaction_type,
      row.credit || 0,
      row.debit || 0,
      row.opening_balance || 0,
      row.closing_balance || 0,
      row.status || 'completed',
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
          'Content-Disposition': `attachment; filename="ledger_${Date.now()}.csv"`
        }
      })
    }

    if (format === 'pdf') {
      // Generate HTML-based PDF (can be converted to PDF by browser or server)
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Ledger Report</title>
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
  <h1>Ledger Report</h1>
  <div class="metadata">
    <strong>Generated:</strong> ${new Date().toLocaleString()}<br>
    <strong>Total Records:</strong> ${count || 0}<br>
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
          'Content-Disposition': `attachment; filename="ledger_${Date.now()}.html"`
        }
      })
    }

    if (format === 'zip') {
      // For ZIP, create CSV and HTML (PDF) versions
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
  <title>Ledger Report</title>
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
  <h1>Ledger Report</h1>
  <div class="metadata">
    <strong>Generated:</strong> ${new Date().toLocaleString()}<br>
    <strong>Total Records:</strong> ${count || 0}
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
      // Or use a ZIP library on server side
      // For now, return CSV as primary with note about ZIP
      return new NextResponse(JSON.stringify({
        files: {
          'ledger.csv': csvContent,
          'ledger.html': htmlContent
        },
        note: 'ZIP format requires server-side library. Returning file contents as JSON.'
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="ledger_${Date.now()}.json"`
        }
      })
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      total: count || 0,
      limit,
      offset
    })
  } catch (error: any) {
    console.error('Error in ledger report:', error)
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    )
  }
}

