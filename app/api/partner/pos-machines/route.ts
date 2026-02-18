import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/**
 * GET /api/partner/pos-machines
 * 
 * Returns POS machines assigned to the authenticated partner.
 * 
 * Authentication: HMAC-SHA256 via headers (x-api-key, x-signature, x-timestamp)
 * Permission required: read
 * 
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Records per page (default: 50, max: 100)
 * - status: Filter by status (active, inactive, maintenance, damaged, returned)
 * - machine_type: Filter by type (POS, WPOS, Mini-ATM)
 * - search: Search by machine_id, serial_number, MID, TID
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Server configuration error',
          },
        },
        { status: 500 }
      )
    }

    // Authenticate partner
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const authError = error as PartnerAuthError
      return NextResponse.json(
        {
          success: false,
          error: {
            code: authError.code,
            message: authError.message,
          },
        },
        { status: authError.status }
      )
    }

    const { partner } = authResult

    // Check permission
    if (!partner.permissions.includes('read')) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions. "read" permission required.',
          },
        },
        { status: 403 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)))
    const offset = (page - 1) * limit
    const statusFilter = searchParams.get('status')
    const machineTypeFilter = searchParams.get('machine_type')
    const search = searchParams.get('search')

    // Build query - only machines assigned to this partner
    let query = supabase
      .from('pos_machines')
      .select('*', { count: 'exact' })
      .eq('partner_id', partner.id)
      .eq('inventory_status', 'assigned_to_partner')
      .order('created_at', { ascending: false })

    // Apply filters
    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    if (machineTypeFilter && machineTypeFilter !== 'all') {
      query = query.eq('machine_type', machineTypeFilter)
    }

    if (search) {
      query = query.or(
        `machine_id.ilike.%${search}%,serial_number.ilike.%${search}%,mid.ilike.%${search}%,tid.ilike.%${search}%,brand.ilike.%${search}%`
      )
    }

    // Pagination
    query = query.range(offset, offset + limit - 1)

    const { data: machines, error, count } = await query

    if (error) {
      console.error('Error fetching partner POS machines:', error)
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch POS machines',
          },
        },
        { status: 500 }
      )
    }

    // Format response - only include relevant fields for partners
    const formattedMachines = (machines || []).map((machine: any) => ({
      id: machine.id,
      machine_id: machine.machine_id,
      serial_number: machine.serial_number,
      mid: machine.mid,
      tid: machine.tid,
      brand: machine.brand,
      machine_type: machine.machine_type,
      status: machine.status,
      inventory_status: machine.inventory_status,
      delivery_date: machine.delivery_date,
      installation_date: machine.installation_date,
      location: machine.location,
      city: machine.city,
      state: machine.state,
      pincode: machine.pincode,
      created_at: machine.created_at,
      updated_at: machine.updated_at,
    }))

    const totalPages = count ? Math.ceil(count / limit) : 1

    return NextResponse.json({
      success: true,
      data: formattedMachines,
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: totalPages,
        has_next_page: page < totalPages,
        has_prev_page: page > 1,
      },
    })
  } catch (error: any) {
    console.error('Error in GET /api/partner/pos-machines:', error)
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      },
      { status: 500 }
    )
  }
}

