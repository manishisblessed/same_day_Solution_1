import { createClient, SupabaseClient } from '@supabase/supabase-js'

function getSupabaseAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * Check if Credit Card-2 (Rechargekit) is enabled for retailer/partner.
 */
export async function isCreditCard2Enabled(
  user: { role: string; partner_id?: string | null },
  supabase?: SupabaseClient
): Promise<boolean> {
  if (!user.partner_id || !['retailer', 'partner'].includes(user.role)) return false

  const client = supabase || getSupabaseAdmin()
  const tableName = user.role === 'partner' ? 'partners' : 'retailers'
  const idColumn = user.role === 'partner' ? 'id' : 'partner_id'

  const { data, error } = await client
    .from(tableName)
    .select('credit_card2_enabled')
    .eq(idColumn, user.partner_id)
    .maybeSingle()

  if (error) {
    console.warn('[Credit Card-2] enabled check failed:', error.message)
    return false
  }

  return !!(data as any)?.credit_card2_enabled
}
