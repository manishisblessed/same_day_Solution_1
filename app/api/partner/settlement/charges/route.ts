import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { resolveShadvalCharge } from '@/lib/shadval-charge'

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

/**
 * GET /api/partner/settlement/charges?amount=1000&mode=IMPS
 * Get settlement charges for a given amount and mode.
 * Charges are resolved from the partner's mapped Settlement-2 (Shadval) scheme,
 * with 18% GST applied on the base service charge.
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

    const validModes = ['IMPS', 'NEFT', 'RTGS']
    if (!validModes.includes(mode)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid mode. Must be IMPS, NEFT, or RTGS' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Resolve the partner's Settlement-2 (Shadval) scheme charge for this amount + mode.
    // Scoped to schemes the partner is actually mapped to (see resolveShadvalCharge).
    const { baseCharge, schemeName } = await resolveShadvalCharge(supabase, partner.id, amount, mode)

    const gstAmount = Math.round((baseCharge * GST_PERCENT) / 100 * 100) / 100
    const totalCharge = Math.round((baseCharge + gstAmount) * 100) / 100

    return NextResponse.json({
      success: true,
      amount,
      mode,
      scheme_name: schemeName,
      charges: baseCharge,
      gst_percent: GST_PERCENT,
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
