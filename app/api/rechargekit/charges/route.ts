import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { RECHARGEKIT_DEFAULT_BASE_CHARGE, isCreditCard2Enabled } from '@/services/rechargekit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GST_PERCENT = 18

let _supabaseAdmin: SupabaseClient | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )
  }
  return _supabaseAdmin
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/rechargekit/charges?amount=1000
 * Credit Card-2 charge preview (scheme or commercial fallback ₹8 + GST)
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !['retailer', 'partner'].includes(user.role)) {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    if (!(await isCreditCard2Enabled(user))) {
      const response = NextResponse.json(
        { success: false, error: 'Credit Card-2 service is not enabled for your account' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const { searchParams } = new URL(request.url)
    const amount = parseFloat(searchParams.get('amount') || '0')

    if (amount <= 0) {
      const response = NextResponse.json({ success: false, error: 'Valid amount is required' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    const supabase = getSupabaseAdmin()

    let distributorId: string | null = null
    let mdId: string | null = null
    if (user.role === 'retailer') {
      try {
        const { data: retailer } = await supabase
          .from('retailers')
          .select('distributor_id, master_distributor_id')
          .eq('partner_id', user.partner_id)
          .maybeSingle()
        distributorId = retailer?.distributor_id || null
        mdId = retailer?.master_distributor_id || null
      } catch (e) {
        console.warn('[Rechargekit Charges] Retailer lookup failed:', e)
      }
    }

    let charges = null
    let schemeName: string | null = null
    const schemeCategory = 'Credit Card'

    try {
      const { data: schemeResult, error: schemeError } = await (supabase as any).rpc('resolve_scheme_for_user', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_service_type: 'bbps',
        p_distributor_id: distributorId,
        p_md_id: mdId,
      })

      if (schemeError) {
        console.error('[Rechargekit Charges] Scheme RPC error:', schemeError)
      } else if (schemeResult?.length > 0) {
        schemeName = schemeResult[0].scheme_name

        const { data: chargeResult, error: chargeError } = await (supabase as any).rpc('calculate_bbps_charge_from_scheme', {
          p_scheme_id: schemeResult[0].scheme_id,
          p_amount: amount,
          p_category: schemeCategory,
        })

        if (chargeError) {
          console.error('[Rechargekit Charges] Charge calc error:', chargeError)
        } else if (chargeResult?.length > 0 && parseFloat(chargeResult[0].retailer_charge) > 0) {
          charges = {
            retailer_charge: parseFloat(chargeResult[0].retailer_charge) || 0,
            retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
          }
        } else {
          const { data: slabs } = await (supabase as any)
            .from('scheme_bbps_commissions')
            .select('*')
            .eq('scheme_id', schemeResult[0].scheme_id)
            .eq('status', 'active')
            .lte('min_amount', amount)
            .gte('max_amount', amount)
            .order('min_amount', { ascending: false })

          if (slabs?.length > 0) {
            const bestSlab = slabs.find((s: any) => {
              const sc = s.category
              return !sc || sc === '' || sc.toLowerCase() === 'all' || sc.toLowerCase() === 'all categories' || sc === schemeCategory
            })
            if (bestSlab) {
              const calc = (v: number, t: string) =>
                t === 'percentage' ? Math.round((amount * v) / 100 * 100) / 100 : v
              charges = {
                retailer_charge: calc(parseFloat(bestSlab.retailer_charge) || 0, bestSlab.retailer_charge_type),
                retailer_commission: calc(parseFloat(bestSlab.retailer_commission) || 0, bestSlab.retailer_commission_type),
                distributor_commission: calc(parseFloat(bestSlab.distributor_commission) || 0, bestSlab.distributor_commission_type),
                md_commission: calc(parseFloat(bestSlab.md_commission) || 0, bestSlab.md_commission_type),
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[Rechargekit Charges] Scheme resolution error:', e)
    }

    // Commercial fallback: ₹8 + GST (from Rechargekit commercial terms)
    const baseCharge = charges?.retailer_charge || RECHARGEKIT_DEFAULT_BASE_CHARGE
    const gstAmount = Math.round((baseCharge * GST_PERCENT) / 100 * 100) / 100
    const totalCharge = Math.round((baseCharge + gstAmount) * 100) / 100

    const response = NextResponse.json({
      success: true,
      amount,
      scheme_name: schemeName,
      charges: {
        base_charge: baseCharge,
        gst_percent: GST_PERCENT,
        gst_amount: gstAmount,
        total_charge: totalCharge,
        fallback: !charges?.retailer_charge,
      },
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Rechargekit Charges] Error:', error)
    const response = NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return addCorsHeaders(request, response)
  }
}
