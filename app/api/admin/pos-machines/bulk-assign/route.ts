import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import {
  adminAssignOneToDistributor,
  adminAssignOneToMasterDistributor,
  adminAssignOneToRetailer,
} from '@/lib/pos-machine-admin-assign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BULK = 100

type AssignToType = 'master_distributor' | 'distributor' | 'retailer'

/**
 * POST /api/admin/pos-machines/bulk-assign
 * Admin only. Assign many machines to one Master Distributor, Distributor, or Retailer.
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
      return NextResponse.json({ error: 'Unauthorized. Admin only.' }, { status: 403 })
    }

    const body = await request.json()
    const {
      machine_ids: machineIdsRaw,
      assign_to: assignTo,
      assign_to_type: assignToType,
      notes,
      subscription_amount,
      billing_day,
      gst_percent,
    } = body

    if (!assignTo || typeof assignTo !== 'string') {
      return NextResponse.json({ error: 'assign_to is required' }, { status: 400 })
    }

    const validTypes: AssignToType[] = ['master_distributor', 'distributor', 'retailer']
    if (!assignToType || !validTypes.includes(assignToType)) {
      return NextResponse.json(
        { error: 'assign_to_type must be master_distributor, distributor, or retailer' },
        { status: 400 }
      )
    }

    if (!Array.isArray(machineIdsRaw) || machineIdsRaw.length === 0) {
      return NextResponse.json({ error: 'machine_ids must be a non-empty array' }, { status: 400 })
    }

    const machineIds = Array.from(new Set(machineIdsRaw.map((id: unknown) => String(id)).filter(Boolean)))
    if (machineIds.length > MAX_BULK) {
      return NextResponse.json({ error: `At most ${MAX_BULK} machines per request` }, { status: 400 })
    }

    const subAmount = subscription_amount != null ? Number(subscription_amount) : null
    const bDay = billing_day != null ? Math.max(1, Math.min(28, parseInt(String(billing_day), 10) || 1)) : 1
    const gst = gst_percent != null ? Number(gst_percent) : 18

    const { data: machines, error: fetchError } = await supabase
      .from('pos_machines')
      .select('*')
      .in('id', machineIds)

    if (fetchError) {
      console.error('[bulk-assign] fetch machines:', fetchError)
      return NextResponse.json({ error: 'Failed to load machines' }, { status: 500 })
    }

    const byId = new Map((machines || []).map((m: any) => [m.id, m]))
    const succeeded: { id: string; machine_id: string; message: string }[] = []
    const failed: { id: string; error: string }[] = []

    for (const id of machineIds) {
      const machine = byId.get(id)
      if (!machine) {
        failed.push({ id, error: 'POS machine not found' })
        continue
      }

      const { data: activeAssignment } = await supabase
        .from('pos_assignment_history')
        .select('id, assigned_to, assigned_to_role')
        .eq('pos_machine_id', id)
        .eq('status', 'active')
        .like('action', 'assigned_to_%')
        .limit(1)
        .maybeSingle()

      let result
      if (assignToType === 'master_distributor') {
        result = await adminAssignOneToMasterDistributor(
          supabase,
          request,
          user,
          machine,
          assignTo,
          notes,
          activeAssignment,
          subAmount,
          bDay,
          gst
        )
      } else if (assignToType === 'distributor') {
        result = await adminAssignOneToDistributor(
          supabase,
          request,
          user,
          machine,
          assignTo,
          notes,
          activeAssignment,
          subAmount,
          bDay,
          gst
        )
      } else {
        result = await adminAssignOneToRetailer(
          supabase,
          request,
          user,
          machine,
          assignTo,
          notes,
          activeAssignment,
          subAmount,
          bDay,
          gst
        )
      }

      if (result.ok) {
        succeeded.push({ id, machine_id: machine.machine_id, message: result.message })
      } else {
        failed.push({ id, error: result.error })
      }
    }

    return NextResponse.json({
      success: failed.length === 0,
      total: machineIds.length,
      succeeded_count: succeeded.length,
      failed_count: failed.length,
      succeeded,
      failed,
    })
  } catch (error: any) {
    console.error('Error in POST /api/admin/pos-machines/bulk-assign:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
