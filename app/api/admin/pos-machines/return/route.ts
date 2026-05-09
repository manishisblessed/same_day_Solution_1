import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { deactivateSubscriptionItemsForMachine } from '@/lib/subscription/deactivate-items-for-machine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const POS_COLUMNS = [
  'id', 'machine_id', 'serial_number',
  'retailer_id', 'distributor_id', 'master_distributor_id', 'partner_id',
  'machine_type', 'status', 'inventory_status',
  'mid', 'tid', 'brand',
  'assigned_by', 'assigned_by_role', 'last_assigned_at',
  'notes', 'created_at', 'updated_at'
].join(',')

/**
 * POST /api/admin/pos-machines/return
 * Return a POS machine to stock using raw PostgREST PATCH for reliability.
 * Verifies the update actually took effect.
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const headers = {
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=representation',
    }

    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized. Admin only.' }, { status: 403 })
    }

    const body = await request.json()
    const { machine_id, return_reason, return_date: returnDateInput } = body
    const effectiveReturnDate = returnDateInput || new Date().toISOString()

    if (!machine_id) {
      return NextResponse.json({ error: 'machine_id is required' }, { status: 400 })
    }

    // Step 1: Fetch machine using raw PostgREST GET
    const fetchUrl = `${supabaseUrl}/rest/v1/pos_machines?id=eq.${machine_id}&select=${POS_COLUMNS}`
    const fetchRes = await fetch(fetchUrl, { headers: { ...headers, 'Prefer': '' }, cache: 'no-store' })

    if (!fetchRes.ok) {
      const errBody = await fetchRes.text()
      console.error('[POS Return] Fetch error:', fetchRes.status, errBody)
      return NextResponse.json({ error: 'Failed to fetch machine' }, { status: 500 })
    }

    const machines = await fetchRes.json()
    if (!machines || machines.length === 0) {
      return NextResponse.json({ error: 'POS machine not found' }, { status: 404 })
    }

    const machine = machines[0]
    const currentStatus = machine.inventory_status

    console.log('[POS Return] Machine state BEFORE update:', {
      id: machine.id,
      machine_id: machine.machine_id,
      inventory_status: machine.inventory_status,
      retailer_id: machine.retailer_id,
      distributor_id: machine.distributor_id,
      master_distributor_id: machine.master_distributor_id,
      partner_id: machine.partner_id,
    })

    const canReturn = [
      'assigned_to_retailer',
      'assigned_to_distributor',
      'assigned_to_master_distributor',
      'assigned_to_partner',
    ].includes(currentStatus)

    if (!canReturn) {
      return NextResponse.json(
        { error: `Machine cannot be returned. Current status: ${currentStatus}. Only assigned machines can be returned to stock.` },
        { status: 400 }
      )
    }

    const previousHolder = machine.retailer_id || machine.distributor_id || machine.master_distributor_id || machine.partner_id
    const previousHolderRole = machine.retailer_id
      ? 'retailer'
      : machine.distributor_id
        ? 'distributor'
        : machine.master_distributor_id
          ? 'master_distributor'
          : machine.partner_id
            ? 'partner'
            : null

    // Step 2: Update pos_machines using raw PostgREST PATCH
    const patchUrl = `${supabaseUrl}/rest/v1/pos_machines?id=eq.${machine_id}`
    const patchBody = {
      inventory_status: 'in_stock',
      retailer_id: null,
      distributor_id: null,
      master_distributor_id: null,
      partner_id: null,
      assigned_by: null,
      assigned_by_role: null,
      last_assigned_at: null,
      updated_at: new Date().toISOString(),
    }

    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patchBody),
    })

    if (!patchRes.ok) {
      const errBody = await patchRes.text()
      console.error('[POS Return] PATCH error:', patchRes.status, errBody)
      return NextResponse.json({ error: `Failed to update machine: ${errBody}` }, { status: 500 })
    }

    const patchResult = await patchRes.json()
    console.log('[POS Return] PATCH result:', JSON.stringify(patchResult))

    // Step 3: VERIFY the update actually took effect
    const verifyRes = await fetch(fetchUrl, { headers: { ...headers, 'Prefer': '' }, cache: 'no-store' })
    if (verifyRes.ok) {
      const verifyData = await verifyRes.json()
      const updated = verifyData[0]
      if (updated) {
        console.log('[POS Return] Machine state AFTER update:', {
          id: updated.id,
          inventory_status: updated.inventory_status,
          retailer_id: updated.retailer_id,
          distributor_id: updated.distributor_id,
        })

        if (updated.inventory_status !== 'in_stock') {
          console.error('[POS Return] VERIFICATION FAILED! inventory_status is still:', updated.inventory_status)
          return NextResponse.json({
            error: `Return verification failed. Machine status is still "${updated.inventory_status}". Please try again or contact support.`,
            debug: { before: currentStatus, after: updated.inventory_status }
          }, { status: 500 })
        }

        if (updated.retailer_id || updated.distributor_id || updated.master_distributor_id || updated.partner_id) {
          console.error('[POS Return] VERIFICATION FAILED! Ownership fields not cleared:', {
            retailer_id: updated.retailer_id,
            distributor_id: updated.distributor_id,
            master_distributor_id: updated.master_distributor_id,
            partner_id: updated.partner_id,
          })
          return NextResponse.json({
            error: 'Return verification failed. Ownership not fully cleared. Please try again.',
          }, { status: 500 })
        }
      }
    }

    // Step 3b: Deactivate subscription items for this machine so subscriptions stay in sync
    if (machine.machine_id) {
      try {
        const { deactivated, subscriptionsUpdated } = await deactivateSubscriptionItemsForMachine(supabase, machine.machine_id)
        if (deactivated > 0) {
          console.log('[POS Return] Deactivated', deactivated, 'subscription item(s) for machine', machine.machine_id, 'subscriptions updated:', subscriptionsUpdated.length)
        }
      } catch (e) {
        console.error('[POS Return] Deactivate subscription items failed:', e)
      }
    }

    // Step 4: Clean up related tables
    if (machine.serial_number) {
      await fetch(`${supabaseUrl}/rest/v1/pos_device_mapping?device_serial=eq.${encodeURIComponent(machine.serial_number)}`, {
        method: 'DELETE',
        headers,
      }).catch(e => console.error('[POS Return] Delete mapping error:', e))
    }

    if (machine.tid) {
      await fetch(`${supabaseUrl}/rest/v1/partner_pos_machines?terminal_id=eq.${encodeURIComponent(machine.tid)}`, {
        method: 'DELETE',
        headers,
      }).catch(e => console.error('[POS Return] Delete partner machine error:', e))
    }

    // Step 5: Mark active assignment(s) as returned in history
    try {
      const historyPatchUrl = `${supabaseUrl}/rest/v1/pos_assignment_history?pos_machine_id=eq.${machine_id}&status=eq.active&action=like.assigned_to_%25`
      const histPatchRes = await fetch(historyPatchUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'returned', returned_date: effectiveReturnDate }),
      })
      if (!histPatchRes.ok) {
        const errBody = await histPatchRes.text()
        console.error('[POS Return] History PATCH error:', histPatchRes.status, errBody)
      } else {
        const patched = await histPatchRes.json()
        console.log('[POS Return] Marked', Array.isArray(patched) ? patched.length : 0, 'active assignment(s) as returned')
      }
    } catch (e) {
      console.error('[POS Return] History update failed:', e)
    }

    // Step 6: Insert unassign history record
    const unassignAction = previousHolderRole
      ? `unassigned_from_${previousHolderRole}`
      : 'unassigned_from_retailer'

    try {
      const histInsertRes = await fetch(`${supabaseUrl}/rest/v1/pos_assignment_history`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pos_machine_id: machine_id,
          machine_id: machine.machine_id || machine.id,
          action: unassignAction,
          assigned_by: user.email || user.partner_id || user.id,
          assigned_by_role: 'admin',
          assigned_to: null,
          assigned_to_role: null,
          previous_holder: previousHolder,
          previous_holder_role: previousHolderRole,
          status: 'returned',
          returned_date: effectiveReturnDate,
          return_reason: return_reason || null,
          notes: `Returned to stock by admin. Was ${currentStatus}.${return_reason ? ` Reason: ${return_reason}` : ''}`,
        }),
      })
      if (!histInsertRes.ok) {
        const errBody = await histInsertRes.text()
        console.error('[POS Return] History INSERT error:', histInsertRes.status, errBody)
      } else {
        console.log('[POS Return] History record created:', unassignAction)
      }
    } catch (e) {
      console.error('[POS Return] History insert failed:', e)
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'pos_machine_return_to_stock',
      activity_category: 'pos',
      activity_description: `Returned POS machine ${machine.machine_id || machine.serial_number || machine_id} to stock (was ${currentStatus})`,
      reference_table: 'pos_machines',
      reference_id: machine_id,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: 'Machine returned to stock successfully',
      machine_id,
      previous_status: currentStatus,
    })
  } catch (error: any) {
    console.error('[POS Return] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
