import { createClient, SupabaseClient } from '@supabase/supabase-js'

function getSupabaseAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * Check if the "API Payment" service (POS card sale via ECR) is enabled for a
 * retailer/partner. Sub-partners inherit their parent partner's flag.
 *
 * This is the SERVER-SIDE gate for /api/api-payment/*. The sidebar hides the tab
 * when disabled, but that is not a security boundary — every API-Payment route
 * must call this before triggering a terminal transaction.
 */
export async function isApiPaymentEnabled(
  user: { role: string; partner_id?: string | null },
  supabase?: SupabaseClient
): Promise<boolean> {
  if (!user.partner_id) return false

  const lookupRole = user.role === 'sub_partner' ? 'partner' : user.role
  if (!['retailer', 'partner'].includes(lookupRole)) return false

  const client = supabase || getSupabaseAdmin()
  const tableName = lookupRole === 'partner' ? 'partners' : 'retailers'
  const idColumn = lookupRole === 'partner' ? 'id' : 'partner_id'

  const { data, error } = await client
    .from(tableName)
    .select('api_payment_enabled')
    .eq(idColumn, user.partner_id)
    .maybeSingle()

  if (error) {
    console.warn('[API Payment] enabled check failed:', error.message)
    return false
  }

  return !!(data as any)?.api_payment_enabled
}
