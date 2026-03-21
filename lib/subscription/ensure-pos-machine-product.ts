/**
 * Ensures the "POS Machine" subscription product exists and is active.
 * If missing, inserts it. If present but inactive, reactivates it.
 * Returns the product id and default_gst_percent, or null on failure.
 */
const POS_PRODUCT_NAME = 'POS Machine'
const DEFAULT_GST = 18

export async function ensurePOSMachineProduct(supabase: any): Promise<{ id: string; default_gst_percent: number } | null> {
  const { data: posProduct } = await supabase
    .from('subscription_products')
    .select('id, default_gst_percent')
    .eq('name', POS_PRODUCT_NAME)
    .eq('is_active', true)
    .maybeSingle()

  if (posProduct) return posProduct

  // Try to find inactive product and reactivate
  const { data: inactive } = await supabase
    .from('subscription_products')
    .select('id, default_gst_percent')
    .eq('name', POS_PRODUCT_NAME)
    .maybeSingle()

  if (inactive) {
    await supabase
      .from('subscription_products')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', inactive.id)
    return { id: inactive.id, default_gst_percent: Number(inactive.default_gst_percent) || DEFAULT_GST }
  }

  // Insert new product
  const { data: inserted, error } = await supabase
    .from('subscription_products')
    .insert({
      name: POS_PRODUCT_NAME,
      description: 'POS terminal rental',
      default_gst_percent: DEFAULT_GST,
      is_active: true,
    })
    .select('id, default_gst_percent')
    .single()

  if (error || !inserted) return null
  return { id: inserted.id, default_gst_percent: Number(inserted.default_gst_percent) || DEFAULT_GST }
}
