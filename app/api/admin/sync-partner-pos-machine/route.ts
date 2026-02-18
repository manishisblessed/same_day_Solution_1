import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/sync-partner-pos-machine
 * Sync a POS machine from pos_machines to partner_pos_machines when assigned to a partner
 * 
 * Body: { machine_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user } = await getCurrentUserWithFallback(request)

    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const { machine_id } = body

    if (!machine_id) {
      return NextResponse.json({ error: 'machine_id is required' }, { status: 400 })
    }

    // Fetch the machine
    const { data: machine, error: fetchError } = await supabase
      .from('pos_machines')
      .select('*')
      .eq('id', machine_id)
      .single()

    if (fetchError || !machine) {
      return NextResponse.json({ error: 'POS machine not found' }, { status: 404 })
    }

    // Only sync if assigned to partner
    if (!machine.partner_id || machine.inventory_status !== 'assigned_to_partner') {
      // If not assigned to partner, remove from partner_pos_machines if exists
      if (machine.tid) {
        await supabase
          .from('partner_pos_machines')
          .delete()
          .eq('terminal_id', machine.tid)
      }
      return NextResponse.json({ 
        success: true, 
        message: 'Machine not assigned to partner - no sync needed',
        synced: false 
      })
    }

    // Get or create default retailer for this partner
    let retailerId: string | null = null
    const { data: existingRetailer } = await supabase
      .from('partner_retailers')
      .select('id')
      .eq('partner_id', machine.partner_id)
      .limit(1)
      .single()

    if (existingRetailer) {
      retailerId = existingRetailer.id
    } else {
      // Get partner info to create default retailer
      const { data: partner } = await supabase
        .from('partners')
        .select('name, business_name')
        .eq('id', machine.partner_id)
        .single()

      if (partner) {
        const { data: newRetailer, error: retailerError } = await supabase
          .from('partner_retailers')
          .insert({
            partner_id: machine.partner_id,
            retailer_code: `RET-${partner.name.toUpperCase().replace(/\s+/g, '-')}-001`,
            name: `${partner.name} Default Retailer`,
            business_name: partner.business_name || partner.name,
            status: 'active',
          })
          .select('id')
          .single()

        if (!retailerError && newRetailer) {
          retailerId = newRetailer.id
        }
      }
    }

    // Sync to partner_pos_machines (only if TID exists)
    if (!machine.tid) {
      return NextResponse.json({ 
        success: true, 
        message: 'Machine has no TID - cannot sync to partner_pos_machines',
        synced: false 
      })
    }

    // Check if entry already exists
    const { data: existingPartnerMachine } = await supabase
      .from('partner_pos_machines')
      .select('id')
      .eq('terminal_id', machine.tid)
      .single()

    const partnerMachineData: any = {
      partner_id: machine.partner_id,
      retailer_id: retailerId,
      terminal_id: machine.tid,
      device_serial: machine.serial_number || null,
      machine_model: machine.brand === 'RAZORPAY' ? 'Razorpay POS' : machine.brand || 'POS',
      status: machine.status === 'active' ? 'active' : 'inactive',
      activated_at: machine.installation_date || new Date().toISOString(),
      metadata: machine.mid ? { mid: machine.mid } : {},
    }

    if (existingPartnerMachine) {
      // Update existing entry
      const { error: updateError } = await supabase
        .from('partner_pos_machines')
        .update(partnerMachineData)
        .eq('id', existingPartnerMachine.id)

      if (updateError) {
        console.error('Error updating partner_pos_machines:', updateError)
        return NextResponse.json({ error: 'Failed to sync to partner_pos_machines' }, { status: 500 })
      }
    } else {
      // Insert new entry
      const { error: insertError } = await supabase
        .from('partner_pos_machines')
        .insert(partnerMachineData)

      if (insertError) {
        console.error('Error inserting into partner_pos_machines:', insertError)
        return NextResponse.json({ error: 'Failed to sync to partner_pos_machines' }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Machine synced to partner_pos_machines',
      synced: true,
    })

  } catch (error: any) {
    console.error('Error in sync-partner-pos-machine:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

