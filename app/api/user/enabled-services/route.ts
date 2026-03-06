import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SERVICE_KEYS = [
  'banking_payments',
  'mini_atm_pos',
  'aeps',
  'aadhaar_pay',
  'dmt',
  'bbps',
  'recharge',
  'travel',
  'cash_management',
  'lic',
  'insurance',
] as const

/**
 * GET /api/user/enabled-services
 * Returns which services are enabled for the current user (retailer, distributor, master_distributor).
 * Partners do not have per-service toggles in the same table; returns empty so Services tab can be hidden or shown as empty.
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { user } = await getCurrentUserWithFallback(request)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only retailer, distributor, master_distributor have service toggles in admin
    if (!['retailer', 'distributor', 'master_distributor'].includes(user.role)) {
      return NextResponse.json({
        services: Object.fromEntries(SERVICE_KEYS.map((k) => [k, false])),
        hasAnyEnabled: false,
      })
    }

    const tableName =
      user.role === 'retailer'
        ? 'retailers'
        : user.role === 'distributor'
          ? 'distributors'
          : 'master_distributors'

    const fields = SERVICE_KEYS.map((k) => `${k}_enabled`).join(', ')
    const { data: row, error } = await supabase
      .from(tableName)
      .select(fields)
      .eq('partner_id', user.partner_id!)
      .maybeSingle()

    if (error || !row) {
      return NextResponse.json({
        services: Object.fromEntries(SERVICE_KEYS.map((k) => [k, false])),
        hasAnyEnabled: false,
      })
    }

    const services: Record<string, boolean> = {}
    let hasAnyEnabled = false
    for (const key of SERVICE_KEYS) {
      const val = (row as any)[`${key}_enabled`]
      services[key] = !!val
      if (val) hasAnyEnabled = true
    }

    return NextResponse.json({ services, hasAnyEnabled })
  } catch (err: any) {
    console.error('[enabled-services]', err)
    return NextResponse.json(
      { services: {}, hasAnyEnabled: false },
      { status: 200 }
    )
  }
}
