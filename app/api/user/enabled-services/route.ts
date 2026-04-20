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
 * Returns which services are enabled for the current user (retailer, distributor, master_distributor, partner).
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[enabled-services] Missing SUPABASE_URL or SERVICE_ROLE_KEY')
      return NextResponse.json({ error: 'Configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: 'no-store' }),
      },
    })

    // Accept partner_id & role as query params (passed from AuthContext).
    // This is necessary because admin and business users share the same
    // Supabase session on the same domain — the Bearer token may belong
    // to whichever user logged in last, which can differ from the
    // AuthContext-cached user that the sidebar is rendering for.
    const url = new URL(request.url)
    const qPartnerId = url.searchParams.get('partner_id')
    const qRole = url.searchParams.get('role')

    let lookupRole: string | null = null
    let lookupPartnerId: string | null = null

    if (qPartnerId && qRole && ['retailer', 'distributor', 'master_distributor', 'partner'].includes(qRole)) {
      lookupRole = qRole
      lookupPartnerId = qPartnerId
      console.log('[enabled-services] Using query params: role=', qRole, '| partner_id=', qPartnerId)
    } else {
      const { user, method } = await getCurrentUserWithFallback(request)
      console.log('[enabled-services] Auth:', method, '|', user?.email || 'none', '| role:', user?.role || 'none', '| partner_id:', user?.partner_id || 'none')

      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      if (!['retailer', 'distributor', 'master_distributor', 'partner'].includes(user.role)) {
        return NextResponse.json({
          services: Object.fromEntries(SERVICE_KEYS.map((k) => [k, false])),
          hasAnyEnabled: false,
        })
      }

      lookupRole = user.role
      lookupPartnerId = user.partner_id ?? null
    }

    // Determine table and ID column based on role
    // Partners table uses 'id' as primary key, others use 'partner_id'
    const tableName =
      lookupRole === 'retailer'
        ? 'retailers'
        : lookupRole === 'distributor'
          ? 'distributors'
          : lookupRole === 'partner'
            ? 'partners'
            : 'master_distributors'
    
    const idColumn = lookupRole === 'partner' ? 'id' : 'partner_id'

    const fields = SERVICE_KEYS.map((k) => `${k}_enabled`).join(', ')
    let row: any = null

    if (lookupPartnerId) {
      const byPartner = await supabase
        .from(tableName)
        .select(fields)
        .eq(idColumn, lookupPartnerId)
        .maybeSingle()
      if (byPartner.error) {
        console.error('[enabled-services] Query error:', byPartner.error.message, byPartner.error.code)
        // Try fetching ALL columns to diagnose column name mismatch
        const rawCheck = await supabase.from(tableName).select('*').eq(idColumn, lookupPartnerId).maybeSingle()
        if (rawCheck.data) {
          const rawKeys = Object.keys(rawCheck.data).filter(k => k.includes('enabled'))
          console.log('[enabled-services] Available *enabled* columns:', rawKeys.join(', '))
        }
      } else {
        row = byPartner.data
      }
    }

    if (!row) {
      console.warn('[enabled-services] No row found in', tableName, '| partner_id:', lookupPartnerId)
      return NextResponse.json(
        { services: Object.fromEntries(SERVICE_KEYS.map((k) => [k, false])), hasAnyEnabled: false },
        { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
      )
    }

    // Log raw DB values for debugging
    const rawVals: Record<string, any> = {}
    for (const key of SERVICE_KEYS) {
      rawVals[`${key}_enabled`] = (row as any)[`${key}_enabled`]
    }
    console.log('[enabled-services] RAW DB row for', lookupPartnerId, ':', JSON.stringify(rawVals))

    const services: Record<string, boolean> = {}
    let hasAnyEnabled = false
    for (const key of SERVICE_KEYS) {
      const val = (row as any)[`${key}_enabled`]
      services[key] = !!val
      if (val) hasAnyEnabled = true
    }

    console.log('[enabled-services]', lookupPartnerId, '→ hasAny:', hasAnyEnabled)
    return NextResponse.json(
      { services, hasAnyEnabled },
      { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' } }
    )
  } catch (err: any) {
    console.error('[enabled-services] Uncaught error:', err?.message || err)
    return NextResponse.json(
      { services: {}, hasAnyEnabled: false },
      { status: 200, headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
    )
  }
}
