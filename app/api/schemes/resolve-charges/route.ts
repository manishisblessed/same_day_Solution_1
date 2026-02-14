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
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

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

    // Get user
    let user = await getCurrentUserFromRequest(request)

    // Fallback auth using user_id query param
    if ((!user || !user.partner_id) && userId) {
      const { data: retailer } = await supabaseAdmin
        .from('retailers')
        .select('partner_id, name, email, distributor_id, master_distributor_id')
        .eq('partner_id', userId)
        .maybeSingle()

      if (retailer) {
        user = {
          id: userId,
          email: retailer.email,
          role: 'retailer',
          partner_id: retailer.partner_id,
          name: retailer.name,
        }
      }
    }

    if (!user || !user.partner_id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Get the retailer's distributor chain for proper scheme hierarchy resolution
    let distributorId: string | null = null
    let mdId: string | null = null

    if (user.role === 'retailer') {
      const { data: retailerData } = await supabaseAdmin
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', user.partner_id)
        .maybeSingle()

      distributorId = retailerData?.distributor_id || null
      mdId = retailerData?.master_distributor_id || null
    } else if (user.role === 'distributor') {
      const { data: distData } = await supabaseAdmin
        .from('distributors')
        .select('master_distributor_id')
        .eq('partner_id', user.partner_id)
        .maybeSingle()

      mdId = distData?.master_distributor_id || null
    }

    // Resolve scheme for user
    const { data: schemeResult, error: schemeError } = await supabaseAdmin.rpc('resolve_scheme_for_user', {
      p_user_id: user.partner_id,
      p_user_role: user.role,
      p_service_type: serviceType,
      p_distributor_id: distributorId,
      p_md_id: mdId,
    })

    if (schemeError || !schemeResult || schemeResult.length === 0) {
      return NextResponse.json({
        resolved: false,
        scheme: null,
        charges: null,
        message: 'No scheme found for this user/service',
      })
    }

    const resolved = schemeResult[0]

    // Calculate charges based on service type
    if (serviceType === 'payout') {
      if (!transferMode) {
        return NextResponse.json({ error: 'transfer_mode is required for payout' }, { status: 400 })
      }

      const { data: chargeResult, error: chargeError } = await supabaseAdmin.rpc('calculate_payout_charge_from_scheme', {
        p_scheme_id: resolved.scheme_id,
        p_amount: amount,
        p_transfer_mode: transferMode,
      })

      // Also fetch ALL payout charge slabs for this scheme so client can show charge per mode
      const { data: allSlabs } = await supabaseAdmin
        .from('scheme_payout_charges')
        .select('transfer_mode, min_amount, max_amount, retailer_charge, retailer_charge_type')
        .eq('scheme_id', resolved.scheme_id)
        .eq('status', 'active')
        .order('transfer_mode')
        .order('min_amount')

      return NextResponse.json({
        resolved: true,
        scheme: {
          id: resolved.scheme_id,
          name: resolved.scheme_name,
          type: resolved.scheme_type,
          resolved_via: resolved.resolved_via,
        },
        charges: chargeResult && chargeResult.length > 0 ? {
          retailer_charge: parseFloat(chargeResult[0].retailer_charge) || 0,
          retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
          distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
          md_commission: parseFloat(chargeResult[0].md_commission) || 0,
          company_earning: parseFloat(chargeResult[0].company_earning) || 0,
        } : null,
        slabs: allSlabs || [],
      })
    }

    if (serviceType === 'bbps') {
      const { data: chargeResult, error: chargeError } = await supabaseAdmin.rpc('calculate_bbps_charge_from_scheme', {
        p_scheme_id: resolved.scheme_id,
        p_amount: amount,
        p_category: category || null,
      })

      return NextResponse.json({
        resolved: true,
        scheme: {
          id: resolved.scheme_id,
          name: resolved.scheme_name,
          type: resolved.scheme_type,
          resolved_via: resolved.resolved_via,
        },
        charges: chargeResult && chargeResult.length > 0 ? {
          retailer_charge: parseFloat(chargeResult[0].retailer_charge) || 0,
          retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
          distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
          md_commission: parseFloat(chargeResult[0].md_commission) || 0,
          company_earning: parseFloat(chargeResult[0].company_earning) || 0,
        } : null,
      })
    }

    if (serviceType === 'mdr') {
      // Return MDR rates from the resolved scheme
      const { data: mdrRates } = await supabaseAdmin
        .from('scheme_mdr_rates')
        .select('*')
        .eq('scheme_id', resolved.scheme_id)
        .eq('status', 'active')

      // Filter by mode/card_type/brand if provided
      let filteredRates = mdrRates || []
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
      })
    }

    return NextResponse.json({ error: 'Invalid service_type' }, { status: 400 })

  } catch (err: any) {
    console.error('[API /api/schemes/resolve-charges]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

