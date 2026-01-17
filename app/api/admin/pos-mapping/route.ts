import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/pos-mapping
 * List all POS device mappings (admin-only)
 * Supports pagination and filtering
 */
export async function GET(request: NextRequest) {
  try {
    // Check admin authentication
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit
    const status = searchParams.get('status') // ACTIVE or INACTIVE
    const deviceSerial = searchParams.get('deviceSerial')
    const retailerId = searchParams.get('retailer_id')
    const distributorId = searchParams.get('distributor_id')
    const masterDistributorId = searchParams.get('master_distributor_id')

    // Build query
    let query = supabase
      .from('pos_device_mapping')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    // Apply filters
    if (status) {
      query = query.eq('status', status)
    }
    if (deviceSerial) {
      query = query.ilike('device_serial', `%${deviceSerial}%`)
    }
    if (retailerId) {
      query = query.eq('retailer_id', retailerId)
    }
    if (distributorId) {
      query = query.eq('distributor_id', distributorId)
    }
    if (masterDistributorId) {
      query = query.eq('master_distributor_id', masterDistributorId)
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    // Execute query
    const { data: mappings, error, count } = await query

    if (error) {
      console.error('Error fetching POS device mappings:', error)
      return NextResponse.json(
        { error: 'Failed to fetch POS mappings' },
        { status: 500 }
      )
    }

    // Calculate pagination metadata
    const totalPages = count ? Math.ceil(count / limit) : 1
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    return NextResponse.json({
      success: true,
      data: mappings || [],
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
    console.error('Error in GET admin POS mapping API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/pos-mapping
 * Create a new POS device mapping (admin-only)
 */
export async function POST(request: NextRequest) {
  try {
    // Check admin authentication
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      deviceSerial,
      tid,
      retailer_id,
      distributor_id,
      master_distributor_id,
      status = 'ACTIVE'
    } = body

    // Validation
    if (!deviceSerial) {
      return NextResponse.json(
        { error: 'deviceSerial is required' },
        { status: 400 }
      )
    }

    if (status && !['ACTIVE', 'INACTIVE'].includes(status)) {
      return NextResponse.json(
        { error: 'status must be ACTIVE or INACTIVE' },
        { status: 400 }
      )
    }

    // At least one of retailer_id, distributor_id, or master_distributor_id must be provided
    if (!retailer_id && !distributor_id && !master_distributor_id) {
      return NextResponse.json(
        { error: 'At least one of retailer_id, distributor_id, or master_distributor_id must be provided' },
        { status: 400 }
      )
    }

    // Check if device_serial already exists
    const { data: existing } = await supabase
      .from('pos_device_mapping')
      .select('id')
      .eq('device_serial', deviceSerial)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'Device serial already mapped. Use PUT to update existing mapping.' },
        { status: 400 }
      )
    }

    // Create mapping
    const { data: mapping, error } = await supabase
      .from('pos_device_mapping')
      .insert({
        device_serial: deviceSerial,
        tid: tid || null,
        retailer_id: retailer_id || null,
        distributor_id: distributor_id || null,
        master_distributor_id: master_distributor_id || null,
        status: status
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating POS device mapping:', error)
      return NextResponse.json(
        { error: 'Failed to create POS mapping' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'POS device mapping created successfully',
      data: mapping
    })

  } catch (error: any) {
    console.error('Error in POST admin POS mapping API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}




