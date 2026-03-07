import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/pos-machines/history/{posId}
 * Returns full assignment history for a specific POS machine.
 * Accessible by admin and the current holder of the device.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { posId: string } }
) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { user } = await getCurrentUserWithFallback(request)

    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const posId = params.posId
    if (!posId) {
      return NextResponse.json({ error: 'posId is required' }, { status: 400 })
    }

    // Fetch the machine to verify access
    const { data: machine, error: machineError } = await supabase
      .from('pos_machines')
      .select('id, machine_id, serial_number, retailer_id, distributor_id, master_distributor_id, partner_id, inventory_status, status, brand, tid, mid')
      .eq('id', posId)
      .single()

    if (machineError || !machine) {
      return NextResponse.json({ error: 'POS machine not found' }, { status: 404 })
    }

    // Access control: admin can see all, others only their own machines
    if (user.role !== 'admin') {
      const hasAccess =
        (user.role === 'retailer' && machine.retailer_id === user.partner_id) ||
        (user.role === 'distributor' && machine.distributor_id === user.partner_id) ||
        (user.role === 'master_distributor' && machine.master_distributor_id === user.partner_id) ||
        (user.role === 'partner' && machine.partner_id === user.partner_id)

      if (!hasAccess) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    // Fetch assignment history for this device
    const { data: history, error: historyError } = await supabase
      .from('pos_assignment_history')
      .select('*')
      .eq('pos_machine_id', posId)
      .order('created_at', { ascending: false })

    if (historyError) {
      console.error('[POS Device History] Error:', historyError)
      return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
    }

    // Resolve names
    const partnerIds = new Set<string>()
    for (const h of (history || [])) {
      if (h.assigned_to) partnerIds.add(h.assigned_to)
      if (h.assigned_by) partnerIds.add(h.assigned_by)
      if (h.previous_holder) partnerIds.add(h.previous_holder)
    }

    const nameMap: Record<string, string> = {}
    if (partnerIds.size > 0) {
      const ids = Array.from(partnerIds)
      const [ret, dist, md, partners, admins] = await Promise.all([
        supabase.from('retailers').select('partner_id, name').in('partner_id', ids),
        supabase.from('distributors').select('partner_id, name').in('partner_id', ids),
        supabase.from('master_distributors').select('partner_id, name').in('partner_id', ids),
        supabase.from('partners').select('id, name').in('id', ids),
        supabase.from('admin_users').select('email, name').in('email', ids),
      ])
      ret.data?.forEach((r: any) => { nameMap[r.partner_id] = r.name })
      dist.data?.forEach((d: any) => { nameMap[d.partner_id] = d.name })
      md.data?.forEach((m: any) => { nameMap[m.partner_id] = m.name })
      partners.data?.forEach((p: any) => { nameMap[p.id] = p.name })
      admins.data?.forEach((a: any) => { nameMap[a.email] = a.name })
    }

    return NextResponse.json({
      success: true,
      machine,
      history: history || [],
      nameMap,
    })
  } catch (err: any) {
    console.error('[POS Device History] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
