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
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ============================================================================
// DIRECT TABLE QUERY FALLBACKS
// These bypass RPC functions entirely to avoid SECURITY INVOKER / RLS issues
// ============================================================================

interface ResolvedSchemeInfo {
  scheme_id: string
  scheme_name: string
  scheme_type: string
  resolved_via: string
}

/**
 * Resolve scheme for a user via direct table queries (no RPC)
 * Follows the same priority: retailer → distributor → MD → global
 */
async function resolveSchemeDirectQuery(
  userId: string,
  userRole: string,
  serviceType: string,
  distributorId: string | null,
  mdId: string | null
): Promise<ResolvedSchemeInfo | null> {
  const now = new Date().toISOString()

  // Helper to check scheme mapping + scheme validity
  const findMapping = async (entityId: string, entityRole: string, resolvedVia: string): Promise<ResolvedSchemeInfo | null> => {
    try {
      const { data, error } = await getSupabaseAdmin()
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

      // Filter in JS for conditions that are hard to express in PostgREST
      for (const mapping of data as any[]) {
        const scheme = mapping.scheme as any
        if (!scheme || scheme.status !== 'active') continue
        // Check mapping effective_to
        if (mapping.effective_to && new Date(mapping.effective_to) <= new Date()) continue
        // Check scheme dates
        if (new Date(scheme.effective_from) > new Date()) continue
        if (scheme.effective_to && new Date(scheme.effective_to) <= new Date()) continue
        // Check service_type match
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

  // 1. Direct retailer mapping
  const retailerMatch = await findMapping(userId, userRole, 'retailer_mapping')
  if (retailerMatch) return retailerMatch

  // 2. Distributor mapping
  if (distributorId) {
    const distMatch = await findMapping(distributorId, 'distributor', 'distributor_mapping')
    if (distMatch) return distMatch
  }

  // 3. Master distributor mapping
  if (mdId) {
    const mdMatch = await findMapping(mdId, 'master_distributor', 'md_mapping')
    if (mdMatch) return mdMatch
  }

  // 4. Global scheme fallback
  try {
    const { data: globalSchemes, error: globalError } = await getSupabaseAdmin()
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

/**
 * Calculate BBPS charge from scheme via direct table query (no RPC)
 */
async function calculateBBPSChargeDirectQuery(
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
    const { data: slabs, error } = await getSupabaseAdmin()
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

    // Find best matching slab (prefer exact category match over wildcard)
    let bestSlab: any = null

    for (const slab of slabs) {
      const slabCategory = slab.category
      // Category matching: NULL, empty, or 'all'/'All Categories' = applies to all
      const isWildcard = !slabCategory || slabCategory === '' || 
        slabCategory.toLowerCase() === 'all' || 
        slabCategory.toLowerCase() === 'all categories'
      const isExactMatch = slabCategory && category && slabCategory === category

      if (isExactMatch) {
        bestSlab = slab
        break // Exact match takes priority
      }
      if (isWildcard && !bestSlab) {
        bestSlab = slab
      }
      if (!category && !bestSlab) {
        bestSlab = slab // No category filter, use any matching slab
      }
    }

    if (!bestSlab) return null

    // Calculate amounts (flat or percentage)
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

/**
 * Calculate Payout charge from scheme via direct table query (no RPC)
 */
async function calculatePayoutChargeDirectQuery(
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
    const { data: slabs, error } = await getSupabaseAdmin()
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

    // Find matching slab by transfer mode (case-insensitive)
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

// ============================================================================
// MAIN API HANDLER
// ============================================================================

export async function GET(request: NextRequest) {
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

    // Get user from query param fallback
    const userId = searchParams.get('user_id')

    if (!serviceType) {
      return NextResponse.json({ error: 'service_type is required' }, { status: 400 })
    }

    // Step 1: Verify Supabase admin client can be created
    let adminClient
    try {
      adminClient = getSupabaseAdmin()
    } catch (envErr: any) {
      console.error(`[resolve-charges] CRITICAL: Cannot create Supabase admin client:`, envErr.message)
      return NextResponse.json({ 
        error: 'Server configuration error', 
        detail: envErr.message,
        step: 'supabase_admin_init'
      }, { status: 500 })
    }

    // Step 2: Get user (try cookie auth first, then user_id param)
    let user = null
    try {
      user = await getCurrentUserFromRequest(request)
    } catch (authErr: any) {
      console.warn(`[resolve-charges] getCurrentUserFromRequest threw:`, authErr.message)
      // Continue to fallback
    }

    // Fallback auth using user_id query param
    if ((!user || !user.partner_id) && userId) {
      try {
        const { data: retailer, error: retailerError } = await adminClient
          .from('retailers')
          .select('partner_id, name, email, distributor_id, master_distributor_id')
          .eq('partner_id', userId)
          .maybeSingle()

        if (retailerError) {
          console.error(`[resolve-charges] Retailer lookup error:`, retailerError.message)
        } else if (retailer) {
          user = {
            id: userId,
            email: retailer.email,
            role: 'retailer' as const,
            partner_id: retailer.partner_id,
            name: retailer.name,
          }
        }
      } catch (lookupErr: any) {
        console.error(`[resolve-charges] Retailer lookup exception:`, lookupErr.message)
      }
    }

    if (!user || !user.partner_id) {
      return NextResponse.json({ 
        error: 'Authentication required', 
        detail: 'Could not authenticate user via cookies or user_id param',
        user_id_provided: !!userId
      }, { status: 401 })
    }

    // Step 3: Get the retailer's distributor chain for proper scheme hierarchy resolution
    let distributorId: string | null = null
    let mdId: string | null = null

    try {
      if (user.role === 'retailer') {
        const { data: retailerData, error: retErr } = await adminClient
          .from('retailers')
          .select('distributor_id, master_distributor_id')
          .eq('partner_id', user.partner_id)
          .maybeSingle()

        if (retErr) {
          console.error(`[resolve-charges] Distributor chain lookup error:`, retErr.message)
        } else {
          distributorId = retailerData?.distributor_id || null
          mdId = retailerData?.master_distributor_id || null
        }
      } else if (user.role === 'distributor') {
        const { data: distData, error: distErr } = await adminClient
          .from('distributors')
          .select('master_distributor_id')
          .eq('partner_id', user.partner_id)
          .maybeSingle()

        if (distErr) {
          console.error(`[resolve-charges] MD lookup error:`, distErr.message)
        } else {
          mdId = distData?.master_distributor_id || null
        }
      }
    } catch (chainErr: any) {
      console.error(`[resolve-charges] Distributor chain exception:`, chainErr.message)
      // Continue without chain info - will still try global scheme
    }

    // ================================================================
    // SCHEME RESOLUTION: Try RPC first, fallback to direct queries
    // ================================================================
    console.log(`[resolve-charges] Resolving scheme: user=${user.partner_id}, role=${user.role}, service=${serviceType}, dist=${distributorId}, md=${mdId}`)
    
    let resolved: ResolvedSchemeInfo | null = null
    let resolutionMethod = 'rpc'

    // Try RPC first
    try {
      const { data: schemeResult, error: schemeError } = await adminClient.rpc('resolve_scheme_for_user', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_service_type: serviceType,
        p_distributor_id: distributorId,
        p_md_id: mdId,
      })

      if (schemeError) {
        console.error(`[resolve-charges] RPC error:`, schemeError.message, schemeError.code, schemeError.details)
      } else if (schemeResult && schemeResult.length > 0) {
        resolved = {
          scheme_id: schemeResult[0].scheme_id,
          scheme_name: schemeResult[0].scheme_name,
          scheme_type: schemeResult[0].scheme_type,
          resolved_via: schemeResult[0].resolved_via,
        }
      }
    } catch (rpcErr: any) {
      console.error(`[resolve-charges] RPC call failed:`, rpcErr.message)
    }

    // Fallback: Direct table queries if RPC failed
    if (!resolved) {
      console.warn(`[resolve-charges] RPC returned no results, trying direct table query fallback...`)
      resolutionMethod = 'direct_query'
      resolved = await resolveSchemeDirectQuery(user.partner_id, user.role, serviceType, distributorId, mdId)
      
      if (resolved) {
        console.log(`[resolve-charges] Direct query resolved: ${resolved.scheme_name} (${resolved.scheme_id}) via ${resolved.resolved_via}`)
      }
    } else {
      console.log(`[resolve-charges] RPC resolved: ${resolved.scheme_name} (${resolved.scheme_id}) via ${resolved.resolved_via}`)
    }

    if (!resolved) {
      console.warn(`[resolve-charges] No scheme found for user=${user.partner_id}, service=${serviceType} (tried both RPC and direct query)`)
      return NextResponse.json({
        resolved: false,
        scheme: null,
        charges: null,
        message: 'No scheme found for this user/service',
        debug: { user_id: user.partner_id, role: user.role, service: serviceType, distributor_id: distributorId, md_id: mdId, resolution_method: resolutionMethod },
      })
    }

    // ================================================================
    // CHARGE CALCULATION
    // ================================================================

    if (serviceType === 'payout') {
      if (!transferMode) {
        return NextResponse.json({ error: 'transfer_mode is required for payout' }, { status: 400 })
      }

      // Try RPC charge calculation first
      let charges: any = null
      
      try {
        const { data: chargeResult, error: chargeError } = await adminClient.rpc('calculate_payout_charge_from_scheme', {
          p_scheme_id: resolved.scheme_id,
          p_amount: amount,
          p_transfer_mode: transferMode,
        })

        if (!chargeError && chargeResult && chargeResult.length > 0) {
          const rc = parseFloat(chargeResult[0].retailer_charge)
          // Only accept if charge > 0 (0 means no slab found in RPC)
          if (rc > 0 || (chargeResult[0].retailer_charge !== null && chargeResult[0].retailer_charge !== undefined)) {
            charges = {
              retailer_charge: rc || 0,
              retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
              distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
              md_commission: parseFloat(chargeResult[0].md_commission) || 0,
              company_earning: parseFloat(chargeResult[0].company_earning) || 0,
            }
            console.log(`[resolve-charges] Payout charge via RPC: ₹${charges.retailer_charge}`)
          }
        }
        if (chargeError) {
          console.error(`[resolve-charges] Payout charge RPC error:`, chargeError.message, chargeError.code)
        }
      } catch (err: any) {
        console.error(`[resolve-charges] Payout charge RPC failed:`, err.message)
      }

      // Fallback: Direct query charge calculation
      if (!charges || charges.retailer_charge === 0) {
        console.warn(`[resolve-charges] Payout RPC charge was 0 or null, trying direct query...`)
        const directCharges = await calculatePayoutChargeDirectQuery(resolved.scheme_id, amount, transferMode)
        if (directCharges && directCharges.retailer_charge > 0) {
          charges = directCharges
          console.log(`[resolve-charges] Payout charge via direct query: ₹${charges.retailer_charge}`)
        }
      }

      // Also fetch ALL payout charge slabs for this scheme so client can show charge per mode
      let allSlabs: any[] = []
      try {
        const { data: slabData } = await adminClient
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
        _debug: { resolution_method: resolutionMethod },
      })
    }

    if (serviceType === 'bbps') {
      // Try RPC charge calculation first
      let charges: any = null
      
      try {
        const { data: chargeResult, error: chargeError } = await adminClient.rpc('calculate_bbps_charge_from_scheme', {
          p_scheme_id: resolved.scheme_id,
          p_amount: amount,
          p_category: category || null,
        })

        if (!chargeError && chargeResult && chargeResult.length > 0) {
          const rc = parseFloat(chargeResult[0].retailer_charge)
          if (rc > 0 || (chargeResult[0].retailer_charge !== null && chargeResult[0].retailer_charge !== undefined)) {
            charges = {
              retailer_charge: rc || 0,
              retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
              distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
              md_commission: parseFloat(chargeResult[0].md_commission) || 0,
              company_earning: parseFloat(chargeResult[0].company_earning) || 0,
            }
            console.log(`[resolve-charges] BBPS charge via RPC: ₹${charges.retailer_charge}`)
          }
        }
        if (chargeError) {
          console.error(`[resolve-charges] BBPS charge RPC error:`, chargeError.message, chargeError.code)
        }
      } catch (err: any) {
        console.error(`[resolve-charges] BBPS charge RPC failed:`, err.message)
      }

      // Fallback: Direct query charge calculation
      if (!charges || charges.retailer_charge === 0) {
        console.warn(`[resolve-charges] BBPS RPC charge was 0 or null, trying direct query...`)
        const directCharges = await calculateBBPSChargeDirectQuery(resolved.scheme_id, amount, category || null)
        if (directCharges) {
          charges = directCharges
          console.log(`[resolve-charges] BBPS charge via direct query: ₹${charges.retailer_charge}`)
        }
      }

      return NextResponse.json({
        resolved: true,
        scheme: {
          id: resolved.scheme_id,
          name: resolved.scheme_name,
          type: resolved.scheme_type,
          resolved_via: resolved.resolved_via,
        },
        charges: charges,
        _debug: { resolution_method: resolutionMethod },
      })
    }

    if (serviceType === 'mdr') {
      // Return MDR rates from the resolved scheme
      let mdrRates: any[] = []
      try {
        const { data } = await adminClient
          .from('scheme_mdr_rates')
          .select('*')
          .eq('scheme_id', resolved.scheme_id)
          .eq('status', 'active')
        mdrRates = data || []
      } catch (mdrErr: any) {
        console.error(`[resolve-charges] MDR rates fetch error:`, mdrErr.message)
      }

      // Filter by mode/card_type/brand if provided
      let filteredRates = mdrRates
      if (mode) filteredRates = filteredRates.filter((r: any) => r.mode === mode)
      if (cardType) filteredRates = filteredRates.filter((r: any) => r.card_type === cardType)
      if (brandType) filteredRates = filteredRates.filter((r: any) => r.brand_type === brandType)

      // Pick the best matching rate
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
        _debug: { resolution_method: resolutionMethod },
      })
    }

    return NextResponse.json({ error: 'Invalid service_type' }, { status: 400 })

  } catch (err: any) {
    console.error('[API /api/schemes/resolve-charges] Unhandled error:', err?.message || err, err?.stack)
    return NextResponse.json({ 
      error: err?.message || 'Internal server error', 
      step: 'unhandled',
      stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined
    }, { status: 500 })
  }
}
