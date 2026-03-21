import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { ensurePOSMachineProduct } from '@/lib/subscription/ensure-pos-machine-product'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/subscriptions/create-for-user
 *
 * Creates (or updates) a subscription for a specific user at any hierarchy level.
 * Steps:
 *   1. Upsert the product rate for this user
 *   2. Create/update the subscription row with billing_day
 *   3. Create subscription_items for each POS machine
 *   4. Recalculate monthly_amount
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const { user_id, user_role, rate_per_unit, gst_percent = 18, billing_day = 1 } = body

    if (!user_id || !user_role || rate_per_unit == null) {
      return NextResponse.json({ error: 'user_id, user_role, and rate_per_unit are required' }, { status: 400 })
    }
    if (!['retailer', 'distributor', 'master_distributor', 'partner'].includes(user_role)) {
      return NextResponse.json({ error: 'Invalid user_role' }, { status: 400 })
    }
    const bDay = Math.max(1, Math.min(28, parseInt(billing_day) || 1))

    // Ensure POS Machine product exists (auto-create if missing)
    const posProduct = await ensurePOSMachineProduct(supabaseAdmin)
    if (!posProduct) {
      return NextResponse.json({ error: 'POS Machine product not found. Add it in Products first.' }, { status: 400 })
    }

    const productId = posProduct.id
    const effectiveGst = parseFloat(gst_percent) || Number(posProduct.default_gst_percent) || 18

    // 1. Upsert product rate
    await supabaseAdmin
      .from('subscription_product_rates')
      .upsert(
        {
          product_id: productId,
          user_id,
          user_role,
          rate_per_unit: parseFloat(rate_per_unit),
          gst_percent: effectiveGst,
          assigned_by: user.partner_id || user.id,
          assigned_by_role: 'admin',
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'product_id,user_id' }
      )

    // 2. Find POS machines for this user
    const roleColumnMap: Record<string, string> = {
      partner: 'partner_id',
      master_distributor: 'master_distributor_id',
      distributor: 'distributor_id',
      retailer: 'retailer_id',
    }
    const column = roleColumnMap[user_role]

    const { data: machines } = await supabaseAdmin
      .from('pos_machines')
      .select('id, machine_id, retailer_id, distributor_id, master_distributor_id')
      .eq(column, user_id)

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

    // 3. Create or update subscription
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
        .update({ billing_day: bDay, updated_at: new Date().toISOString() })
        .eq('id', sub.id)
    }

    // 4. Load rate chain (for rate baking into items)
    const rateMap = new Map<string, number>()
    const { data: allRates } = await supabaseAdmin
      .from('subscription_product_rates')
      .select('user_id, rate_per_unit')
      .eq('product_id', productId)
      .eq('is_active', true)
    for (const r of allRates || []) {
      rateMap.set(r.user_id, Number(r.rate_per_unit) || 0)
    }

    // 5. Update existing items' rates and create items for new machines
    const { data: existingItems } = await supabaseAdmin
      .from('subscription_items')
      .select('id, reference_id')
      .eq('subscription_id', sub.id)
      .eq('product_id', productId)
      .eq('is_active', true)

    const existingRefs = new Map((existingItems || []).map((i: any) => [i.reference_id, i.id]))
    const userRate = parseFloat(rate_per_unit) || 0

    // Build rate update for the user's role column
    const rateUpdate: Record<string, any> = { gst_percent: effectiveGst, updated_at: new Date().toISOString() }
    if (user_role === 'retailer') rateUpdate.retailer_rate = userRate
    else if (user_role === 'distributor') rateUpdate.distributor_rate = userRate
    else if (user_role === 'master_distributor' || user_role === 'partner') rateUpdate.md_rate = userRate

    if (existingRefs.size > 0) {
      const existingIds = Array.from(existingRefs.values())
      await supabaseAdmin
        .from('subscription_items')
        .update(rateUpdate)
        .in('id', existingIds)
    }

    let newItemCount = 0
    const itemRows: any[] = []
    for (const m of machineList) {
      if (existingRefs.has(m.machine_id)) continue

      const retailerRate = user_role === 'retailer' ? userRate : (rateMap.get(m.retailer_id || '') || 0)
      const distributorRate = user_role === 'distributor' ? userRate : (rateMap.get(m.distributor_id || '') || 0)
      const mdRate = user_role === 'master_distributor' ? userRate : user_role === 'partner' ? userRate : (rateMap.get(m.master_distributor_id || '') || 0)

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
      newItemCount = itemRows.length
    }

    // 6. Recalculate monthly_amount from all active items
    const { data: allItems } = await supabaseAdmin
      .from('subscription_items')
      .select('retailer_rate, distributor_rate, md_rate, gst_percent')
      .eq('subscription_id', sub.id)
      .eq('is_active', true)

    let total = 0
    for (const it of allItems || []) {
      let rateForUser = 0
      if (user_role === 'retailer') rateForUser = Number(it.retailer_rate) || 0
      else if (user_role === 'distributor') rateForUser = Number(it.distributor_rate) || 0
      else if (user_role === 'master_distributor' || user_role === 'partner') rateForUser = Number(it.md_rate) || 0
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
      activity_type: 'admin_subscription_create_for_user',
      activity_category: 'subscription',
      activity_description: `Admin created/updated subscription for ${user_role} ${user_id}: ${(allItems || []).length} items, ₹${Math.round(total * 100) / 100}/mo, billing day ${bDay}`,
      reference_id: sub.id,
      reference_table: 'subscriptions',
      status: 'success',
      metadata: { user_id, user_role, machines_total: machineList.length, monthly_amount: Math.round(total * 100) / 100, billing_day: bDay },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      subscription_id: sub.id,
      machines_total: machineList.length,
      new_items: newItemCount,
      monthly_amount: Math.round(total * 100) / 100,
    })
  } catch (e: any) {
    console.error('[Create Subscription]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
