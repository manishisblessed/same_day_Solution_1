import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { resolveShadvalCharge } from '@/lib/shadval-charge'
import { SCHEME_NOT_ASSIGNED, SCHEME_NOT_ASSIGNED_STATUS, SCHEME_NO_VALID_SLAB, hasCoveringShadvalSlab } from '@/lib/scheme-guard'
import { computeGst, getShadvalSlabGstInclusive } from '@/lib/scheme-gst'

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

/**
 * GET /api/partner/settlement/charges?amount=1000&mode=IMPS
 * Get settlement charges for a given amount and mode.
 * Charges are resolved from the partner's mapped Settlement-2 (Shadval) scheme.
 * GST (18%) is applied only when the matched slab is configured as GST-inclusive.
 */
export async function GET(request: NextRequest) {
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
    const access = partnerCanUseApi(partner, 'settlement')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: access.message } },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const amount = parseFloat(searchParams.get('amount') || '0')
    const mode = searchParams.get('mode') || 'IMPS'

    if (amount <= 0) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Valid amount is required' } },
        { status: 400 }
      )
    }

    const validModes = ['IMPS', 'RTGS']
    if (!validModes.includes(mode)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid mode. Must be IMPS or RTGS' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Resolve the partner's Settlement-2 (Shadval) scheme charge for this amount + mode.
    // Scoped to schemes the partner is actually mapped to (see resolveShadvalCharge).
    const { baseCharge, schemeId, schemeName } = await resolveShadvalCharge(supabase, partner.id, amount, mode)

    // No explicitly assigned scheme => report not-assigned so the preview matches the
    // block enforced by the transfer endpoint (no silent ₹0 quote).
    if (!schemeId) {
      return NextResponse.json(
        { success: false, error: { code: SCHEME_NOT_ASSIGNED.code, message: SCHEME_NOT_ASSIGNED.error } },
        { status: SCHEME_NOT_ASSIGNED_STATUS }
      )
    }

    const settlementSlabOk = await hasCoveringShadvalSlab(supabase, schemeId, amount, mode)
    if (!settlementSlabOk) {
      return NextResponse.json(
        { success: false, error: { code: SCHEME_NO_VALID_SLAB.code, message: SCHEME_NO_VALID_SLAB.error } },
        { status: SCHEME_NOT_ASSIGNED_STATUS }
      )
    }

    // GST applies only when the matched slab is configured as GST-inclusive.
    const gstInclusive = await getShadvalSlabGstInclusive(supabase, schemeId, amount, mode)
    const { gstAmount, totalCharge, gstPercent } = computeGst(baseCharge, gstInclusive)

    return NextResponse.json({
      success: true,
      amount,
      mode,
      scheme_name: schemeName,
      charges: baseCharge,
      gst_percent: gstPercent,
      gst_amount: gstAmount,
      total_charge: totalCharge,
      total_debit: Math.round((amount + totalCharge) * 100) / 100,
    })
  } catch (error: any) {
    console.error('[Partner Settlement Charges] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
