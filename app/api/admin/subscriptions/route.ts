import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/** GET - List all subscriptions (admin). Returns effective item count and monthly amount
 * based on current POS assignments so subscriptions don't show active when no machines are assigned. */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const { data: subs, error: subsError } = await supabaseAdmin
      .from('subscriptions')
      .select(`
        *,
        subscription_plans (id, name, monthly_rental_per_machine, billing_cycle_day)
      `)
      .order('next_billing_date', { ascending: true })
    if (subsError) {
      console.error('[Subscriptions GET]', subsError)
      return NextResponse.json({ error: subsError.message }, { status: 500 })
    }

    // Current POS assignments: machine_id -> assigned to which user_id (by role)
    const { data: posMachines } = await supabaseAdmin
      .from('pos_machines')
      .select('machine_id, retailer_id, distributor_id, master_distributor_id')
    const assignedMachineIdsByUser = new Map<string, Set<string>>()
    for (const m of posMachines || []) {
      const mid = m.machine_id
      if (!mid) continue
      if (m.retailer_id) {
        const key = `retailer:${m.retailer_id}`
        if (!assignedMachineIdsByUser.has(key)) assignedMachineIdsByUser.set(key, new Set())
        assignedMachineIdsByUser.get(key)!.add(mid)
      }
      if (m.distributor_id) {
        const key = `distributor:${m.distributor_id}`
        if (!assignedMachineIdsByUser.has(key)) assignedMachineIdsByUser.set(key, new Set())
        assignedMachineIdsByUser.get(key)!.add(mid)
      }
      if (m.master_distributor_id) {
        const key = `master_distributor:${m.master_distributor_id}`
        if (!assignedMachineIdsByUser.has(key)) assignedMachineIdsByUser.set(key, new Set())
        assignedMachineIdsByUser.get(key)!.add(mid)
      }
    }

    const subscriptionIds = (subs || []).map((s: any) => s.id)
    let itemsBySub = new Map<string, any[]>()
    if (subscriptionIds.length > 0) {
      const { data: allItems } = await supabaseAdmin
        .from('subscription_items')
        .select('subscription_id, reference_id, retailer_rate, distributor_rate, md_rate, gst_percent')
        .in('subscription_id', subscriptionIds)
        .eq('is_active', true)
      for (const it of allItems || []) {
        if (!itemsBySub.has(it.subscription_id)) itemsBySub.set(it.subscription_id, [])
        itemsBySub.get(it.subscription_id)!.push(it)
      }
    }

    const subsWithEffective = (subs || []).map((sub: any) => {
      const key = `${sub.user_role}:${sub.user_id}`
      const assignedIds = assignedMachineIdsByUser.get(key) || new Set()
      const items = itemsBySub.get(sub.id) || []
      const effectiveItems = items.filter((it: any) => assignedIds.has(it.reference_id))
      let effectiveMonthly = 0
      for (const it of effectiveItems) {
        const rate =
          sub.user_role === 'retailer'
            ? Number(it.retailer_rate) || 0
            : sub.user_role === 'distributor'
              ? Number(it.distributor_rate) || 0
              : Number(it.md_rate) || 0
        effectiveMonthly += rate + (rate * (Number(it.gst_percent) || 18)) / 100
      }
      return {
        ...sub,
        pos_machine_count: effectiveItems.length,
        monthly_amount: Math.round(effectiveMonthly * 100) / 100,
      }
    })

    return NextResponse.json({ subscriptions: subsWithEffective })
  } catch (e: any) {
    console.error('[Subscriptions GET]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
