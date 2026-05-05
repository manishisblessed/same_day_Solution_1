import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

/**
 * GET /api/razorpay/transactions
 * Role-based API to fetch Razorpay POS transactions
 * 
 * ALL roles now query razorpay_pos_transactions directly (single source of truth).
 * TIDs and device serials are resolved from pos_machines / pos_device_mapping / partner_pos_machines.
 * 
 * Behavior:
 * - Admin → sees all transactions
 * - Partner → sees transactions matching TIDs from partner_pos_machines + pos_machines
 * - Master Distributor → sees transactions matching device serials from pos_device_mapping
 * - Distributor → sees transactions matching device serials from pos_device_mapping
 * - Retailer → sees transactions matching TIDs/serials from pos_machines + pos_device_mapping
 */
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
    console.log('[Razorpay Transactions] Auth:', method, '|', user?.email || 'none', '| Role:', user?.role)
    
    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const rawLimit = parseInt(searchParams.get('limit') || '25', 10)
    const limit = [10, 25, 100].includes(rawLimit) ? rawLimit : 25
    const offset = (page - 1) * limit
    const machineId = searchParams.get('machine_id')
    const deviceSerial = searchParams.get('device_serial')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')
    const statusFilter = searchParams.get('status')
    const tidFilter = searchParams.get('tid') || searchParams.get('terminal_id')

    // Resolve machine_id to device_serial if needed
    let targetDeviceSerial = deviceSerial
    if (machineId && !deviceSerial) {
      const { data: machine } = await supabase
        .from('pos_machines')
        .select('serial_number')
        .eq('machine_id', machineId)
        .single()

      if (machine?.serial_number) {
        targetDeviceSerial = machine.serial_number
      } else if (machineId) {
        // Machine ID provided but not found
        return NextResponse.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false }
        })
      }
    }

    // ========================================================================
    // ADMIN: sees all transactions
    // ========================================================================
    if (user.role === 'admin') {
      let query = supabase
        .from('razorpay_pos_transactions')
        .select('*', { count: 'exact' })
        .order('transaction_time', { ascending: false, nullsFirst: false })

      if (targetDeviceSerial) query = query.eq('device_serial', targetDeviceSerial)
      if (dateFrom) query = query.gte('transaction_time', dateFrom)
      if (dateTo) query = query.lte('transaction_time', dateTo)
      if (statusFilter && statusFilter !== 'all') {
        const displayStatus = statusFilter.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : statusFilter.toUpperCase()
        query = query.eq('display_status', displayStatus)
      }

      query = query.range(offset, offset + limit - 1)

      const { data: transactions, error, count } = await query

      if (error) {
        console.error('Error fetching Razorpay POS transactions:', error)
        return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
      }

      // Enrich with machine_id
      const uniqueSerials = Array.from(new Set((transactions || []).map((t: any) => t.device_serial).filter(Boolean)))
      const machineMap = new Map<string, string>()
      
      if (uniqueSerials.length > 0) {
        const { data: machines } = await supabase
          .from('pos_machines')
          .select('machine_id, serial_number')
          .in('serial_number', uniqueSerials)
        
        machines?.forEach((m: any) => {
          if (m.serial_number) machineMap.set(m.serial_number, m.machine_id)
        })
      }

      const enriched = (transactions || []).map((tx: any) => ({
        ...tx,
        machine_id: machineMap.get(tx.device_serial || '') || null
      }))

      const totalPages = count ? Math.ceil(count / limit) : 1
      return NextResponse.json({
        success: true,
        data: enriched,
        pagination: { page, limit, total: count || 0, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 }
      })
    }

    // ========================================================================
    // PARTNER: Get assignment windows from pos_assignment_history,
    // query razorpay_pos_transactions by TID/serial, then filter by windows
    // ========================================================================
    if (user.role === 'partner' && user.partner_id) {
      const { data: assignmentHistory } = await supabase
        .from('pos_assignment_history')
        .select('pos_machine_id, created_at, returned_date, status')
        .eq('assigned_to', user.partner_id)
        .like('action', 'assigned_to_%')
        .order('created_at', { ascending: false })

      if (!assignmentHistory || assignmentHistory.length === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false }
        })
      }

      const posMachineIds = [...new Set(assignmentHistory.map((a: any) => a.pos_machine_id).filter(Boolean))]
      let tids: string[] = []
      let serials: string[] = []
      const machineIdToTidSerial = new Map<string, { tid: string, serial: string }>()

      if (posMachineIds.length > 0) {
        const { data: machines } = await supabase
          .from('pos_machines')
          .select('id, tid, serial_number')
          .in('id', posMachineIds)

        if (machines) {
          machines.forEach((m: any) => {
            if (m.tid) tids.push(m.tid)
            if (m.serial_number) serials.push(m.serial_number)
            machineIdToTidSerial.set(m.id, { tid: m.tid, serial: m.serial_number })
          })
        }
      }

      tids = Array.from(new Set(tids))
      serials = Array.from(new Set(serials))

      // Build assignment windows: Map<tid_or_serial, {from: Date, to: Date | null}[]>
      const assignmentWindows = new Map<string, { from: Date, to: Date | null }[]>()
      for (const ah of assignmentHistory) {
        const machine = machineIdToTidSerial.get(ah.pos_machine_id)
        if (!machine) continue
        const window = { from: new Date(ah.created_at), to: ah.returned_date ? new Date(ah.returned_date) : null }
        for (const key of [machine.tid, machine.serial].filter(Boolean)) {
          if (!assignmentWindows.has(key)) assignmentWindows.set(key, [])
          assignmentWindows.get(key)!.push(window)
        }
      }

      console.log(`[Partner Txn] partner_id: ${user.partner_id}, TIDs: [${tids.join(',')}], serials: [${serials.join(',')}], windows: ${assignmentHistory.length}`)

      if (tids.length === 0 && serials.length === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false }
        })
      }

      const orConditions: string[] = []
      if (tids.length > 0) orConditions.push(`tid.in.(${tids.join(',')})`)
      if (serials.length > 0) orConditions.push(`device_serial.in.(${serials.join(',')})`)

      // Fetch all matching transactions (in-memory filtering requires full result set)
      let query = supabase
        .from('razorpay_pos_transactions')
        .select('*')
        .or(orConditions.join(','))
        .order('transaction_time', { ascending: false, nullsFirst: false })
        .limit(5000)

      if (dateFrom) query = query.gte('transaction_time', dateFrom)
      if (dateTo) query = query.lte('transaction_time', dateTo)
      if (statusFilter && statusFilter !== 'all') {
        const displayStatus = statusFilter.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : statusFilter.toUpperCase()
        query = query.eq('display_status', displayStatus)
      }
      if (tidFilter) query = query.eq('tid', tidFilter)
      if (targetDeviceSerial) query = query.eq('device_serial', targetDeviceSerial)

      const { data: allTransactions, error } = await query

      if (error) {
        console.error('Error fetching POS transactions for partner:', error)
        return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
      }

      // Filter transactions to only those within assignment windows
      const filtered = (allTransactions || []).filter((tx: any) => {
        const txTime = new Date(tx.transaction_time)
        const windows = assignmentWindows.get(tx.tid) || assignmentWindows.get(tx.device_serial) || []
        return windows.some((w: { from: Date, to: Date | null }) => txTime >= w.from && (!w.to || txTime <= w.to))
      })

      // Paginate in-memory after filtering
      const total = filtered.length
      const paginatedData = filtered.slice(offset, offset + limit)

      // Enrich with machine_id
      const uniqueSerials = Array.from(new Set(paginatedData.map((t: any) => t.device_serial).filter(Boolean)))
      const machineMap = new Map<string, string>()
      if (uniqueSerials.length > 0) {
        const { data: machines } = await supabase
          .from('pos_machines')
          .select('machine_id, serial_number')
          .in('serial_number', uniqueSerials)
        machines?.forEach((m: any) => {
          if (m.serial_number) machineMap.set(m.serial_number, m.machine_id)
        })
      }

      const enriched = paginatedData.map((tx: any) => ({
        ...tx,
        machine_id: machineMap.get(tx.device_serial || '') || null
      }))

      const totalPages = total > 0 ? Math.ceil(total / limit) : 1
      return NextResponse.json({
        success: true,
        data: enriched,
        pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 }
      })
    }

    // ========================================================================
    // RETAILER: Get assignment windows from pos_assignment_history,
    // query razorpay_pos_transactions by TID/serial, then filter by windows
    // ========================================================================
    if (user.role === 'retailer' && user.partner_id) {
      const { data: assignmentHistory } = await supabase
        .from('pos_assignment_history')
        .select('pos_machine_id, created_at, returned_date, status')
        .eq('assigned_to', user.partner_id)
        .like('action', 'assigned_to_%')
        .order('created_at', { ascending: false })

      if (!assignmentHistory || assignmentHistory.length === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false }
        })
      }

      const posMachineIds = [...new Set(assignmentHistory.map((a: any) => a.pos_machine_id).filter(Boolean))]
      let tids: string[] = []
      let deviceSerials: string[] = []
      const machineIdToTidSerial = new Map<string, { tid: string, serial: string }>()

      if (posMachineIds.length > 0) {
        const { data: machines } = await supabase
          .from('pos_machines')
          .select('id, tid, serial_number')
          .in('id', posMachineIds)

        if (machines) {
          machines.forEach((m: any) => {
            if (m.tid) tids.push(m.tid)
            if (m.serial_number) deviceSerials.push(m.serial_number)
            machineIdToTidSerial.set(m.id, { tid: m.tid, serial: m.serial_number })
          })
        }
      }

      tids = Array.from(new Set(tids))
      deviceSerials = Array.from(new Set(deviceSerials))

      // Build assignment windows: Map<tid_or_serial, {from: Date, to: Date | null}[]>
      const assignmentWindows = new Map<string, { from: Date, to: Date | null }[]>()
      for (const ah of assignmentHistory) {
        const machine = machineIdToTidSerial.get(ah.pos_machine_id)
        if (!machine) continue
        const window = { from: new Date(ah.created_at), to: ah.returned_date ? new Date(ah.returned_date) : null }
        for (const key of [machine.tid, machine.serial].filter(Boolean)) {
          if (!assignmentWindows.has(key)) assignmentWindows.set(key, [])
          assignmentWindows.get(key)!.push(window)
        }
      }

      console.log(`[Retailer Txn] retailer_id: ${user.partner_id}, TIDs: [${tids.join(',')}], serials: [${deviceSerials.join(',')}], windows: ${assignmentHistory.length}`)

      if (tids.length === 0 && deviceSerials.length === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false }
        })
      }

      const orConditions: string[] = []
      if (tids.length > 0) orConditions.push(`tid.in.(${tids.join(',')})`)
      if (deviceSerials.length > 0) orConditions.push(`device_serial.in.(${deviceSerials.join(',')})`)

      if (targetDeviceSerial && !deviceSerials.includes(targetDeviceSerial)) {
        return NextResponse.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false }
        })
      }

      // Fetch all matching transactions (in-memory filtering requires full result set)
      let query = supabase
        .from('razorpay_pos_transactions')
        .select('*')
        .or(orConditions.join(','))
        .order('transaction_time', { ascending: false, nullsFirst: false })
        .limit(5000)

      if (targetDeviceSerial) query = query.eq('device_serial', targetDeviceSerial)
      if (dateFrom) query = query.gte('transaction_time', dateFrom)
      if (dateTo) query = query.lte('transaction_time', dateTo)
      if (statusFilter && statusFilter !== 'all') {
        const displayStatus = statusFilter.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : statusFilter.toUpperCase()
        query = query.eq('display_status', displayStatus)
      }
      if (tidFilter) query = query.eq('tid', tidFilter)

      const { data: allTransactions, error } = await query

      if (error) {
        console.error('Error fetching Razorpay POS transactions for retailer:', error)
        return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
      }

      // Filter transactions to only those within assignment windows
      const filtered = (allTransactions || []).filter((tx: any) => {
        const txTime = new Date(tx.transaction_time)
        const windows = assignmentWindows.get(tx.tid) || assignmentWindows.get(tx.device_serial) || []
        return windows.some((w: { from: Date, to: Date | null }) => txTime >= w.from && (!w.to || txTime <= w.to))
      })

      // Paginate in-memory after filtering
      const total = filtered.length
      const paginatedData = filtered.slice(offset, offset + limit)

      // Enrich with machine_id
      const uniqueSerials = Array.from(new Set(paginatedData.map((t: any) => t.device_serial).filter(Boolean)))
      const machineMap = new Map<string, string>()
      if (uniqueSerials.length > 0) {
        const { data: machines } = await supabase
          .from('pos_machines')
          .select('machine_id, serial_number')
          .in('serial_number', uniqueSerials)
        machines?.forEach((m: any) => {
          if (m.serial_number) machineMap.set(m.serial_number, m.machine_id)
        })
      }

      const enriched = paginatedData.map((tx: any) => ({
        ...tx,
        machine_id: machineMap.get(tx.device_serial || '') || null
      }))

      const totalPages = total > 0 ? Math.ceil(total / limit) : 1
      return NextResponse.json({
        success: true,
        data: enriched,
        pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 }
      })
    }

    // ========================================================================
    // MASTER DISTRIBUTOR / DISTRIBUTOR: Use pos_device_mapping (existing approach)
    // Also enhanced with TID matching from pos_machines
    // ========================================================================
    let tids: string[] = []
    let deviceSerials: string[] = []

    // Get mappings from pos_device_mapping based on role
    let mappingQuery = supabase
      .from('pos_device_mapping')
      .select('device_serial, tid')
      .eq('status', 'ACTIVE')

    if (user.role === 'master_distributor') {
      mappingQuery = mappingQuery.eq('master_distributor_id', user.partner_id)
    } else if (user.role === 'distributor') {
      mappingQuery = mappingQuery.eq('distributor_id', user.partner_id)
    } else {
      return NextResponse.json({ error: 'Invalid user role' }, { status: 403 })
    }

    const { data: mappings, error: mappingError } = await mappingQuery

    if (mappingError) {
      console.error('Error fetching POS device mappings:', mappingError)
      return NextResponse.json({ error: 'Failed to fetch device mappings' }, { status: 500 })
    }

    deviceSerials = (mappings || []).map((m: any) => m.device_serial).filter(Boolean)
    tids = (mappings || []).map((m: any) => m.tid).filter(Boolean)

    // Also get TIDs from pos_machines based on role
    let posMachineQuery = supabase
      .from('pos_machines')
      .select('tid, serial_number')
      .in('status', ['active', 'inactive'])

    if (user.role === 'master_distributor') {
      posMachineQuery = posMachineQuery.eq('master_distributor_id', user.partner_id)
    } else if (user.role === 'distributor') {
      posMachineQuery = posMachineQuery.eq('distributor_id', user.partner_id)
    }

    const { data: posMachines } = await posMachineQuery
    if (posMachines) {
      tids.push(...posMachines.map((m: any) => m.tid).filter(Boolean))
      deviceSerials.push(...posMachines.map((m: any) => m.serial_number).filter(Boolean))
    }

    // Deduplicate
    tids = Array.from(new Set(tids))
    deviceSerials = Array.from(new Set(deviceSerials))

    if (tids.length === 0 && deviceSerials.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false }
      })
    }

    // If machine_id or device_serial filter provided, validate access
    if (targetDeviceSerial && !deviceSerials.includes(targetDeviceSerial)) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false }
      })
    }

    // Build OR filter: match by tid OR device_serial
    const orConditions: string[] = []
    if (tids.length > 0) orConditions.push(`tid.in.(${tids.join(',')})`)
    if (deviceSerials.length > 0) orConditions.push(`device_serial.in.(${deviceSerials.join(',')})`)

    let query = supabase
      .from('razorpay_pos_transactions')
      .select('*', { count: 'exact' })
      .or(orConditions.join(','))
      .order('transaction_time', { ascending: false, nullsFirst: false })

    if (targetDeviceSerial) query = query.eq('device_serial', targetDeviceSerial)
    if (dateFrom) query = query.gte('transaction_time', dateFrom)
    if (dateTo) query = query.lte('transaction_time', dateTo)
    if (statusFilter && statusFilter !== 'all') {
      const displayStatus = statusFilter.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : statusFilter.toUpperCase()
      query = query.eq('display_status', displayStatus)
    }

    query = query.range(offset, offset + limit - 1)

    const { data: transactions, error, count } = await query

    if (error) {
      console.error('Error fetching Razorpay POS transactions:', error)
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
    }

    // Enrich with machine_id
    const uniqueSerials = Array.from(new Set((transactions || []).map((t: any) => t.device_serial).filter(Boolean)))
    const machineMap = new Map<string, string>()
    
    if (uniqueSerials.length > 0) {
      const { data: machines } = await supabase
        .from('pos_machines')
        .select('machine_id, serial_number')
        .in('serial_number', uniqueSerials)
      
      machines?.forEach((m: any) => {
        if (m.serial_number) machineMap.set(m.serial_number, m.machine_id)
      })
    }

    const enriched = (transactions || []).map((tx: any) => ({
      ...tx,
      machine_id: machineMap.get(tx.device_serial || '') || null
    }))

    const totalPages = count ? Math.ceil(count / limit) : 1
    return NextResponse.json({
      success: true,
      data: enriched,
      pagination: { page, limit, total: count || 0, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 }
    })

  } catch (error: any) {
    console.error('Error in role-based Razorpay transactions API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
