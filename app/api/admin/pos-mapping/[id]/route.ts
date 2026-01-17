import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

/**
 * PUT /api/admin/pos-mapping/:id
 * Update an existing POS device mapping (admin-only)
 * Uses status=INACTIVE for "disabling" instead of deletion
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check admin authentication
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    const { id } = params
    if (!id) {
      return NextResponse.json(
        { error: 'Mapping ID is required' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const {
      deviceSerial,
      tid,
      retailer_id,
      distributor_id,
      master_distributor_id,
      status
    } = body

    // Build update object (only include provided fields)
    const updateData: any = {}
    
    if (deviceSerial !== undefined) updateData.device_serial = deviceSerial
    if (tid !== undefined) updateData.tid = tid
    if (retailer_id !== undefined) updateData.retailer_id = retailer_id
    if (distributor_id !== undefined) updateData.distributor_id = distributor_id
    if (master_distributor_id !== undefined) updateData.master_distributor_id = master_distributor_id
    if (status !== undefined) {
      if (!['ACTIVE', 'INACTIVE'].includes(status)) {
        return NextResponse.json(
          { error: 'status must be ACTIVE or INACTIVE' },
          { status: 400 }
        )
      }
      updateData.status = status
    }

    // If updating device_serial, check for duplicates
    if (deviceSerial) {
      const { data: existing } = await supabase
        .from('pos_device_mapping')
        .select('id')
        .eq('device_serial', deviceSerial)
        .neq('id', id)
        .single()

      if (existing) {
        return NextResponse.json(
          { error: 'Device serial already mapped to another device' },
          { status: 400 }
        )
      }
    }

    // At least one of retailer_id, distributor_id, or master_distributor_id must be provided if updating
    if (retailer_id === null && distributor_id === null && master_distributor_id === null) {
      // Check if all are being set to null
      const { data: current } = await supabase
        .from('pos_device_mapping')
        .select('retailer_id, distributor_id, master_distributor_id')
        .eq('id', id)
        .single()

      if (current && !current.retailer_id && !current.distributor_id && !current.master_distributor_id) {
        return NextResponse.json(
          { error: 'At least one of retailer_id, distributor_id, or master_distributor_id must be provided' },
          { status: 400 }
        )
      }
    }

    // Update mapping
    const { data: mapping, error } = await supabase
      .from('pos_device_mapping')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating POS device mapping:', error)
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Mapping not found' },
          { status: 404 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to update POS mapping' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'POS device mapping updated successfully',
      data: mapping
    })

  } catch (error: any) {
    console.error('Error in PUT admin POS mapping API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}




