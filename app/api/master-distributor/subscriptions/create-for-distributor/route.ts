import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { ensurePOSMachineProduct } from '@/lib/subscription/ensure-pos-machine-product'

export const dynamic = 'force-dynamic'

/**
 * POST /api/master-distributor/subscriptions/create-for-distributor
 *
 * Master Distributor creates (or updates) a subscription for a distributor under their network.
 * Body: { distributor_id, rate_per_unit, gst_percent?, billing_day? }
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'master_distributor' || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const { distributor_id, rate_per_unit, gst_percent = 18, billing_day = 1 } = body

    if (!distributor_id || rate_per_unit == null) {
      return NextResponse.json({ error: 'distributor_id and rate_per_unit are required' }, { status: 400 })
    }
    const bDay = Math.max(1, Math.min(28, parseInt(String(billing_day)) || 1))

    // Ensure distributor is under this MD
    const { data: dist, error: distErr } = await supabaseAdmin
      .from('distributors')
      .select('partner_id, name, master_distributor_id')
      .eq('partner_id', distributor_id)
      .single()

    if (distErr || !dist || dist.master_distributor_id !== user.partner_id) {
      return NextResponse.json({ error: 'Distributor not found or not under your network' }, { status: 403 })
    }

    const user_id = distributor_id
    const user_role = 'distributor'

    // Ensure POS Machine product exists (auto-create if missing)
    const posProduct = await ensurePOSMachineProduct(supabaseAdmin)
    if (!posProduct) {
      return NextResponse.json({ error: 'POS Machine product not found. Contact admin.' }, { status: 400 })
    }

    const productId = posProduct.id
    const effectiveGst = parseFloat(String(gst_percent)) || Number(posProduct.default_gst_percent) || 18
    const userRate = parseFloat(String(rate_per_unit)) || 0

    // Upsert product rate (assigned by MD)
    await supabaseAdmin
      .from('subscription_product_rates')
      .upsert(
        {
          product_id: productId,
          user_id,
          user_role,
          rate_per_unit: userRate,
          gst_percent: effectiveGst,
          assigned_by: user.partner_id,
          assigned_by_role: 'master_distributor',
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'product_id,user_id' }
      )

    // POS machines for this distributor
    const { data: machines } = await supabaseAdmin
      .from('pos_machines')
      .select('id, machine_id, retailer_id, distributor_id, master_distributor_id')
      .eq('distributor_id', user_id)

    const machineList = machines || []

    // Calculate next billing date in IST
    const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const istYear = istNow.getFullYear()
    const istMonth = istNow.getMonth()
    const istDay = istNow.getDate()
    let nextYear = istYear, nextMonth = istMonth
    if (bDay < istDay) {
      nextMonth += 1
      if (nextMonth > 11) { nextMonth = 0; nextYear += 1 }
    }
    const nextBillingStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(bDay).padStart(2, '0')}`

    let { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('id')
      .eq('user_id', user_id)
      .eq('user_role', user_role)
      .maybeSingle()

    if (!sub) {
      const { data: newSub, error: insErr } = await supabaseAdmin
        .from('subscriptions')
        .insert({
          user_id,
          user_role,
          billing_day: bDay,
          pos_machine_count: 0,
          monthly_amount: 0,
          next_billing_date: nextBillingStr,
          auto_debit_enabled: true,
          status: 'active',
        })
        .select('id')
        .single()
      if (insErr || !newSub) {
        return NextResponse.json({ error: insErr?.message || 'Failed to create subscription' }, { status: 500 })
      }
      sub = newSub
    } else {
      await supabaseAdmin
        .from('subscriptions')
        .update({ billing_day: bDay, next_billing_date: nextBillingStr, updated_at: new Date().toISOString() })
        .eq('id', sub.id)
    }

    const rateMap = new Map<string, number>()
    const { data: allRates } = await supabaseAdmin
      .from('subscription_product_rates')
      .select('user_id, rate_per_unit')
      .eq('product_id', productId)
      .eq('is_active', true)
    for (const r of allRates || []) {
      rateMap.set(r.user_id, Number(r.rate_per_unit) || 0)
    }

    // Update existing items' rates and add new items for new machines
    const { data: existingItems } = await supabaseAdmin
      .from('subscription_items')
      .select('id, reference_id')
      .eq('subscription_id', sub.id)
      .eq('product_id', productId)
      .eq('is_active', true)

    const existingRefs = new Map((existingItems || []).map((i: any) => [i.reference_id, i.id]))

    // Update rates on all existing items
    if (existingRefs.size > 0) {
      const existingIds = Array.from(existingRefs.values())
      await supabaseAdmin
        .from('subscription_items')
        .update({
          distributor_rate: userRate,
          gst_percent: effectiveGst,
          updated_at: new Date().toISOString(),
        })
        .in('id', existingIds)
    }

    // Insert items for newly assigned machines
    const itemRows: any[] = []
    for (const m of machineList) {
      if (existingRefs.has(m.machine_id)) continue
      const retailerRate = rateMap.get(m.retailer_id || '') || 0
      const distributorRate = userRate
      const mdRate = rateMap.get(m.master_distributor_id || '') || 0
      itemRows.push({
        subscription_id: sub.id,
        product_id: productId,
        reference_id: m.machine_id,
        reference_type: 'pos_machine',
        retailer_rate: retailerRate,
        distributor_rate: distributorRate,
        md_rate: mdRate,
        gst_percent: effectiveGst,
        distributor_id: m.distributor_id || null,
        master_distributor_id: m.master_distributor_id || null,
        is_active: true,
      })
    }

    if (itemRows.length > 0) {
      await supabaseAdmin.from('subscription_items').insert(itemRows)
    }

    // Recalculate monthly total
    const { data: allItems } = await supabaseAdmin
      .from('subscription_items')
      .select('retailer_rate, distributor_rate, md_rate, gst_percent')
      .eq('subscription_id', sub.id)
      .eq('is_active', true)

    let total = 0
    for (const it of allItems || []) {
      const rateForUser = Number(it.distributor_rate) || 0
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

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'subscription_create_for_distributor',
      activity_category: 'subscription',
      activity_description: `Master Distributor created/updated subscription for distributor ${dist.name} (${distributor_id}): ${(allItems || []).length} machines, ₹${Math.round(total * 100) / 100}/mo, billing day ${bDay}`,
      reference_id: sub.id,
      reference_table: 'subscriptions',
      status: 'success',
      metadata: { distributor_id, machines_total: machineList.length, monthly_amount: Math.round(total * 100) / 100, billing_day: bDay },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      subscription_id: sub.id,
      machines_total: machineList.length,
      new_items: itemRows.length,
      monthly_amount: Math.round(total * 100) / 100,
    })
  } catch (e: any) {
    console.error('[MD Create Subscription for Distributor]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
