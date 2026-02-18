import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/pos-transactions
 * POS-wise transaction report
 * 
 * Query Parameters:
 * - machine_id: Filter by POS machine ID (e.g., POS12345678)
 * - device_serial: Filter by device serial number
 * - date_from / date_to: Date range filter
 * - status: Transaction status filter
 * - group_by: 'machine' (default) or 'none' (flat list)
 * - format: 'json' (default), 'csv', 'pdf'
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[POS Transaction Report] Auth:', method, '|', user?.email || 'none')

    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const machineId = searchParams.get('machine_id')
    const deviceSerial = searchParams.get('device_serial')
    const dateFrom = searchParams.get('date_from') || searchParams.get('start')
    const dateTo = searchParams.get('date_to') || searchParams.get('end')
    const status = searchParams.get('status')
    const groupBy = searchParams.get('group_by') || 'machine'
    const format = searchParams.get('format') || 'json'
    const limit = parseInt(searchParams.get('limit') || '10000')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Get device serials based on user role
    let deviceSerials: string[] = []

    if (user.role !== 'admin') {
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
      }

      const { data: mappings } = await mappingQuery
      deviceSerials = (mappings || []).map((m: any) => m.device_serial).filter(Boolean)

      if (deviceSerials.length === 0) {
        return NextResponse.json({
          success: true,
          data: groupBy === 'machine' ? {} : [],
          summary: {
            total_machines: 0,
            total_transactions: 0,
            total_amount: 0,
          }
        })
      }
    }

    // Resolve machine_id to device_serial if needed
    let targetDeviceSerial = deviceSerial
    if (machineId && !deviceSerial) {
      const { data: machine } = await supabase
        .from('pos_machines')
        .select('serial_number, machine_id')
        .eq('machine_id', machineId)
        .single()

      if (machine?.serial_number) {
        targetDeviceSerial = machine.serial_number
      } else {
        return NextResponse.json({
          success: true,
          data: groupBy === 'machine' ? {} : [],
          summary: { total_machines: 0, total_transactions: 0, total_amount: 0 },
          error: 'POS machine not found'
        })
      }
    }

    // Build transaction query
    let query = supabase
      .from('razorpay_pos_transactions')
      .select('*', { count: 'exact' })
      .order('transaction_time', { ascending: false })

    // Apply role-based filtering
    if (user.role !== 'admin' && deviceSerials.length > 0) {
      if (targetDeviceSerial && deviceSerials.includes(targetDeviceSerial)) {
        query = query.eq('device_serial', targetDeviceSerial)
      } else if (!targetDeviceSerial) {
        query = query.in('device_serial', deviceSerials)
      } else {
        // Device serial not in user's access list
        query = query.eq('id', '00000000-0000-0000-0000-000000000000')
      }
    } else if (targetDeviceSerial) {
      query = query.eq('device_serial', targetDeviceSerial)
    }

    // Apply filters
    if (dateFrom) query = query.gte('transaction_time', dateFrom)
    if (dateTo) query = query.lte('transaction_time', dateTo)
    if (status) query = query.eq('status', status)

    // For grouped reports, we need all data (no pagination)
    // For flat reports, apply pagination
    if (groupBy === 'none') {
      query = query.range(offset, offset + limit - 1)
    }

    const { data: transactions, error, count } = await query

    if (error) {
      console.error('Error fetching POS transactions:', error)
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
    }

    // Get machine info for all device serials
    const uniqueSerials = Array.from(new Set((transactions || []).map((t: any) => t.device_serial).filter(Boolean)))
    const machineMap = new Map<string, any>()

    if (uniqueSerials.length > 0) {
      const { data: machines } = await supabase
        .from('pos_machines')
        .select('machine_id, serial_number, machine_type, status, inventory_status, retailer_id, distributor_id, master_distributor_id')
        .in('serial_number', uniqueSerials)

      machines?.forEach((m: any) => {
        if (m.serial_number) {
          machineMap.set(m.serial_number, m)
        }
      })
    }

    // Group by machine if requested
    if (groupBy === 'machine') {
      const grouped: Record<string, any> = {}

      transactions?.forEach((tx: any) => {
        const serial = tx.device_serial || 'unknown'
        const machine = machineMap.get(serial)

        if (!grouped[serial]) {
          grouped[serial] = {
            device_serial: serial,
            machine_id: machine?.machine_id || 'N/A',
            machine_type: machine?.machine_type || 'N/A',
            machine_status: machine?.status || 'N/A',
            inventory_status: machine?.inventory_status || 'N/A',
            transactions: [],
            summary: {
              total_transactions: 0,
              total_amount: 0,
              success_count: 0,
              failed_count: 0,
              success_amount: 0,
            }
          }
        }

        grouped[serial].transactions.push(tx)
        grouped[serial].summary.total_transactions++
        grouped[serial].summary.total_amount += tx.amount || 0

        if (tx.status === 'SUCCESS' || tx.status === 'CAPTURED') {
          grouped[serial].summary.success_count++
          grouped[serial].summary.success_amount += tx.amount || 0
        } else if (tx.status === 'FAILED') {
          grouped[serial].summary.failed_count++
        }
      })

      const summary = {
        total_machines: Object.keys(grouped).length,
        total_transactions: count || 0,
        total_amount: Object.values(grouped).reduce((sum: number, m: any) => sum + m.summary.total_amount, 0),
      }

      if (format === 'csv') {
        // Flatten for CSV
        const csvRows: string[] = []
        csvRows.push('Machine ID,Device Serial,Machine Type,Transaction ID,Amount,Status,Transaction Time')
        
        Object.values(grouped).forEach((machine: any) => {
          machine.transactions.forEach((tx: any) => {
            csvRows.push([
              machine.machine_id,
              machine.device_serial,
              machine.machine_type,
              tx.txn_id || tx.id,
              tx.amount || 0,
              tx.status || '',
              tx.transaction_time || tx.created_at || ''
            ].join(','))
          })
        })

        return new NextResponse(csvRows.join('\n'), {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="pos_transactions_${Date.now()}.csv"`
          }
        })
      }

      return NextResponse.json({
        success: true,
        data: grouped,
        summary,
        pagination: {
          total: count || 0,
          limit,
          offset
        }
      })
    }

    // Flat list format
    const enriched = (transactions || []).map((tx: any) => {
      const machine = machineMap.get(tx.device_serial || '')
      return {
        ...tx,
        machine_id: machine?.machine_id || null,
        machine_type: machine?.machine_type || null,
        machine_status: machine?.status || null,
      }
    })

    if (format === 'csv') {
      const csvRows: string[] = []
      csvRows.push('Machine ID,Device Serial,Machine Type,Transaction ID,Amount,Status,Transaction Time')
      enriched.forEach((tx: any) => {
        csvRows.push([
          tx.machine_id || 'N/A',
          tx.device_serial || '',
          tx.machine_type || 'N/A',
          tx.txn_id || tx.id,
          tx.amount || 0,
          tx.status || '',
          tx.transaction_time || tx.created_at || ''
        ].join(','))
      })

      return new NextResponse(csvRows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="pos_transactions_${Date.now()}.csv"`
        }
      })
    }

    return NextResponse.json({
      success: true,
      data: enriched,
      summary: {
        total_transactions: count || 0,
        total_amount: enriched.reduce((sum, tx) => sum + (tx.amount || 0), 0),
      },
      pagination: {
        page: Math.floor(offset / limit) + 1,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
        hasNextPage: (offset + limit) < (count || 0),
        hasPrevPage: offset > 0
      }
    })

  } catch (error: any) {
    console.error('Error in POS transaction report:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

