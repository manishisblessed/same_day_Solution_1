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
    console.log('[Reports Transactions] Auth:', method, '|', user?.email || 'none')
    
    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)

    // Extract filters (support both date_from/date_to and start/end)
    const rawDateFrom = searchParams.get('date_from') || searchParams.get('start')
    const rawDateTo = searchParams.get('date_to') || searchParams.get('end')
    const dateFrom = rawDateFrom ? (rawDateFrom.includes('T') ? rawDateFrom : `${rawDateFrom}T00:00:00+05:30`) : null
    const dateTo = rawDateTo ? (rawDateTo.includes('T') ? rawDateTo : `${rawDateTo}T23:59:59+05:30`) : null
    const service = searchParams.get('service') // bbps, aeps, settlement, pos
    const status = searchParams.get('status')
    const user_id = searchParams.get('user_id')
    const limit = parseInt(searchParams.get('limit') || '10000') // Increased for exports
    const offset = parseInt(searchParams.get('offset') || '0')
    const format = searchParams.get('format') || 'json' // json, csv, pdf, zip

    // Hierarchy scoping: non-admins are limited to their own + downline ids.
    // `allowedIds === null` means privileged (admin/finance) → no restriction.
    const privileged = isPrivilegedRole(user.role)
    let allowedIds: string[] | null = null
    if (!privileged) {
      const downline = await resolveDownline(supabase, user)
      allowedIds = downlineToIdSet(downline, user.partner_id)
      if (allowedIds.length === 0) {
        return NextResponse.json({ success: true, data: [], total: 0, limit, offset })
      }
    }
    if (user_id && allowedIds !== null && !allowedIds.includes(user_id)) {
      return NextResponse.json({ error: 'Forbidden: user not in your network' }, { status: 403 })
    }

    let results: any[] = []
    let total = 0

    // Fetch transactions based on service type
    if (!service || service === 'bbps') {
      let bbpsQuery = supabase
        .from('bbps_transactions')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (allowedIds !== null) {
        bbpsQuery = bbpsQuery.in('retailer_id', allowedIds)
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
          bbps_transaction_id: tx.transaction_id,
        })))
        total += bbpsCount || 0
      }
    }

    if (!service || service === 'aeps') {
      let aepsQuery = supabase
        .from('aeps_transactions')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (allowedIds !== null) {
        aepsQuery = aepsQuery.in('user_id', allowedIds)
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

      if (allowedIds !== null) {
        settlementQuery = settlementQuery.in('user_id', allowedIds)
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

    // POS (Razorpay) transactions
    if (!service || service === 'pos') {
      // Get device serials based on user role for filtering
      let deviceSerials: string[] = []
      
      if (!privileged) {
        let mappingQuery = supabase
          .from('pos_device_mapping')
          .select('device_serial')
          .eq('status', 'ACTIVE')

        if (user.role === 'master_distributor' && user.partner_id) {
          mappingQuery = mappingQuery.eq('master_distributor_id', user.partner_id)
        } else if (user.role === 'distributor' && user.partner_id) {
          mappingQuery = mappingQuery.eq('distributor_id', user.partner_id)
        } else if (user.role === 'retailer' && user.partner_id) {
          mappingQuery = mappingQuery.eq('retailer_id', user.partner_id)
        } else {
          // Unknown non-privileged role → no POS access
          mappingQuery = mappingQuery.eq('device_serial', '__none__')
        }

        const { data: mappings } = await mappingQuery
        deviceSerials = (mappings || []).map((m: any) => m.device_serial).filter(Boolean)
      }

      let posQuery = supabase
        .from('razorpay_pos_transactions')
        .select('*', { count: 'exact' })
        .order('transaction_time', { ascending: false })

      // Apply role-based filtering
      if (!privileged && deviceSerials.length > 0) {
        posQuery = posQuery.in('device_serial', deviceSerials)
      } else if (!privileged && deviceSerials.length === 0) {
        // No access - return empty
        posQuery = posQuery.eq('id', '00000000-0000-0000-0000-000000000000') // Impossible match
      }

      // Apply filters
      if (dateFrom) posQuery = posQuery.gte('transaction_time', dateFrom)
      if (dateTo) posQuery = posQuery.lte('transaction_time', dateTo)
      if (status) posQuery = posQuery.eq('status', status)
      
      // Filter by device_serial if provided
      const device_serial = searchParams.get('device_serial') || searchParams.get('machine_id')
      if (device_serial) {
        // If machine_id provided, look up device_serial from pos_machines
        if (device_serial.startsWith('POS') || device_serial.startsWith('WPOS') || device_serial.startsWith('MATM')) {
          const { data: machine } = await supabase
            .from('pos_machines')
            .select('serial_number')
            .eq('machine_id', device_serial)
            .single()
          if (machine?.serial_number) {
            posQuery = posQuery.eq('device_serial', machine.serial_number)
          } else {
            posQuery = posQuery.eq('device_serial', '') // No match
          }
        } else {
          posQuery = posQuery.eq('device_serial', device_serial)
        }
      }

      posQuery = posQuery.range(offset, offset + limit - 1)

      const { data: posData, count: posCount } = await posQuery

      if (posData) {
        results = results.concat(posData.map(tx => ({
          ...tx,
          service_type: 'pos',
          transaction_id: tx.txn_id || tx.id,
          user_id: tx.retailer_id || null,
          created_at: tx.transaction_time || tx.created_at,
          amount: tx.amount || 0,
        })))
        total += posCount || 0
      }
    }

    // Sort by created_at descending
    results.sort((a, b) => new Date(b.created_at || b.transaction_time || 0).getTime() - new Date(a.created_at || a.transaction_time || 0).getTime())

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, { activity_type: 'report_transactions', activity_category: 'report' }).catch(() => {})

    // Prepare data for export
    const headers = ['Service Type', 'Transaction ID', 'User ID', 'Amount', 'Status', 'Device Serial', 'Machine ID', 'Created At']
    const rows = results.map(row => {
      // For POS transactions, try to get machine_id from device_serial
      let machineId = ''
      if (row.service_type === 'pos' && row.device_serial) {
        // In a real implementation, you'd join with pos_machines here
        // For now, we'll just show device_serial
        machineId = row.device_serial
      }
      return [
        row.service_type,
        row.transaction_id || row.id,
        row.user_id || row.retailer_id,
        row.amount || row.bill_amount || 0,
        row.status,
        row.device_serial || '',
        machineId,
        row.created_at || row.transaction_time
      ]
    })

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
      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Transaction Report</title>
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
    <h1>Transaction Report</h1>
    <p>Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} | Records: ${total}</p>
  </div>
  <div class="meta">
    ${dateFrom ? `<div><strong>From:</strong> ${dateFrom}</div>` : ''}
    ${dateTo ? `<div><strong>To:</strong> ${dateTo}</div>` : ''}
    ${service ? `<div><strong>Service:</strong> ${service}</div>` : ''}
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
            'Content-Disposition': `attachment; filename="transactions_${Date.now()}.pdf"`,
          },
        })
      }
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="transactions_${Date.now()}.html"`,
        },
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
    <strong>Generated:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}<br>
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
        `<tr>${row.map(cell => `<td>${escapeHtml(String(cell || ''))}</td>`).join('')}</tr>`
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

