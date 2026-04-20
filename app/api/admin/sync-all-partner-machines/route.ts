import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/sync-all-partner-machines
 * Sync ALL POS machines from pos_machines to partner_pos_machines for a given partner
 * 
 * Body: { partner_id: string }
 * 
 * This will:
 * 1. Find all machines in pos_machines where partner_id matches and inventory_status = 'assigned_to_partner'
 * 2. For each machine with a TID, upsert into partner_pos_machines
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
    const { partner_id } = body

    if (!partner_id) {
      return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
    }

    // Get partner info
    const { data: partner, error: partnerError } = await supabase
      .from('partners')
      .select('id, name, business_name')
      .eq('id', partner_id)
      .single()

    if (partnerError || !partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    // Get or create default retailer for this partner
    let retailerId: string | null = null
    const { data: existingRetailer } = await supabase
      .from('partner_retailers')
      .select('id')
      .eq('partner_id', partner_id)
      .limit(1)
      .single()

    if (existingRetailer) {
      retailerId = existingRetailer.id
    } else {
      const { data: newRetailer } = await supabase
        .from('partner_retailers')
        .insert({
          partner_id: partner_id,
          retailer_code: `RET-${partner.name.toUpperCase().replace(/\s+/g, '-')}-001`,
          name: `${partner.name} Default Retailer`,
          business_name: partner.business_name || partner.name,
          status: 'active',
        })
        .select('id')
        .single()

      if (newRetailer) {
        retailerId = newRetailer.id
      }
    }

    // Fetch ALL machines assigned to this partner
    const { data: machines, error: fetchError } = await supabase
      .from('pos_machines')
      .select('*')
      .eq('partner_id', partner_id)
      .eq('inventory_status', 'assigned_to_partner')

    if (fetchError) {
      console.error('Error fetching machines:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch machines' }, { status: 500 })
    }

    if (!machines || machines.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No machines found for this partner',
        synced: 0,
        skipped: 0,
        total: 0,
      })
    }

    let synced = 0
    let skipped = 0
    const errors: string[] = []

    for (const machine of machines) {
      if (!machine.tid) {
        skipped++
        errors.push(`Machine ${machine.machine_id || machine.serial_number}: No TID`)
        continue
      }

      // Check if entry already exists
      const { data: existingPartnerMachine } = await supabase
        .from('partner_pos_machines')
        .select('id')
        .eq('terminal_id', machine.tid)
        .single()

      const partnerMachineData: any = {
        partner_id: partner_id,
        retailer_id: retailerId,
        terminal_id: machine.tid,
        device_serial: machine.serial_number || null,
        machine_model: machine.brand === 'RAZORPAY' ? 'Razorpay POS' : machine.brand || 'POS',
        status: machine.status === 'active' ? 'active' : 'inactive',
        activated_at: machine.installation_date || new Date().toISOString(),
        metadata: machine.mid ? { mid: machine.mid } : {},
      }

      if (existingPartnerMachine) {
        const { error: updateError } = await supabase
          .from('partner_pos_machines')
          .update(partnerMachineData)
          .eq('id', existingPartnerMachine.id)

        if (updateError) {
          errors.push(`Machine ${machine.tid}: Update failed - ${updateError.message}`)
          continue
        }
      } else {
        const { error: insertError } = await supabase
          .from('partner_pos_machines')
          .insert(partnerMachineData)

        if (insertError) {
          errors.push(`Machine ${machine.tid}: Insert failed - ${insertError.message}`)
          continue
        }
      }

      synced++
    }

    return NextResponse.json({
      success: true,
      message: `Synced ${synced} machines for partner ${partner.name}`,
      synced,
      skipped,
      total: machines.length,
      errors: errors.length > 0 ? errors : undefined,
    })

  } catch (error: any) {
    console.error('Error in sync-all-partner-machines:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
