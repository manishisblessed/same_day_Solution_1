import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GST_PERCENT = 18

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * Scheme IDs a user is entitled to for Settlement-2 charge lookups.
 * When the RPC has already resolved the applicable scheme, that scheme is the
 * single source of truth — scope strictly to it so we never leak charges from
 * an old/unrelated scheme. Only when nothing was resolved do we fall back to
 * every shadval/all scheme the user is directly mapped to.
 */
async function getScopedSchemeIds(
  partnerId: string | undefined,
  role: string,
  resolvedSchemeId: string | null
): Promise<string[]> {
  if (resolvedSchemeId) return [resolvedSchemeId]
  if (!partnerId) return []
  try {
    const { data: mappings } = await supabaseAdmin
      .from('scheme_mappings')
      .select('scheme_id, service_type, status')
      .eq('entity_id', partnerId)
      .eq('entity_role', role)
      .eq('status', 'active')
    return (mappings || [])
      .filter((m: any) => !m.service_type || m.service_type === 'all' || m.service_type === 'shadval_settlement')
      .map((m: any) => m.scheme_id)
  } catch (e) {
    console.warn('[Settlement-2 Charges] Scheme mapping lookup failed:', e)
    return []
  }
}

/**
 * GET /api/settlement-2/charges?amount=1000&mode=IMPS
 * Get applicable settlement charges for the current retailer
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    const access = authorizeSubPartner(user, 'settlement-2')
    if (!access.ok) return access.response
    if (!user || !['retailer', 'distributor', 'partner'].includes(user.role)) {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    const { searchParams } = new URL(request.url)
    const amount = parseFloat(searchParams.get('amount') || '0')
    const mode = searchParams.get('mode') || 'IMPS'

    if (amount <= 0) {
      const response = NextResponse.json({ success: false, error: 'Valid amount is required' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    let distributorId: string | null = null
    let mdId: string | null = null
    if (user.role === 'retailer') {
      try {
        const { data: retailer } = await supabaseAdmin
          .from('retailers')
          .select('distributor_id, master_distributor_id')
          .eq('partner_id', user.partner_id)
          .maybeSingle()
        distributorId = retailer?.distributor_id || null
        mdId = retailer?.master_distributor_id || null
      } catch (e) {
        console.warn('[Settlement-2 Charges] Retailer lookup failed:', e)
      }
    } else if (user.role === 'distributor') {
      distributorId = user.partner_id
      try {
        const { data: dist } = await supabaseAdmin
          .from('distributors')
          .select('master_distributor_id')
          .eq('partner_id', user.partner_id)
          .maybeSingle()
        mdId = dist?.master_distributor_id || null
      } catch (e) {
        console.warn('[Settlement-2 Charges] Distributor lookup failed:', e)
      }
    }

    // Resolve scheme
    let charges = null
    let schemeName: string | null = null
    let resolvedSchemeId: string | null = null

    try {
      const { data: schemeResult } = await (supabaseAdmin as any).rpc('resolve_scheme_for_user', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_service_type: 'shadval_settlement',
        p_distributor_id: distributorId,
        p_md_id: mdId,
      })

      if (schemeResult?.length > 0) {
        schemeName = schemeResult[0].scheme_name
        resolvedSchemeId = schemeResult[0].scheme_id

        const { data: chargeResult } = await (supabaseAdmin as any).rpc(
          'calculate_shadval_settlement_charge_from_scheme',
          { p_scheme_id: schemeResult[0].scheme_id, p_amount: amount, p_transfer_mode: mode }
        )

        if (chargeResult?.length > 0 && parseFloat(chargeResult[0].retailer_charge) > 0) {
          charges = {
            retailer_charge: parseFloat(chargeResult[0].retailer_charge) || 0,
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
            company_charge: parseFloat(chargeResult[0].company_charge) || 0,
          }
        }
      }
    } catch (e) {
      console.error('[Settlement-2 Charges] Scheme resolution error:', e)
    }

    // Candidate scheme IDs this user is actually entitled to. Used to scope all
    // fallback/limit queries so we never pick up charges from an unrelated scheme.
    const scopedSchemeIds = await getScopedSchemeIds(user.partner_id, user.role, resolvedSchemeId)

    // Fallback: direct query scoped to the user's own scheme(s). Triggers when the
    // RPC resolved a scheme but the charge lives in rt_purchase_charge (retailer_charge=0).
    if (!charges && scopedSchemeIds.length > 0) {
      try {
        const { data: slabs } = await supabaseAdmin
          .from('scheme_shadval_settlement_charges')
          .select('*')
          .in('scheme_id', scopedSchemeIds)
          .eq('status', 'active')
          .eq('transfer_mode', mode)
          .lte('min_amount', amount)
          .gte('max_amount', amount)
          .order('min_amount', { ascending: false })
          .limit(1)

        if (slabs?.length) {
          const s = slabs[0]
          const calc = (v: number, t: string) => t === 'percentage' ? Math.round(amount * v / 100 * 100) / 100 : v
          const rtCharge = parseFloat(s.rt_purchase_charge) || 0
          const baseRetailerCharge = parseFloat(s.retailer_charge) || 0
          const effectiveCharge = rtCharge > 0 ? rtCharge : baseRetailerCharge
          const effectiveType = rtCharge > 0 ? (s.rt_purchase_charge_type || 'flat') : (s.retailer_charge_type || 'flat')
          charges = {
            retailer_charge: calc(effectiveCharge, effectiveType),
            distributor_commission: calc(parseFloat(s.distributor_commission) || 0, s.distributor_commission_type),
            md_commission: calc(parseFloat(s.md_commission) || 0, s.md_commission_type),
            company_charge: calc(parseFloat(s.company_charge) || 0, s.company_charge_type),
          }
        }
      } catch (e) {
        console.error('[Settlement-2 Charges] Direct query error:', e)
      }
    }

    // Slab limits for this mode: used by the UI to block amounts outside the allowed range.
    // Scoped to the user's own scheme(s) so limits match the charges being applied.
    let limits: { min_allowed: number; max_allowed: number; within_limit: boolean } | null = null
    try {
      let slabRows: Array<{ min_amount: any; max_amount: any }> | null = null
      if (scopedSchemeIds.length > 0) {
        const { data } = await supabaseAdmin
          .from('scheme_shadval_settlement_charges')
          .select('min_amount, max_amount')
          .in('scheme_id', scopedSchemeIds)
          .eq('status', 'active')
          .eq('transfer_mode', mode)
        slabRows = data
      }
      if (slabRows && slabRows.length > 0) {
        const minAllowed = Math.min(...slabRows.map(s => parseFloat(String(s.min_amount))))
        const maxAllowed = Math.max(...slabRows.map(s => parseFloat(String(s.max_amount))))
        const withinLimit = slabRows.some(s =>
          amount >= parseFloat(String(s.min_amount)) && amount <= parseFloat(String(s.max_amount))
        )
        limits = { min_allowed: minAllowed, max_allowed: maxAllowed, within_limit: withinLimit }
      }
    } catch (e) {
      console.warn('[Settlement-2 Charges] Limit lookup failed:', e)
    }

    const response = NextResponse.json({
      success: true,
      amount,
      mode,
      scheme_name: schemeName,
      limits,
      charges: charges
        ? {
            retailer_charge: Math.round((charges.retailer_charge + charges.retailer_charge * GST_PERCENT / 100) * 100) / 100,
            retailer_charge_base: charges.retailer_charge,
            gst_amount: Math.round(charges.retailer_charge * GST_PERCENT / 100 * 100) / 100,
            gst_percent: GST_PERCENT,
            distributor_commission: charges.distributor_commission,
            md_commission: charges.md_commission,
            company_charge: charges.company_charge,
          }
        : { retailer_charge: 0, retailer_charge_base: 0, gst_amount: 0, gst_percent: GST_PERCENT, distributor_commission: 0, md_commission: 0, company_charge: 0 },
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Settlement-2 Charges] Error:', error)
    const response = NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return addCorsHeaders(request, response)
  }
}
