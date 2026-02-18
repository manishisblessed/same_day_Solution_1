import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/pos-machines/assign
 * Hierarchical POS machine assignment:
 * - Admin → Master Distributor (assign machines to MD)
 * - Admin → Partner (assign machines directly to co-branding partners)
 * - Master Distributor → Distributor (assign machines they hold to their distributors)
 * - Distributor → Retailer (assign machines they hold to their retailers)
 * 
 * Body: { machine_id: string, assign_to: string (partner_id or partner UUID), assign_to_type?: 'master_distributor' | 'partner', notes?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[POS Assign POST] Auth:', method, '|', user?.email || 'none', '| Role:', user?.role)

    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const body = await request.json()
    const { machine_id, assign_to, assign_to_type, notes } = body

    if (!machine_id) {
      return NextResponse.json({ error: 'machine_id is required' }, { status: 400 })
    }
    if (!assign_to) {
      return NextResponse.json({ error: 'assign_to (partner_id) is required' }, { status: 400 })
    }

    // Fetch the POS machine
    const { data: machine, error: fetchError } = await supabase
      .from('pos_machines')
      .select('*')
      .eq('id', machine_id)
      .single()

    if (fetchError || !machine) {
      return NextResponse.json({ error: 'POS machine not found' }, { status: 404 })
    }

    // Role-based assignment logic
    switch (user.role) {
      case 'admin': {
        // Admin can assign to Master Distributor OR Partner
        // Check assign_to_type to determine target, or try to detect automatically
        
        // Try Partner assignment first if assign_to_type is 'partner' or if assign_to looks like a UUID
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assign_to)
        const shouldAssignToPartner = assign_to_type === 'partner' || (isUUID && assign_to_type !== 'master_distributor')

        if (shouldAssignToPartner) {
          // Assign to Partner
          const { data: partner, error: partnerError } = await supabase
            .from('partners')
            .select('id, name, status')
            .eq('id', assign_to)
            .single()

          if (partnerError || !partner) {
            return NextResponse.json({ error: 'Invalid Partner selected' }, { status: 400 })
          }
          if (partner.status !== 'active') {
            return NextResponse.json({ error: 'Partner is not active' }, { status: 400 })
          }

          // Machine must be in_stock or received_from_bank to assign to Partner
          if (machine.inventory_status && !['in_stock', 'received_from_bank'].includes(machine.inventory_status)) {
            return NextResponse.json({ 
              error: `Machine is currently "${machine.inventory_status}". Only in_stock or received_from_bank machines can be assigned to a Partner.` 
            }, { status: 400 })
          }

          // Update machine - clear hierarchical assignments when assigning to partner
          const { error: updateError } = await supabase
            .from('pos_machines')
            .update({
              partner_id: assign_to,
              master_distributor_id: null,
              distributor_id: null,
              retailer_id: null,
              inventory_status: 'assigned_to_partner',
              assigned_by: user.email,
              assigned_by_role: 'admin',
              last_assigned_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', machine_id)

          if (updateError) {
            console.error('Error assigning machine to Partner:', updateError)
            return NextResponse.json({ error: 'Failed to assign machine' }, { status: 500 })
          }

          // Also update pos_device_mapping if machine has a serial_number (clear retailer/distributor/MD assignments)
          if (machine.serial_number) {
            const { data: existingMapping } = await supabase
              .from('pos_device_mapping')
              .select('id')
              .eq('device_serial', machine.serial_number)
              .single()

            if (existingMapping) {
              await supabase
                .from('pos_device_mapping')
                .update({
                  retailer_id: null,
                  distributor_id: null,
                  master_distributor_id: null,
                  status: 'INACTIVE', // Set to inactive since it's assigned to partner, not in hierarchical flow
                })
                .eq('id', existingMapping.id)
            }
          }

          // Record history
          await supabase.from('pos_assignment_history').insert({
            pos_machine_id: machine_id,
            machine_id: machine.machine_id,
            action: 'assigned_to_partner',
            assigned_by: user.email,
            assigned_by_role: 'admin',
            assigned_to: assign_to,
            assigned_to_role: 'partner',
            previous_holder: machine.partner_id || machine.retailer_id || machine.distributor_id || machine.master_distributor_id || null,
            previous_holder_role: machine.partner_id ? 'partner' : machine.retailer_id ? 'retailer' : machine.distributor_id ? 'distributor' : machine.master_distributor_id ? 'master_distributor' : null,
            notes: notes || `Admin assigned to Partner ${partner.name}`,
          })

          return NextResponse.json({
            success: true,
            message: `POS machine ${machine.machine_id} assigned to Partner ${partner.name}`,
          })
        } else {
          // Assign to Master Distributor (existing logic)
          const { data: md, error: mdError } = await supabase
            .from('master_distributors')
            .select('partner_id, name, status')
            .eq('partner_id', assign_to)
            .single()

          if (mdError || !md) {
            return NextResponse.json({ error: 'Invalid Master Distributor selected' }, { status: 400 })
          }
          if (md.status !== 'active') {
            return NextResponse.json({ error: 'Master Distributor is not active' }, { status: 400 })
          }

          // Machine must be in_stock or received_from_bank to assign to MD
          if (machine.inventory_status && !['in_stock', 'received_from_bank'].includes(machine.inventory_status)) {
            return NextResponse.json({ 
              error: `Machine is currently "${machine.inventory_status}". Only in_stock or received_from_bank machines can be assigned to a Master Distributor.` 
            }, { status: 400 })
          }

          // Update machine - clear partner assignment when assigning to MD
          const { error: updateError } = await supabase
            .from('pos_machines')
            .update({
              master_distributor_id: assign_to,
              partner_id: null,
              distributor_id: null,
              retailer_id: null,
              inventory_status: 'assigned_to_master_distributor',
              assigned_by: user.email,
              assigned_by_role: 'admin',
              last_assigned_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', machine_id)

          if (updateError) {
            console.error('Error assigning machine to MD:', updateError)
            return NextResponse.json({ error: 'Failed to assign machine' }, { status: 500 })
          }

          // Record history
          await supabase.from('pos_assignment_history').insert({
            pos_machine_id: machine_id,
            machine_id: machine.machine_id,
            action: 'assigned_to_master_distributor',
            assigned_by: user.email,
            assigned_by_role: 'admin',
            assigned_to: assign_to,
            assigned_to_role: 'master_distributor',
            previous_holder: machine.master_distributor_id || null,
            previous_holder_role: machine.master_distributor_id ? 'master_distributor' : null,
            notes: notes || `Admin assigned to ${md.name}`,
          })

          return NextResponse.json({
            success: true,
            message: `POS machine ${machine.machine_id} assigned to Master Distributor ${md.name}`,
          })
        }
      }

      case 'master_distributor': {
        // MD can assign machines they hold to their Distributors
        // Verify the machine is assigned to this MD
        if (machine.master_distributor_id !== user.partner_id) {
          return NextResponse.json({ error: 'This machine is not assigned to you' }, { status: 403 })
        }

        // Machine must be assigned_to_master_distributor to assign to distributor
        if (machine.inventory_status !== 'assigned_to_master_distributor') {
          return NextResponse.json({ 
            error: `Machine is currently "${machine.inventory_status}". Only machines in your inventory (assigned_to_master_distributor) can be assigned to a Distributor.` 
          }, { status: 400 })
        }

        // Verify the target is a valid distributor under this MD
        const { data: dist, error: distError } = await supabase
          .from('distributors')
          .select('partner_id, name, status, master_distributor_id')
          .eq('partner_id', assign_to)
          .single()

        if (distError || !dist) {
          return NextResponse.json({ error: 'Invalid Distributor selected' }, { status: 400 })
        }
        if (dist.master_distributor_id !== user.partner_id) {
          return NextResponse.json({ error: 'This Distributor is not under your network' }, { status: 403 })
        }
        if (dist.status !== 'active') {
          return NextResponse.json({ error: 'Distributor is not active' }, { status: 400 })
        }

        // Update machine
        const { error: updateError } = await supabase
          .from('pos_machines')
          .update({
            distributor_id: assign_to,
            retailer_id: null,
            inventory_status: 'assigned_to_distributor',
            assigned_by: user.partner_id,
            assigned_by_role: 'master_distributor',
            last_assigned_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', machine_id)

        if (updateError) {
          console.error('Error assigning machine to Distributor:', updateError)
          return NextResponse.json({ error: 'Failed to assign machine' }, { status: 500 })
        }

        // Record history
        await supabase.from('pos_assignment_history').insert({
          pos_machine_id: machine_id,
          machine_id: machine.machine_id,
          action: 'assigned_to_distributor',
          assigned_by: user.partner_id,
          assigned_by_role: 'master_distributor',
          assigned_to: assign_to,
          assigned_to_role: 'distributor',
          previous_holder: machine.distributor_id || null,
          previous_holder_role: machine.distributor_id ? 'distributor' : null,
          notes: notes || `Master Distributor assigned to ${dist.name}`,
        })

        return NextResponse.json({
          success: true,
          message: `POS machine ${machine.machine_id} assigned to Distributor ${dist.name}`,
        })
      }

      case 'distributor': {
        // Distributor can assign machines they hold to their Retailers
        // Verify the machine is assigned to this Distributor
        if (machine.distributor_id !== user.partner_id) {
          return NextResponse.json({ error: 'This machine is not assigned to you' }, { status: 403 })
        }

        // Machine must be assigned_to_distributor to assign to retailer
        if (machine.inventory_status !== 'assigned_to_distributor') {
          return NextResponse.json({ 
            error: `Machine is currently "${machine.inventory_status}". Only machines in your inventory (assigned_to_distributor) can be assigned to a Retailer.` 
          }, { status: 400 })
        }

        // Verify the target is a valid retailer under this Distributor
        const { data: retailer, error: retailerError } = await supabase
          .from('retailers')
          .select('partner_id, name, status, distributor_id')
          .eq('partner_id', assign_to)
          .single()

        if (retailerError || !retailer) {
          return NextResponse.json({ error: 'Invalid Retailer selected' }, { status: 400 })
        }
        if (retailer.distributor_id !== user.partner_id) {
          return NextResponse.json({ error: 'This Retailer is not under your network' }, { status: 403 })
        }
        if (retailer.status !== 'active') {
          return NextResponse.json({ error: 'Retailer is not active' }, { status: 400 })
        }

        // Update machine
        const { error: updateError } = await supabase
          .from('pos_machines')
          .update({
            retailer_id: assign_to,
            inventory_status: 'assigned_to_retailer',
            assigned_by: user.partner_id,
            assigned_by_role: 'distributor',
            last_assigned_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', machine_id)

        if (updateError) {
          console.error('Error assigning machine to Retailer:', updateError)
          return NextResponse.json({ error: 'Failed to assign machine' }, { status: 500 })
        }

        // Record history
        await supabase.from('pos_assignment_history').insert({
          pos_machine_id: machine_id,
          machine_id: machine.machine_id,
          action: 'assigned_to_retailer',
          assigned_by: user.partner_id,
          assigned_by_role: 'distributor',
          assigned_to: assign_to,
          assigned_to_role: 'retailer',
          previous_holder: machine.retailer_id || null,
          previous_holder_role: machine.retailer_id ? 'retailer' : null,
          notes: notes || `Distributor assigned to ${retailer.name}`,
        })

        // Also update pos_device_mapping if machine has a serial_number (for Razorpay transaction visibility)
        if (machine.serial_number) {
          const { data: existingMapping } = await supabase
            .from('pos_device_mapping')
            .select('id')
            .eq('device_serial', machine.serial_number)
            .single()

          if (existingMapping) {
            await supabase
              .from('pos_device_mapping')
              .update({
                retailer_id: assign_to,
                distributor_id: user.partner_id,
                master_distributor_id: machine.master_distributor_id,
              })
              .eq('id', existingMapping.id)
          } else {
            await supabase
              .from('pos_device_mapping')
              .insert({
                device_serial: machine.serial_number,
                retailer_id: assign_to,
                distributor_id: user.partner_id,
                master_distributor_id: machine.master_distributor_id,
                status: 'ACTIVE',
              })
          }
        }

        return NextResponse.json({
          success: true,
          message: `POS machine ${machine.machine_id} assigned to Retailer ${retailer.name}`,
        })
      }

      default:
        return NextResponse.json({ error: 'Retailers cannot assign POS machines' }, { status: 403 })
    }

  } catch (error: any) {
    console.error('Error in POST /api/pos-machines/assign:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

