import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

const DEFAULT_LIMIT = 500_000
const SETTING_KEY = 'wallet_op_max_amount'

export async function getWalletOpMaxAmount(): Promise<number> {
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('portal_settings')
      .select('active_provider')
      .eq('service_key', SETTING_KEY)
      .single()

    if (data?.active_provider) {
      const val = parseInt(data.active_provider, 10)
      if (!isNaN(val) && val > 0) return val
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_LIMIT
}
