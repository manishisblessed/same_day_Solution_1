/**
 * Upsert subscription and one subscription_item when a POS machine is assigned.
 * Called from POST /api/pos-machines/assign for Admin→MD, MD→Dist, Dist→Retailer.
 * - Upserts subscription_product_rates for the assignee (rate = subscription_amount).
 * - Gets or creates subscription for assignee with billing_day.
 * - Adds one subscription_item for this machine with retailer_rate, distributor_rate, md_rate from chain.
 */

const POS_PRODUCT_NAME = 'POS Machine'
const DEFAULT_GST = 18

export interface UpsertSubscriptionOnAssignParams {
  supabase: any
  assignee_user_id: string
  assignee_user_role: 'master_distributor' | 'distributor' | 'retailer'
  machine: { machine_id: string; retailer_id?: string | null; distributor_id?: string | null; master_distributor_id?: string | null }
  rate_per_unit: number
  billing_day: number
  gst_percent?: number
  assigned_by: string
  assigned_by_role: 'admin' | 'master_distributor' | 'distributor'
}

export async function upsertSubscriptionOnAssign(params: UpsertSubscriptionOnAssignParams): Promise<{ success: boolean; error?: string }> {
  const {
    supabase,
    assignee_user_id,
    assignee_user_role,
    machine,
    rate_per_unit,
    billing_day,
    gst_percent = DEFAULT_GST,
    assigned_by,
    assigned_by_role,
  } = params

  const bDay = Math.max(1, Math.min(28, billing_day))
  const rate = Number(rate_per_unit) || 0

  const { data: posProduct } = await supabase
    .from('subscription_products')
    .select('id, default_gst_percent')
    .eq('name', POS_PRODUCT_NAME)
    .eq('is_active', true)
    .maybeSingle()

  if (!posProduct) {
    return { success: false, error: 'POS Machine product not found' }
  }

  const productId = posProduct.id
  const effectiveGst = Number(gst_percent) || Number(posProduct.default_gst_percent) || DEFAULT_GST

  // 1. Upsert product rate for assignee
  await supabase
    .from('subscription_product_rates')
    .upsert(
      {
        product_id: productId,
        user_id: assignee_user_id,
        user_role: assignee_user_role,
        rate_per_unit: rate,
        gst_percent: effectiveGst,
        assigned_by,
        assigned_by_role,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'product_id,user_id' }
    )

  // 2. Rate map for chain (assignee + upstream)
  const rateMap = new Map<string, number>()
  rateMap.set(assignee_user_id, rate)
  const { data: allRates } = await supabase
    .from('subscription_product_rates')
    .select('user_id, rate_per_unit')
    .eq('product_id', productId)
    .eq('is_active', true)
  for (const r of allRates || []) {
    rateMap.set(r.user_id, Number(r.rate_per_unit) || 0)
  }

  const retailerRate = assignee_user_role === 'retailer' ? rate : (rateMap.get(machine.retailer_id || '') ?? 0)
  const distributorRate = assignee_user_role === 'distributor' ? rate : (rateMap.get(machine.distributor_id || '') ?? 0)
  const mdRate = assignee_user_role === 'master_distributor' ? rate : (rateMap.get(machine.master_distributor_id || '') ?? 0)

  // 3. Next billing date (IST)
  const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const istYear = istNow.getFullYear()
  const istMonth = istNow.getMonth()
  const istDay = istNow.getDate()
  let nYear = istYear, nMonth = istMonth
  if (bDay < istDay) {
    nMonth += 1
    if (nMonth > 11) { nMonth = 0; nYear += 1 }
  }
  const nextBillingStr = `${nYear}-${String(nMonth + 1).padStart(2, '0')}-${String(bDay).padStart(2, '0')}`

  // 4. Get or create subscription
  let { data: sub } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', assignee_user_id)
    .eq('user_role', assignee_user_role)
    .maybeSingle()

  if (!sub) {
    const { data: newSub, error: insErr } = await supabase
      .from('subscriptions')
      .insert({
        user_id: assignee_user_id,
        user_role: assignee_user_role,
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
      return { success: false, error: insErr?.message || 'Failed to create subscription' }
    }
    sub = newSub
  } else {
    await supabase
      .from('subscriptions')
      .update({ billing_day: bDay, updated_at: new Date().toISOString() })
      .eq('id', sub.id)
  }

  // 5. Skip if this machine already has an active item
  const { data: existingItem } = await supabase
    .from('subscription_items')
    .select('id')
    .eq('subscription_id', sub.id)
    .eq('product_id', productId)
    .eq('reference_id', machine.machine_id)
    .eq('is_active', true)
    .maybeSingle()

  if (existingItem) {
    return { success: true }
  }

  // 6. Insert one subscription_item for this machine
  const { error: itemErr } = await supabase.from('subscription_items').insert({
    subscription_id: sub.id,
    product_id: productId,
    reference_id: machine.machine_id,
    reference_type: 'pos_machine',
    retailer_rate: retailerRate,
    distributor_rate: distributorRate,
    md_rate: mdRate,
    gst_percent: effectiveGst,
    distributor_id: machine.distributor_id || null,
    master_distributor_id: machine.master_distributor_id || null,
    is_active: true,
  })

  if (itemErr) {
    return { success: false, error: itemErr.message }
  }

  // 7. Recalculate monthly_amount for this subscription
  const { data: allItems } = await supabase
    .from('subscription_items')
    .select('retailer_rate, distributor_rate, md_rate, gst_percent')
    .eq('subscription_id', sub.id)
    .eq('is_active', true)

  let total = 0
  for (const it of allItems || []) {
    let rateForUser = 0
    if (assignee_user_role === 'retailer') rateForUser = Number(it.retailer_rate) || 0
    else if (assignee_user_role === 'distributor') rateForUser = Number(it.distributor_rate) || 0
    else if (assignee_user_role === 'master_distributor') rateForUser = Number(it.md_rate) || 0
    total += rateForUser + (rateForUser * (Number(it.gst_percent) || 18)) / 100
  }

  await supabase
    .from('subscriptions')
    .update({
      monthly_amount: Math.round(total * 100) / 100,
      pos_machine_count: (allItems || []).length,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sub.id)

  return { success: true }
}
