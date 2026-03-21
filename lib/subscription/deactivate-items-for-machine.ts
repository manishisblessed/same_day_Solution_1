/**
 * When a POS machine is unassigned (returned to stock), deactivate any
 * subscription_items that reference this machine so subscriptions stay in sync
 * with actual POS assignments.
 */

/**
 * Deactivate all subscription_items where reference_id = machine_id (the POS machine_id string).
 * Recalculates monthly_amount and pos_machine_count for each affected subscription.
 */
export async function deactivateSubscriptionItemsForMachine(
  supabase: any,
  machineId: string
): Promise<{ deactivated: number; subscriptionsUpdated: string[] }> {
  if (!machineId) return { deactivated: 0, subscriptionsUpdated: [] }

  const { data: items } = await supabase
    .from('subscription_items')
    .select('id, subscription_id')
    .eq('reference_id', machineId)
    .eq('reference_type', 'pos_machine')
    .eq('is_active', true)

  if (!items || items.length === 0) {
    return { deactivated: 0, subscriptionsUpdated: [] }
  }

  const { error: updateErr } = await supabase
    .from('subscription_items')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('reference_id', machineId)
    .eq('reference_type', 'pos_machine')
    .eq('is_active', true)

  if (updateErr) {
    console.error('[Subscription] Deactivate items for machine failed:', updateErr)
    return { deactivated: 0, subscriptionsUpdated: [] }
  }

  const subIds: string[] = Array.from(
    new Set(items.map((i: { subscription_id: string }) => i.subscription_id))
  )
  for (const subId of subIds) {
    const { data: allItems } = await supabase
      .from('subscription_items')
      .select('retailer_rate, distributor_rate, md_rate, gst_percent')
      .eq('subscription_id', subId)
      .eq('is_active', true)

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('user_role')
      .eq('id', subId)
      .single()

    let total = 0
    for (const it of allItems || []) {
      const rateForUser =
        sub?.user_role === 'retailer'
          ? Number(it.retailer_rate) || 0
          : sub?.user_role === 'distributor'
            ? Number(it.distributor_rate) || 0
            : Number(it.md_rate) || 0
      total += rateForUser + (rateForUser * (Number(it.gst_percent) || 18)) / 100
    }

    await supabase
      .from('subscriptions')
      .update({
        monthly_amount: Math.round(total * 100) / 100,
        pos_machine_count: (allItems || []).length,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subId)
  }

  return { deactivated: items.length, subscriptionsUpdated: subIds }
}
