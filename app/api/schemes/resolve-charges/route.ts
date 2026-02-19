/**
 * API: /api/schemes/resolve-charges
 * GET - Resolve applicable charges for the current user based on their mapped scheme
 *
 * Query params:
 *   service_type: 'payout' | 'bbps' | 'mdr'
 *   amount: number (required for payout/bbps)
 *   transfer_mode: 'IMPS' | 'NEFT' (required for payout)
 *   category: string (optional, for bbps)
 *   mode: 'CARD' | 'UPI' (required for mdr)
 *   card_type: 'CREDIT' | 'DEBIT' | 'PREPAID' (optional for mdr)
 *   brand_type: string (optional for mdr)
 *   settlement_type: 'T+1' | 'T+0' (optional for mdr)
 *   user_id: string (fallback auth via query param)
 * 
 * SELF-CONTAINED: This route creates its own Supabase client inline.
 * It does NOT depend on server-admin.ts or auth-server-request.ts.
 * This eliminates any potential module-level import failures.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ============================================================================
// STARTUP DIAGNOSTIC — logs once on first request so PM2 logs show env status
// ============================================================================
let _startupLogged = false
function logStartupDiagnostic() {
  if (_startupLogged) return
  _startupLogged = true
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  console.log(`[resolve-charges] ===== STARTUP DIAGNOSTIC =====`)
  console.log(`[resolve-charges] NEXT_PUBLIC_SUPABASE_URL: ${url ? 'SET (' + url.substring(0, 30) + '...)' : '** MISSING **'}`)
  console.log(`[resolve-charges] SUPABASE_SERVICE_ROLE_KEY: ${serviceKey ? 'SET (' + serviceKey.substring(0, 10) + '...)' : '** MISSING **'}`)
  console.log(`[resolve-charges] NEXT_PUBLIC_SUPABASE_ANON_KEY: ${anonKey ? 'SET (' + anonKey.substring(0, 10) + '...)' : '** MISSING **'}`)
  console.log(`[resolve-charges] Node env: ${process.env.NODE_ENV}`)
  console.log(`[resolve-charges] ==============================`)
}

// ============================================================================
// SUPABASE CLIENT — created inline, no external dependencies
// ============================================================================
let _cachedClient: SupabaseClient | null = null
let _cachedMode: 'admin' | 'anon' | null = null

function getSupabaseClient(): { client: SupabaseClient; mode: 'admin' | 'anon' } {
  if (_cachedClient && _cachedMode) {
    return { client: _cachedClient, mode: _cachedMode }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing')
  }

  // Prefer service role key
  if (serviceKey && serviceKey.length > 20) {
    _cachedClient = createClient(url, serviceKey, { auth: { persistSession: false } })
    _cachedMode = 'admin'
    console.log('[resolve-charges] Client mode: ADMIN (service_role key)')
    return { client: _cachedClient, mode: 'admin' }
  }

  // Fallback to anon key — RPC functions are SECURITY DEFINER so this works
  if (anonKey && anonKey.length > 20) {
    _cachedClient = createClient(url, anonKey, { auth: { persistSession: false } })
    _cachedMode = 'anon'
    console.log('[resolve-charges] Client mode: ANON (fallback, service_role key missing)')
    return { client: _cachedClient, mode: 'anon' }
  }

  throw new Error('No Supabase keys available (both SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing)')
}

// ============================================================================
// TYPES
// ============================================================================

interface ResolvedSchemeInfo {
  scheme_id: string
  scheme_name: string
  scheme_type: string
  resolved_via: string
}

// ============================================================================
// DIRECT TABLE QUERY FALLBACKS (requires admin/service_role client)
// ============================================================================

async function resolveSchemeDirectQuery(
  client: SupabaseClient,
  userId: string,
  userRole: string,
  serviceType: string,
  distributorId: string | null,
  mdId: string | null
): Promise<ResolvedSchemeInfo | null> {
  const now = new Date().toISOString()

  const findMapping = async (entityId: string, entityRole: string, resolvedVia: string): Promise<ResolvedSchemeInfo | null> => {
    try {
      const { data, error } = await client
        .from('scheme_mappings')
        .select(`
          scheme_id,
          service_type,
          effective_from,
          effective_to,
          scheme:schemes!inner (
            id, name, scheme_type, status, effective_from, effective_to
          )
        `)
        .eq('entity_id', entityId)
        .eq('entity_role', entityRole)
        .eq('status', 'active')
        .lte('effective_from', now)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) {
        console.error(`[resolve-charges] findMapping error for ${entityId}/${entityRole}:`, error.message)
        return null
      }
      if (!data || data.length === 0) return null

      for (const mapping of data as any[]) {
        const scheme = mapping.scheme as any
        if (!scheme || scheme.status !== 'active') continue
        if (mapping.effective_to && new Date(mapping.effective_to) <= new Date()) continue
        if (new Date(scheme.effective_from) > new Date()) continue
        if (scheme.effective_to && new Date(scheme.effective_to) <= new Date()) continue
        const svcType = mapping.service_type
        if (svcType && svcType !== 'all' && svcType !== serviceType) continue

        return {
          scheme_id: scheme.id,
          scheme_name: scheme.name,
          scheme_type: scheme.scheme_type,
          resolved_via: resolvedVia,
        }
      }
      return null
    } catch (err: any) {
      console.error(`[resolve-charges] findMapping exception for ${entityId}/${entityRole}:`, err.message)
      return null
    }
  }

  const retailerMatch = await findMapping(userId, userRole, 'retailer_mapping')
  if (retailerMatch) return retailerMatch

  if (distributorId) {
    const distMatch = await findMapping(distributorId, 'distributor', 'distributor_mapping')
    if (distMatch) return distMatch
  }

  if (mdId) {
    const mdMatch = await findMapping(mdId, 'master_distributor', 'md_mapping')
    if (mdMatch) return mdMatch
  }

  try {
    const { data: globalSchemes, error: globalError } = await client
      .from('schemes')
      .select('id, name, scheme_type, status, service_scope, effective_from, effective_to')
      .eq('scheme_type', 'global')
      .eq('status', 'active')
      .lte('effective_from', now)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(5)

    if (globalError) {
      console.error(`[resolve-charges] Global scheme query error:`, globalError.message)
      return null
    }

    if (globalSchemes) {
      for (const scheme of globalSchemes as any[]) {
        if (scheme.service_scope !== serviceType && scheme.service_scope !== 'all') continue
        if (scheme.effective_to && new Date(scheme.effective_to) <= new Date()) continue
        return {
          scheme_id: scheme.id,
          scheme_name: scheme.name,
          scheme_type: scheme.scheme_type,
          resolved_via: 'global',
        }
      }
    }
  } catch (err: any) {
    console.error(`[resolve-charges] Global scheme query exception:`, err.message)
  }

  return null
}

async function calculatePayoutChargeDirectQuery(
  client: SupabaseClient,
  schemeId: string,
  amount: number,
  transferMode: string
): Promise<{
  retailer_charge: number
  retailer_commission: number
  distributor_commission: number
  md_commission: number
  company_earning: number
} | null> {
  try {
    const { data: slabs, error } = await client
      .from('scheme_payout_charges')
      .select('*')
      .eq('scheme_id', schemeId)
      .eq('status', 'active')
      .lte('min_amount', amount)
      .gte('max_amount', amount)
      .order('min_amount', { ascending: false })

    if (error) {
      console.error(`[resolve-charges] Payout direct query error:`, error.message)
      return null
    }
    if (!slabs || slabs.length === 0) return null

    const matchingSlab = slabs.find((s: any) => 
      s.transfer_mode.toUpperCase() === transferMode.toUpperCase()
    )

    if (!matchingSlab) return null

    const calc = (value: number, type: string) => {
      if (type === 'percentage') return Math.round(amount * value / 100 * 100) / 100
      return value
    }

    return {
      retailer_charge: calc(parseFloat(matchingSlab.retailer_charge) || 0, matchingSlab.retailer_charge_type),
      retailer_commission: calc(parseFloat(matchingSlab.retailer_commission) || 0, matchingSlab.retailer_commission_type),
      distributor_commission: calc(parseFloat(matchingSlab.distributor_commission) || 0, matchingSlab.distributor_commission_type),
      md_commission: calc(parseFloat(matchingSlab.md_commission) || 0, matchingSlab.md_commission_type),
      company_earning: calc(parseFloat(matchingSlab.company_charge) || 0, matchingSlab.company_charge_type),
    }
  } catch (err: any) {
    console.error(`[resolve-charges] Payout direct query exception:`, err.message)
    return null
  }
}

async function calculateBBPSChargeDirectQuery(
  client: SupabaseClient,
  schemeId: string,
  amount: number,
  category: string | null
): Promise<{
  retailer_charge: number
  retailer_commission: number
  distributor_commission: number
  md_commission: number
  company_earning: number
} | null> {
  try {
    const { data: slabs, error } = await client
      .from('scheme_bbps_commissions')
      .select('*')
      .eq('scheme_id', schemeId)
      .eq('status', 'active')
      .lte('min_amount', amount)
      .gte('max_amount', amount)
      .order('min_amount', { ascending: false })

    if (error) {
      console.error(`[resolve-charges] BBPS direct query error:`, error.message)
      return null
    }
    if (!slabs || slabs.length === 0) return null

    let bestSlab: any = null

    for (const slab of slabs) {
      const slabCategory = slab.category
      const isWildcard = !slabCategory || slabCategory === '' || 
        slabCategory.toLowerCase() === 'all' || 
        slabCategory.toLowerCase() === 'all categories'
      const isExactMatch = slabCategory && category && slabCategory === category

      if (isExactMatch) { bestSlab = slab; break }
      if (isWildcard && !bestSlab) bestSlab = slab
      if (!category && !bestSlab) bestSlab = slab
    }

    if (!bestSlab) return null

    const calc = (value: number, type: string) => {
      if (type === 'percentage') return Math.round(amount * value / 100 * 100) / 100
      return value
    }

    return {
      retailer_charge: calc(parseFloat(bestSlab.retailer_charge) || 0, bestSlab.retailer_charge_type),
      retailer_commission: calc(parseFloat(bestSlab.retailer_commission) || 0, bestSlab.retailer_commission_type),
      distributor_commission: calc(parseFloat(bestSlab.distributor_commission) || 0, bestSlab.distributor_commission_type),
      md_commission: calc(parseFloat(bestSlab.md_commission) || 0, bestSlab.md_commission_type),
      company_earning: calc(parseFloat(bestSlab.company_charge) || 0, bestSlab.company_charge_type),
    }
  } catch (err: any) {
    console.error(`[resolve-charges] BBPS direct query exception:`, err.message)
    return null
  }
}

// ============================================================================
// MAIN API HANDLER
// ============================================================================

export async function GET(request: NextRequest) {
  // Log startup diagnostic on first request
  logStartupDiagnostic()

  const reqStart = Date.now()
  
  try {
    const { searchParams } = new URL(request.url)
    const serviceType = searchParams.get('service_type')
    const amount = parseFloat(searchParams.get('amount') || '0')
    const transferMode = searchParams.get('transfer_mode')
    const category = searchParams.get('category')
    const mode = searchParams.get('mode')
    const cardType = searchParams.get('card_type')
    const brandType = searchParams.get('brand_type')
    const settlementType = searchParams.get('settlement_type') || 'T+1'
    const userId = searchParams.get('user_id')

    console.log(`[resolve-charges] >> GET service=${serviceType} amount=${amount} mode=${transferMode} user=${userId}`)

    if (!serviceType) {
      return NextResponse.json({ error: 'service_type is required' }, { status: 400 })
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    }

    // Step 1: Get Supabase client
    let supabase: SupabaseClient
    let clientMode: 'admin' | 'anon'
    try {
      const result = getSupabaseClient()
      supabase = result.client
      clientMode = result.mode
    } catch (envErr: any) {
      console.error(`[resolve-charges] CRITICAL: No Supabase client:`, envErr.message)
      return NextResponse.json({ 
        error: 'Server configuration error', 
        detail: envErr.message,
        step: 'supabase_client_init'
      }, { status: 500 })
    }

    // Step 2: Get user info
    // For admin mode, look up retailer from DB for distributor chain
    // For anon mode, just trust user_id — RPC handles hierarchy internally
    let userRole = 'retailer'
    let distributorId: string | null = null
    let mdId: string | null = null

    if (clientMode === 'admin') {
      try {
        const { data: retailer, error: retErr } = await supabase
          .from('retailers')
          .select('partner_id, name, email, distributor_id, master_distributor_id')
          .eq('partner_id', userId)
          .maybeSingle()

        if (retErr) {
          console.warn(`[resolve-charges] Retailer lookup error:`, retErr.message)
        } else if (retailer) {
          distributorId = retailer.distributor_id || null
          mdId = retailer.master_distributor_id || null
          console.log(`[resolve-charges] Retailer found: dist=${distributorId}, md=${mdId}`)
        } else {
          // Check if user is a distributor
          const { data: dist } = await supabase
            .from('distributors')
            .select('partner_id, master_distributor_id')
            .eq('partner_id', userId)
            .maybeSingle()
          if (dist) {
            userRole = 'distributor'
            mdId = dist.master_distributor_id || null
          }
        }
      } catch (lookupErr: any) {
        console.warn(`[resolve-charges] User lookup error:`, lookupErr.message)
      }
    }
    // In anon mode, distributorId/mdId stay null — RPC function handles the hierarchy

    // ================================================================
    // SCHEME RESOLUTION: RPC first, then direct query fallback (admin only)
    // ================================================================
    console.log(`[resolve-charges] Resolving: user=${userId}, role=${userRole}, service=${serviceType}, dist=${distributorId}, md=${mdId}, client=${clientMode}`)
    
    let resolved: ResolvedSchemeInfo | null = null
    let resolutionMethod = 'none'

    // Try RPC first (works with both admin & anon because functions are SECURITY DEFINER)
    try {
      const { data: schemeResult, error: schemeError } = await supabase.rpc('resolve_scheme_for_user', {
        p_user_id: userId,
        p_user_role: userRole,
        p_service_type: serviceType,
        p_distributor_id: distributorId,
        p_md_id: mdId,
      })

      if (schemeError) {
        console.error(`[resolve-charges] RPC resolve_scheme_for_user error:`, schemeError.message, schemeError.code, schemeError.details, schemeError.hint)
      } else if (schemeResult && schemeResult.length > 0) {
        resolved = {
          scheme_id: schemeResult[0].scheme_id,
          scheme_name: schemeResult[0].scheme_name,
          scheme_type: schemeResult[0].scheme_type,
          resolved_via: schemeResult[0].resolved_via,
        }
        resolutionMethod = 'rpc'
        console.log(`[resolve-charges] RPC resolved: "${resolved.scheme_name}" (${resolved.scheme_id}) via ${resolved.resolved_via}`)
      } else {
        console.warn(`[resolve-charges] RPC returned empty result (no scheme found via RPC)`)
      }
    } catch (rpcErr: any) {
      console.error(`[resolve-charges] RPC exception:`, rpcErr.message)
    }

    // Fallback: Direct table queries (admin mode only)
    if (!resolved && clientMode === 'admin') {
      console.log(`[resolve-charges] Trying direct table query fallback...`)
      resolutionMethod = 'direct_query'
      resolved = await resolveSchemeDirectQuery(supabase, userId, userRole, serviceType, distributorId, mdId)
      
      if (resolved) {
        console.log(`[resolve-charges] Direct query resolved: "${resolved.scheme_name}" (${resolved.scheme_id}) via ${resolved.resolved_via}`)
      }
    }

    if (!resolved) {
      const elapsed = Date.now() - reqStart
      console.warn(`[resolve-charges] No scheme found for user=${userId}, service=${serviceType}, client=${clientMode} [${elapsed}ms]`)
      return NextResponse.json({
        resolved: false,
        scheme: null,
        charges: null,
        message: 'No scheme found for this user/service',
        debug: { user_id: userId, role: userRole, service: serviceType, distributor_id: distributorId, md_id: mdId, resolution_method: resolutionMethod, client_mode: clientMode },
      })
    }

    // ================================================================
    // CHARGE CALCULATION
    // ================================================================

    if (serviceType === 'payout') {
      if (!transferMode) {
        return NextResponse.json({ error: 'transfer_mode is required for payout' }, { status: 400 })
      }

      let charges: any = null
      
      // Try RPC charge calculation
      try {
        const { data: chargeResult, error: chargeError } = await supabase.rpc('calculate_payout_charge_from_scheme', {
          p_scheme_id: resolved.scheme_id,
          p_amount: amount,
          p_transfer_mode: transferMode,
        })

        if (chargeError) {
          console.error(`[resolve-charges] Payout charge RPC error:`, chargeError.message, chargeError.code, chargeError.hint)
        } else if (chargeResult && chargeResult.length > 0) {
          charges = {
            retailer_charge: parseFloat(chargeResult[0].retailer_charge) || 0,
            retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
            company_earning: parseFloat(chargeResult[0].company_earning) || 0,
          }
          console.log(`[resolve-charges] Payout charge via RPC: ₹${charges.retailer_charge}`)
        } else {
          console.warn(`[resolve-charges] Payout charge RPC returned empty`)
        }
      } catch (err: any) {
        console.error(`[resolve-charges] Payout charge RPC exception:`, err.message)
      }

      // Fallback: Direct query (admin only)
      if ((!charges || charges.retailer_charge === 0) && clientMode === 'admin') {
        console.log(`[resolve-charges] Payout charge: trying direct query fallback...`)
        const directCharges = await calculatePayoutChargeDirectQuery(supabase, resolved.scheme_id, amount, transferMode)
        if (directCharges && directCharges.retailer_charge > 0) {
          charges = directCharges
          console.log(`[resolve-charges] Payout charge via direct query: ₹${charges.retailer_charge}`)
        }
      }

      // Fetch ALL payout slabs (admin only — for client display)
      let allSlabs: any[] = []
      if (clientMode === 'admin') {
        try {
          const { data: slabData } = await supabase
            .from('scheme_payout_charges')
            .select('transfer_mode, min_amount, max_amount, retailer_charge, retailer_charge_type')
            .eq('scheme_id', resolved.scheme_id)
            .eq('status', 'active')
            .order('transfer_mode')
            .order('min_amount')
          allSlabs = slabData || []
        } catch (slabErr: any) {
          console.error(`[resolve-charges] Slab fetch error:`, slabErr.message)
        }
      }

      const elapsed = Date.now() - reqStart
      console.log(`[resolve-charges] << Payout response: scheme="${resolved.scheme_name}", charge=₹${charges?.retailer_charge ?? 'null'} [${elapsed}ms]`)

      return NextResponse.json({
        resolved: true,
        scheme: {
          id: resolved.scheme_id,
          name: resolved.scheme_name,
          type: resolved.scheme_type,
          resolved_via: resolved.resolved_via,
        },
        charges: charges,
        slabs: allSlabs,
        _debug: { resolution_method: resolutionMethod, client_mode: clientMode },
      })
    }

    if (serviceType === 'bbps') {
      let charges: any = null
      
      // Try RPC
      try {
        const { data: chargeResult, error: chargeError } = await supabase.rpc('calculate_bbps_charge_from_scheme', {
          p_scheme_id: resolved.scheme_id,
          p_amount: amount,
          p_category: category || null,
        })

        if (chargeError) {
          console.error(`[resolve-charges] BBPS charge RPC error:`, chargeError.message, chargeError.code, chargeError.hint)
        } else if (chargeResult && chargeResult.length > 0) {
          charges = {
            retailer_charge: parseFloat(chargeResult[0].retailer_charge) || 0,
            retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
            company_earning: parseFloat(chargeResult[0].company_earning) || 0,
          }
          console.log(`[resolve-charges] BBPS charge via RPC: ₹${charges.retailer_charge}`)
        }
      } catch (err: any) {
        console.error(`[resolve-charges] BBPS charge RPC exception:`, err.message)
      }

      // Fallback: Direct query (admin only)
      if ((!charges || charges.retailer_charge === 0) && clientMode === 'admin') {
        const directCharges = await calculateBBPSChargeDirectQuery(supabase, resolved.scheme_id, amount, category || null)
        if (directCharges) {
          charges = directCharges
          console.log(`[resolve-charges] BBPS charge via direct query: ₹${charges.retailer_charge}`)
        }
      }

      const elapsed = Date.now() - reqStart
      console.log(`[resolve-charges] << BBPS response: scheme="${resolved.scheme_name}", charge=₹${charges?.retailer_charge ?? 'null'} [${elapsed}ms]`)

      return NextResponse.json({
        resolved: true,
        scheme: {
          id: resolved.scheme_id,
          name: resolved.scheme_name,
          type: resolved.scheme_type,
          resolved_via: resolved.resolved_via,
        },
        charges: charges,
        _debug: { resolution_method: resolutionMethod, client_mode: clientMode },
      })
    }

    if (serviceType === 'mdr') {
      let mdrRates: any[] = []
      if (clientMode === 'admin') {
        try {
          const { data } = await supabase
            .from('scheme_mdr_rates')
            .select('*')
            .eq('scheme_id', resolved.scheme_id)
            .eq('status', 'active')
          mdrRates = data || []
        } catch (mdrErr: any) {
          console.error(`[resolve-charges] MDR rates fetch error:`, mdrErr.message)
        }
      }

      let filteredRates = mdrRates
      if (mode) filteredRates = filteredRates.filter((r: any) => r.mode === mode)
      if (cardType) filteredRates = filteredRates.filter((r: any) => r.card_type === cardType)
      if (brandType) filteredRates = filteredRates.filter((r: any) => r.brand_type === brandType)

      const rate = filteredRates.length > 0 ? filteredRates[0] : null

      return NextResponse.json({
        resolved: true,
        scheme: {
          id: resolved.scheme_id,
          name: resolved.scheme_name,
          type: resolved.scheme_type,
          resolved_via: resolved.resolved_via,
        },
        mdr_rate: rate ? {
          retailer_mdr: settlementType === 'T+0' ? parseFloat(rate.retailer_mdr_t0) : parseFloat(rate.retailer_mdr_t1),
          distributor_mdr: settlementType === 'T+0' ? parseFloat(rate.distributor_mdr_t0) : parseFloat(rate.distributor_mdr_t1),
          md_mdr: settlementType === 'T+0' ? parseFloat(rate.md_mdr_t0) : parseFloat(rate.md_mdr_t1),
          mode: rate.mode,
          card_type: rate.card_type,
          brand_type: rate.brand_type,
        } : null,
        all_rates: filteredRates,
        _debug: { resolution_method: resolutionMethod, client_mode: clientMode },
      })
    }

    return NextResponse.json({ error: 'Invalid service_type' }, { status: 400 })

  } catch (err: any) {
    const elapsed = Date.now() - reqStart
    console.error(`[resolve-charges] UNHANDLED ERROR [${elapsed}ms]:`, err?.message || err)
    console.error(`[resolve-charges] Stack:`, err?.stack)
    return NextResponse.json({ 
      error: err?.message || 'Internal server error', 
      step: 'unhandled',
    }, { status: 500 })
  }
}
