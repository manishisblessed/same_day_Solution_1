import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { ensurePOSMachineProduct } from '@/lib/subscription/ensure-pos-machine-product'

export const dynamic = 'force-dynamic'

/**
 * POST - Full sync: creates subscriptions + subscription_items for ALL hierarchy
 * levels (master_distributor, distributor, retailer) from POS machine assignments.
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Ensure POS Machine product exists (auto-create if missing)
    const posProduct = await ensurePOSMachineProduct(supabaseAdmin)
    if (!posProduct) {
      return NextResponse.json({ error: 'POS Machine product not found. Add it in Products first.' }, { status: 400 })
    }
    const productId = posProduct.id
    const gstPct = Number(posProduct.default_gst_percent) || 18

    // Load ALL POS machines
    const { data: posMachines } = await supabaseAdmin
      .from('pos_machines')
      .select('id, machine_id, retailer_id, distributor_id, master_distributor_id')

    // Pre-load all product rates
    const rateMap = new Map<string, number>()
    if (productId) {
      const { data: rates } = await supabaseAdmin
        .from('subscription_product_rates')
        .select('user_id, rate_per_unit')
        .eq('product_id', productId)
        .eq('is_active', true)
      for (const r of rates || []) {
        rateMap.set(r.user_id, Number(r.rate_per_unit) || 0)
      }
    }

    // Group machines by each hierarchy level
    type MachineRow = { id: string; machine_id: string; retailer_id: string | null; distributor_id: string | null; master_distributor_id: string | null }
    const mdMachines = new Map<string, MachineRow[]>()
    const distMachines = new Map<string, MachineRow[]>()
    const retailerMachines = new Map<string, MachineRow[]>()

    for (const m of (posMachines || []) as MachineRow[]) {
      if (m.master_distributor_id) {
        if (!mdMachines.has(m.master_distributor_id)) mdMachines.set(m.master_distributor_id, [])
        mdMachines.get(m.master_distributor_id)!.push(m)
      }
      if (m.distributor_id) {
        if (!distMachines.has(m.distributor_id)) distMachines.set(m.distributor_id, [])
        distMachines.get(m.distributor_id)!.push(m)
      }
      if (m.retailer_id) {
        if (!retailerMachines.has(m.retailer_id)) retailerMachines.set(m.retailer_id, [])
        retailerMachines.get(m.retailer_id)!.push(m)
      }
    }

    let newSubs = 0
    let updatedSubs = 0
    let newItems = 0

    const roleLevels: { map: Map<string, MachineRow[]>; role: string; rateField: 'md_rate' | 'distributor_rate' | 'retailer_rate' }[] = [
      { map: mdMachines, role: 'master_distributor', rateField: 'md_rate' },
      { map: distMachines, role: 'distributor', rateField: 'distributor_rate' },
      { map: retailerMachines, role: 'retailer', rateField: 'retailer_rate' },
    ]

    for (const level of roleLevels) {
      const entries = Array.from(level.map.entries())
      for (const [userId, machines] of entries) {
        if (!rateMap.has(userId)) continue

        // Ensure subscription exists
        let { data: sub } = await supabaseAdmin
          .from('subscriptions')
          .select('id, billing_day')
          .eq('user_id', userId)
          .eq('user_role', level.role)
          .maybeSingle()

        const billingDay = sub?.billing_day || 1
        const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const istYear = istNow.getFullYear()
        const istMonth = istNow.getMonth()
        const istDay = istNow.getDate()
        let nYear = istYear, nMonth = istMonth
        if (billingDay < istDay) {
          nMonth += 1
          if (nMonth > 11) { nMonth = 0; nYear += 1 }
        }
        const nextBillingStr = `${nYear}-${String(nMonth + 1).padStart(2, '0')}-${String(billingDay).padStart(2, '0')}`

        if (!sub) {
          const { data: newSub, error: insErr } = await supabaseAdmin
            .from('subscriptions')
            .insert({
              user_id: userId,
              user_role: level.role,
              billing_day: billingDay,
              pos_machine_count: 0,
              monthly_amount: 0,
              next_billing_date: nextBillingStr,
              auto_debit_enabled: true,
              status: 'active',
            })
            .select('id, billing_day')
            .single()
          if (insErr || !newSub) continue
          sub = newSub
          newSubs++
        } else {
          updatedSubs++
        }

        if (!productId) continue

        // Skip items that already exist
        const { data: existingItems } = await supabaseAdmin
          .from('subscription_items')
          .select('reference_id')
          .eq('subscription_id', sub.id)
          .eq('product_id', productId)
          .eq('is_active', true)

        const existingRefs = new Set((existingItems || []).map((i: any) => i.reference_id))

        const newItemRows: any[] = []
        for (const m of machines) {
          if (existingRefs.has(m.machine_id)) continue
          newItemRows.push({
            subscription_id: sub.id,
            product_id: productId,
            reference_id: m.machine_id,
            reference_type: 'pos_machine',
            retailer_rate: rateMap.get(m.retailer_id || '') || 0,
            distributor_rate: rateMap.get(m.distributor_id || '') || 0,
            md_rate: rateMap.get(m.master_distributor_id || '') || 0,
            gst_percent: gstPct,
            distributor_id: m.distributor_id || null,
            master_distributor_id: m.master_distributor_id || null,
            is_active: true,
          })
        }

        if (newItemRows.length > 0) {
          await supabaseAdmin.from('subscription_items').insert(newItemRows)
          newItems += newItemRows.length
        }

        // Recalc total for THIS user's rate level
        const { data: allItems } = await supabaseAdmin
          .from('subscription_items')
          .select('retailer_rate, distributor_rate, md_rate, gst_percent')
          .eq('subscription_id', sub.id)
          .eq('is_active', true)

        let total = 0
        for (const it of allItems || []) {
          let rateForUser = 0
          if (level.rateField === 'retailer_rate') rateForUser = Number(it.retailer_rate) || 0
          else if (level.rateField === 'distributor_rate') rateForUser = Number(it.distributor_rate) || 0
          else rateForUser = Number(it.md_rate) || 0
          total += rateForUser + rateForUser * (Number(it.gst_percent) || 18) / 100
        }
        await supabaseAdmin
          .from('subscriptions')
          .update({
            monthly_amount: Math.round(total * 100) / 100,
            pos_machine_count: (allItems || []).length,
            updated_at: new Date().toISOString(),
          })
          .eq('id', sub.id)
      }
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'admin_subscription_sync_from_pos',
      activity_category: 'subscription',
      activity_description: `Admin ran Sync from POS: ${newSubs} new subs, ${updatedSubs} updated, ${newItems} new items (MD/Dist/Retailer).`,
      status: 'success',
      metadata: { newSubscriptions: newSubs, updatedSubscriptions: updatedSubs, newItems },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: `Sync complete. ${newSubs} new subs, ${updatedSubs} existing updated, ${newItems} new items created (across MD/Dist/Retailer levels).`,
      newSubscriptions: newSubs,
      updatedSubscriptions: updatedSubs,
      newItems,
    })
  } catch (e: any) {
    console.error('[Subscriptions Sync V3]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
