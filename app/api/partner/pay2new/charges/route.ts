import { NextRequest, NextResponse } from 'next/server'
import { toUserSafeError } from '@/lib/provider-error'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { createClient } from '@supabase/supabase-js'
import { SCHEME_NOT_ASSIGNED, SCHEME_NOT_ASSIGNED_STATUS, SCHEME_NO_VALID_SLAB, hasCoveringBbpsSlab } from '@/lib/scheme-guard'
import { getPartnerApiMax } from '@/lib/txn-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

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

    const { amount } = body

    const amountNum = parseFloat(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Valid amount is required' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Mirror the bill-pay ceiling so the charge preview matches enforcement.
    const maxTxnAmount = await getPartnerApiMax(supabase, partner.api_max_txn_amount)
    if (amountNum > maxTxnAmount) {
      return NextResponse.json(
        { success: false, error: { code: 'AMOUNT_LIMIT_EXCEEDED', message: `Amount exceeds the maximum allowed limit of ₹${maxTxnAmount.toLocaleString('en-IN')}` } },
        { status: 400 }
      )
    }

    let charges = null
    let schemeName: string | null = null
    let resolvedSchemeId: string | null = null
    const schemeCategory = 'Credit Card'

    try {
      const { data: schemeResult, error: schemeError } = await (supabase as any).rpc('resolve_scheme_for_user', {
        p_user_id: partner.id,
        p_user_role: 'partner',
        p_service_type: 'bbps',
        p_distributor_id: null,
        p_md_id: null,
      })

      if (schemeError) {
        console.error('[Partner Pay2New Charges] Scheme RPC error:', schemeError)
      } else if (schemeResult?.length > 0) {
        schemeName = schemeResult[0].scheme_name
        resolvedSchemeId = schemeResult[0].scheme_id

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
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[Partner Pay2New Charges] Scheme resolution error:', e)
    }

    // No explicitly assigned scheme => report not-assigned so the preview matches the
    // block enforced by the bill-pay endpoint (no silent ₹0 quote).
    if (!resolvedSchemeId) {
      return NextResponse.json(
        { success: false, error: { code: SCHEME_NOT_ASSIGNED.code, message: SCHEME_NOT_ASSIGNED.error } },
        { status: SCHEME_NOT_ASSIGNED_STATUS }
      )
    }

    const bbpsSlabOk = await hasCoveringBbpsSlab(supabase, resolvedSchemeId, amountNum, schemeCategory)
    if (!bbpsSlabOk) {
      return NextResponse.json(
        { success: false, error: { code: SCHEME_NO_VALID_SLAB.code, message: SCHEME_NO_VALID_SLAB.error } },
        { status: SCHEME_NOT_ASSIGNED_STATUS }
      )
    }

    // No GST charged — total equals the scheme base charge.
    const baseCharge = charges?.retailer_charge || 0
    const totalCharge = baseCharge

    return NextResponse.json({
      success: true,
      amount: amountNum,
      scheme_name: schemeName,
      charges: {
        base_charge: baseCharge,
        gst_percent: 0,
        gst_amount: 0,
        total_charge: totalCharge,
      },
    })
  } catch (error: any) {
    console.error('[Partner Pay2New Charges] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: toUserSafeError(error?.message, 'Failed to calculate charges') } },
      { status: 500 }
    )
  }
}
