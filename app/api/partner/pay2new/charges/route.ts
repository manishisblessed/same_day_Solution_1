import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const GST_PERCENT = 18

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const e = error as PartnerAuthError
      return NextResponse.json(
        { success: false, error: { code: e.code, message: e.message } },
        { status: e.status }
      )
    }

    const { partner } = authResult
    const access = partnerCanUseApi(partner, 'bbps2')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: access.message } },
        { status: 403 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { retailer_id, amount } = body

    if (!retailer_id) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'retailer_id is required' } },
        { status: 400 }
      )
    }

    const amountNum = parseFloat(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Valid amount is required' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Verify retailer is linked to partner
    const { data: partnerRetailerLink } = await supabase
      .from('partner_retailers')
      .select('id')
      .eq('partner_id', partner.id)
      .eq('retailer_code', retailer_id)
      .maybeSingle()

    if (!partnerRetailerLink) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Retailer is not linked to your partner account' } },
        { status: 403 }
      )
    }

    let distributorId: string | null = null
    let mdId: string | null = null
    try {
      const { data: retailer } = await supabase
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', retailer_id)
        .maybeSingle()
      distributorId = retailer?.distributor_id || null
      mdId = retailer?.master_distributor_id || null
    } catch (e) {
      console.warn('[Partner Pay2New Charges] Retailer lookup failed:', e)
    }

    let charges = null
    let schemeName: string | null = null
    const schemeCategory = 'Credit Card'

    try {
      const { data: schemeResult, error: schemeError } = await (supabase as any).rpc('resolve_scheme_for_user', {
        p_user_id: retailer_id,
        p_user_role: 'retailer',
        p_service_type: 'bbps',
        p_distributor_id: distributorId,
        p_md_id: mdId,
      })

      if (schemeError) {
        console.error('[Partner Pay2New Charges] Scheme RPC error:', schemeError)
      } else if (schemeResult?.length > 0) {
        schemeName = schemeResult[0].scheme_name

        const { data: chargeResult, error: chargeError } = await (supabase as any).rpc('calculate_bbps_charge_from_scheme', {
          p_scheme_id: schemeResult[0].scheme_id,
          p_amount: amountNum,
          p_category: schemeCategory,
        })

        if (chargeError) {
          console.error('[Partner Pay2New Charges] Charge calc error:', chargeError)
        } else if (chargeResult?.length > 0 && parseFloat(chargeResult[0].retailer_charge) > 0) {
          charges = {
            retailer_charge: parseFloat(chargeResult[0].retailer_charge) || 0,
            retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
          }
        } else {
          const { data: slabs } = await (supabase as any)
            .from('scheme_bbps_commissions')
            .select('*')
            .eq('scheme_id', schemeResult[0].scheme_id)
            .eq('status', 'active')
            .lte('min_amount', amountNum)
            .gte('max_amount', amountNum)
            .order('min_amount', { ascending: false })

          if (slabs?.length > 0) {
            const bestSlab = slabs.find((s: any) => {
              const sc = s.category
              return !sc || sc === '' || sc.toLowerCase() === 'all' || sc.toLowerCase() === 'all categories' || sc === schemeCategory
            })
            if (bestSlab) {
              const calc = (v: number, t: string) => t === 'percentage' ? Math.round(amountNum * v / 100 * 100) / 100 : v
              charges = {
                retailer_charge: calc(parseFloat(bestSlab.retailer_charge) || 0, bestSlab.retailer_charge_type),
                retailer_commission: calc(parseFloat(bestSlab.retailer_commission) || 0, bestSlab.retailer_commission_type),
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[Partner Pay2New Charges] Scheme resolution error:', e)
    }

    const baseCharge = charges?.retailer_charge || 0
    const gstAmount = Math.round(baseCharge * GST_PERCENT / 100 * 100) / 100
    const totalCharge = Math.round((baseCharge + gstAmount) * 100) / 100

    return NextResponse.json({
      success: true,
      amount: amountNum,
      scheme_name: schemeName,
      charges: {
        base_charge: baseCharge,
        gst_percent: GST_PERCENT,
        gst_amount: gstAmount,
        total_charge: totalCharge,
      },
    })
  } catch (error: any) {
    console.error('[Partner Pay2New Charges] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: error.message || 'Failed to calculate charges' } },
      { status: 500 }
    )
  }
}
