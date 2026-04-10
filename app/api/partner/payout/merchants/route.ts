import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'

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
 * GET /api/partner/payout/merchants
 *
 * Returns the list of merchants (retailers) linked to the authenticated
 * partner's account. The partner must use one of these `merchant_id` values
 * when calling POST /api/partner/payout/transfer.
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
    if (!partner.permissions.includes('payout') && !partner.permissions.includes('all')) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Missing required permission: payout' } },
        { status: 403 }
      )
    }

    const supabase = getSupabase()

    const { data: links, error: linkErr } = await supabase
      .from('partner_merchant_links')
      .select('merchant_id, created_at')
      .eq('partner_id', partner.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (linkErr) throw linkErr

    const merchantIds = (links || []).map((l: any) => l.merchant_id as string)

    if (merchantIds.length === 0) {
      return NextResponse.json({
        success: true,
        merchants: [],
        total: 0,
        message: 'No merchants linked to your partner account yet. Contact admin to link merchants.',
      })
    }

    const { data: retailers } = await supabase
      .from('retailers')
      .select('partner_id, name, business_name, email, phone, status')
      .in('partner_id', merchantIds)

    const retailerMap: Record<string, any> = {}
    for (const r of retailers || []) {
      retailerMap[r.partner_id] = r
    }

    const merchants = merchantIds.map((mid) => {
      const r = retailerMap[mid]
      return {
        merchant_id: mid,
        name: r?.name || null,
        business_name: r?.business_name || null,
        email: r?.email || null,
        phone: r?.phone || null,
        status: r?.status || 'unknown',
        onboarded: !!r,
      }
    })

    return NextResponse.json({
      success: true,
      merchants,
      total: merchants.length,
    })
  } catch (error: any) {
    console.error('[Partner Payout Merchants] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
