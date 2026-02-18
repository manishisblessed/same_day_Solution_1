import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

/**
 * GET /api/razorpay/transactions
 * Role-based API to fetch Razorpay POS transactions
 * 
 * Phase 2: Role-based visibility using POS device mapping
 * 
 * Behavior:
 * - Admin → sees all transactions
 * - Master Distributor → sees transactions where master_distributor_id matches
 * - Distributor → sees transactions where distributor_id matches
 * - Retailer → sees transactions where retailer_id matches
 * - If no mapping exists → show ONLY to Admin, hide from others
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
    console.log('[Razorpay Transactions] Auth:', method, '|', user?.email || 'none')
    
    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit
    const machineId = searchParams.get('machine_id')
    const deviceSerial = searchParams.get('device_serial')

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
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false
          }
        })
      }
    }

    // For partners, query pos_transactions table (Partner API table)
    if (user.role === 'partner' && user.partner_id) {
      // Get query parameters for date filtering
      const dateFrom = searchParams.get('date_from')
      const dateTo = searchParams.get('date_to')
      const status = searchParams.get('status')
      const terminalId = searchParams.get('tid') || searchParams.get('terminal_id')

      // Build query for pos_transactions table
      let query = supabase
        .from('pos_transactions')
        .select(`
          id,
          razorpay_txn_id,
          external_ref,
          terminal_id,
          amount,
          status,
          rrn,
          card_brand,
          card_type,
          payment_mode,
          settlement_status,
          device_serial,
          txn_time,
          created_at,
          partner_id,
          retailer_id
        `, { count: 'exact' })
        .eq('partner_id', user.partner_id)
        .order('txn_time', { ascending: false, nullsFirst: false })

      // Apply filters
      if (dateFrom) {
        query = query.gte('txn_time', dateFrom)
      }
      if (dateTo) {
        query = query.lte('txn_time', dateTo)
      }
      if (status && status !== 'all') {
        query = query.eq('status', status.toUpperCase())
      }
      if (terminalId) {
        query = query.eq('terminal_id', terminalId)
      }
      if (targetDeviceSerial) {
        query = query.eq('device_serial', targetDeviceSerial)
      }

      query = query.range(offset, offset + limit - 1)

      const { data: transactions, error, count } = await query

      if (error) {
        console.error('Error fetching POS transactions for partner:', error)
        return NextResponse.json(
          { error: 'Failed to fetch transactions' },
          { status: 500 }
        )
      }

      // Get retailer info for enrichment
      const retailerIds = Array.from(new Set((transactions || []).map((t: any) => t.retailer_id).filter(Boolean)))
      const retailerMap = new Map<string, any>()
      
      if (retailerIds.length > 0) {
        const { data: retailers } = await supabase
          .from('partner_retailers')
          .select('id, retailer_code, name')
          .in('id', retailerIds)
        
        retailers?.forEach((r: any) => {
          retailerMap.set(r.id, r)
        })
      }

      // Transform to match expected format
      const enriched = (transactions || []).map((tx: any) => {
        const retailer = retailerMap.get(tx.retailer_id)
        return {
          id: tx.id,
          txn_id: tx.razorpay_txn_id,
          external_ref: tx.external_ref,
          tid: tx.terminal_id,
          device_serial: tx.device_serial,
          amount: tx.amount ? tx.amount / 100 : 0, // Convert from paisa to rupees
          status: tx.status,
          display_status: tx.status === 'CAPTURED' ? 'SUCCESS' : tx.status,
          payment_mode: tx.payment_mode,
          card_brand: tx.card_brand,
          card_type: tx.card_type,
          rrn: tx.rrn,
          settlement_status: tx.settlement_status,
          transaction_time: tx.txn_time,
          created_at: tx.created_at,
          retailer_code: retailer?.retailer_code || null,
          retailer_name: retailer?.name || null,
        }
      })

      const totalPages = count ? Math.ceil(count / limit) : 1
      const hasNextPage = page < totalPages
      const hasPrevPage = page > 1

      return NextResponse.json({
        success: true,
        data: enriched,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages,
          hasNextPage,
          hasPrevPage
        }
      })
    }

    // For admin, return all transactions (use admin endpoint logic)
    if (user.role === 'admin') {
      let query = supabase
        .from('razorpay_pos_transactions')
        .select('*', { count: 'exact' })
        .order('transaction_time', { ascending: false, nullsFirst: false })

      // Apply device_serial filter if provided
      if (targetDeviceSerial) {
        query = query.eq('device_serial', targetDeviceSerial)
      }

      query = query.range(offset, offset + limit - 1)

      const { data: transactions, error, count } = await query

      if (error) {
        console.error('Error fetching Razorpay POS transactions:', error)
        return NextResponse.json(
          { error: 'Failed to fetch transactions' },
          { status: 500 }
        )
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
          if (m.serial_number) {
            machineMap.set(m.serial_number, m.machine_id)
          }
        })
      }

      const enriched = (transactions || []).map((tx: any) => ({
        ...tx,
        machine_id: machineMap.get(tx.device_serial || '') || null
      }))

      const totalPages = count ? Math.ceil(count / limit) : 1
      const hasNextPage = page < totalPages
      const hasPrevPage = page > 1

      return NextResponse.json({
        success: true,
        data: enriched,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages,
          hasNextPage,
          hasPrevPage
        }
      })
    }

    // For non-admin users, get device serials they have access to
    let deviceSerials: string[] = []

    // Get mappings based on role
    let mappingQuery = supabase
      .from('pos_device_mapping')
      .select('device_serial')
      .eq('status', 'ACTIVE')

    if (user.role === 'master_distributor') {
      mappingQuery = mappingQuery.eq('master_distributor_id', user.partner_id)
    } else if (user.role === 'distributor') {
      mappingQuery = mappingQuery.eq('distributor_id', user.partner_id)
    } else if (user.role === 'retailer') {
      mappingQuery = mappingQuery.eq('retailer_id', user.partner_id)
    } else {
      // Partner role already handled above, other roles not supported
      return NextResponse.json(
        { error: 'Invalid user role' },
        { status: 403 }
      )
    }

    const { data: mappings, error: mappingError } = await mappingQuery

    if (mappingError) {
      console.error('Error fetching POS device mappings:', mappingError)
      return NextResponse.json(
        { error: 'Failed to fetch device mappings' },
        { status: 500 }
      )
    }

    // Extract device serials
    deviceSerials = (mappings || []).map((m: any) => m.device_serial).filter(Boolean)

    // If no mappings found, return empty result (non-admin users can't see unmapped transactions)
    if (deviceSerials.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false
        }
      })
    }

    // If machine_id or device_serial filter provided, validate access
    if (targetDeviceSerial) {
      if (!deviceSerials.includes(targetDeviceSerial)) {
        // Device not in user's access list
        return NextResponse.json({
          success: true,
          data: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false
          }
        })
      }
      // Filter to specific device
      deviceSerials = [targetDeviceSerial]
    }

    // Fetch transactions for these device serials
    let query = supabase
      .from('razorpay_pos_transactions')
      .select('*', { count: 'exact' })
      .in('device_serial', deviceSerials)
      .order('transaction_time', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    const { data: transactions, error, count } = await query

    if (error) {
      console.error('Error fetching Razorpay POS transactions:', error)
      return NextResponse.json(
        { error: 'Failed to fetch transactions' },
        { status: 500 }
      )
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
        if (m.serial_number) {
          machineMap.set(m.serial_number, m.machine_id)
        }
      })
    }

    const enriched = (transactions || []).map((tx: any) => ({
      ...tx,
      machine_id: machineMap.get(tx.device_serial || '') || null
    }))

    // Calculate pagination metadata
    const totalPages = count ? Math.ceil(count / limit) : 1
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    return NextResponse.json({
      success: true,
      data: enriched,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNextPage,
        hasPrevPage
      }
    })

  } catch (error: any) {
    console.error('Error in role-based Razorpay transactions API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

