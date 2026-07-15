import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders } from '@/lib/cors'
import { resolveDownline, downlineToIdSet, isPrivilegedRole } from '@/lib/security/downline'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

function escapeHtml(str: string | null | undefined): string {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

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
    console.log('[Reports Ledger] Auth:', method, '|', user?.email || 'none')
    
    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)

    // Extract filters (support both date_from/date_to and start/end)
    const rawDateFrom = searchParams.get('date_from') || searchParams.get('start')
    const rawDateTo = searchParams.get('date_to') || searchParams.get('end')
    const dateFrom = rawDateFrom ? (rawDateFrom.includes('T') ? rawDateFrom : `${rawDateFrom}T00:00:00+05:30`) : null
    const dateTo = rawDateTo ? (rawDateTo.includes('T') ? rawDateTo : `${rawDateTo}T23:59:59+05:30`) : null
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

    // Hierarchy scoping — non-admins only see their own + downline ledger rows.
    let allowedIds: string[] | null = null
    if (!isPrivilegedRole(user.role)) {
      const downline = await resolveDownline(supabase, user)
      allowedIds = downlineToIdSet(downline, user.partner_id)
      if (allowedIds.length === 0) {
        return NextResponse.json({ success: true, data: [], total: 0, limit, offset })
      }
      // Match rows owned by an allowed id on either ownership column.
      query = query.or(
        `user_id.in.(${allowedIds.join(',')}),retailer_id.in.(${allowedIds.join(',')})`
      )
    }

    // Apply filters
    if (dateFrom) {
      query = query.gte('created_at', dateFrom)
    }
    if (dateTo) {
      query = query.lte('created_at', dateTo)
    }
    if (user_id) {
      // A specific user_id filter must stay within the caller's allowed set.
      if (allowedIds !== null && !allowedIds.includes(user_id)) {
        return NextResponse.json({ error: 'Forbidden: user not in your network' }, { status: 403 })
      }
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

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, { activity_type: 'report_ledger', activity_category: 'report' }).catch(() => {})

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
      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Ledger Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #333; font-size: 11px; }
  .header { text-align: center; margin-bottom: 20px; border-bottom: 3px solid #4F46E5; padding-bottom: 12px; }
  .header h1 { font-size: 20px; color: #4F46E5; }
  .header p { font-size: 11px; color: #666; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 15px; background: #F9FAFB; padding: 10px; border-radius: 6px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #4F46E5; color: #fff; padding: 7px 5px; text-align: left; font-weight: 600; }
  td { padding: 5px; border-bottom: 1px solid #E5E7EB; }
  tr:nth-child(even) { background: #F9FAFB; }
  .footer { margin-top: 15px; text-align: center; font-size: 10px; color: #888; border-top: 1px solid #E5E7EB; padding-top: 8px; }
  @media print { body { padding: 10px; } @page { size: landscape; margin: 8mm; } }
</style></head><body>
  <div class="header">
    <h1>Wallet Ledger Report</h1>
    <p>Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} | Records: ${count || 0}</p>
  </div>
  <div class="meta">
    ${dateFrom ? `<div><strong>From:</strong> ${dateFrom}</div>` : ''}
    ${dateTo ? `<div><strong>To:</strong> ${dateTo}</div>` : ''}
    ${user_id ? `<div><strong>User:</strong> ${user_id}</div>` : ''}
    ${wallet_type ? `<div><strong>Wallet:</strong> ${wallet_type}</div>` : ''}
  </div>
  <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(String(cell || ''))}</td>`).join('')}</tr>`).join('')}</tbody></table>
  <div class="footer">Same Day Solution &mdash; System Generated Report &copy; ${new Date().getFullYear()}</div>
</body></html>`

      const pdf = await htmlToPdf(html, { landscape: true })
      if (pdf) {
        return new NextResponse(new Uint8Array(pdf), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="ledger_${Date.now()}.pdf"`,
          },
        })
      }
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="ledger_${Date.now()}.html"`,
        },
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
    <strong>Generated:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}<br>
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
        `<tr>${row.map(cell => `<td>${escapeHtml(String(cell || ''))}</td>`).join('')}</tr>`
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

