import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { ensurePOSMachineProduct } from '@/lib/subscription/ensure-pos-machine-product'

export const dynamic = 'force-dynamic'

/**
 * POST /api/distributor/subscriptions/create-for-retailer
 *
 * Distributor creates (or updates) a subscription for a retailer under their network.
 * Body: { retailer_id, rate_per_unit, gst_percent?, billing_day? }
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'distributor' || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const { retailer_id, rate_per_unit, gst_percent = 18, billing_day = 1 } = body

    if (!retailer_id || rate_per_unit == null) {
      return NextResponse.json({ error: 'retailer_id and rate_per_unit are required' }, { status: 400 })
    }
    const bDay = Math.max(1, Math.min(28, parseInt(String(billing_day)) || 1))

    const { data: retailer, error: retErr } = await supabaseAdmin
      .from('retailers')
      .select('partner_id, name, distributor_id')
      .eq('partner_id', retailer_id)
      .single()

    if (retErr || !retailer || retailer.distributor_id !== user.partner_id) {
      return NextResponse.json({ error: 'Retailer not found or not under your network' }, { status: 403 })
    }

    const user_id = retailer_id
    const user_role = 'retailer'

    const posProduct = await ensurePOSMachineProduct(supabaseAdmin)
    if (!posProduct) {
      return NextResponse.json({ error: 'POS Machine product not found. Contact admin.' }, { status: 400 })
    }

    const productId = posProduct.id
    const effectiveGst = parseFloat(String(gst_percent)) || Number(posProduct.default_gst_percent) || 18
    const userRate = parseFloat(String(rate_per_unit)) || 0

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
          assigned_by_role: 'distributor',
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'product_id,user_id' }
      )

    const { data: machines } = await supabaseAdmin
      .from('pos_machines')
      .select('id, machine_id, retailer_id, distributor_id, master_distributor_id')
      .eq('retailer_id', user_id)

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
          retailer_rate: userRate,
          gst_percent: effectiveGst,
          updated_at: new Date().toISOString(),
        })
        .in('id', existingIds)
    }

    // Insert items for newly assigned machines
    const itemRows: any[] = []
    for (const m of machineList) {
      if (existingRefs.has(m.machine_id)) continue
      const retailerRate = userRate
      const distributorRate = rateMap.get(m.distributor_id || '') || 0
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
      const rateForUser = Number(it.retailer_rate) || 0
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
      activity_type: 'subscription_create_for_retailer',
      activity_category: 'subscription',
      activity_description: `Distributor created/updated subscription for retailer ${retailer.name} (${retailer_id}): ${(allItems || []).length} machines, ₹${Math.round(total * 100) / 100}/mo, billing day ${bDay}`,
      reference_id: sub.id,
      reference_table: 'subscriptions',
      status: 'success',
      metadata: { retailer_id, machines_total: machineList.length, monthly_amount: Math.round(total * 100) / 100, billing_day: bDay },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      subscription_id: sub.id,
      machines_total: machineList.length,
      new_items: itemRows.length,
      monthly_amount: Math.round(total * 100) / 100,
    })
  } catch (e: any) {
    console.error('[Distributor Create Subscription for Retailer]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
