import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { normalizeMasterPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/pay2new/pending-check?card_number=..&product_code=..&customer_number=..
 *
 * Read-only. Returns whether the CURRENT user already has an in-flight PENDING
 * Pay2New payment for the SAME card. The direct UI uses this to show a soft
 * "this will be a separate charge and cannot be reversed" confirmation before a
 * same-card re-payment — it does NOT block (split payments are allowed), it only
 * warns, so an accidental duplicate of a still-processing bill is prevented.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)
    if (!user) {
      const r = NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, r)
    }

    const sp = request.nextUrl.searchParams
    const cardNumber = (sp.get('card_number') || '').trim()
    const productCode = (sp.get('product_code') || '').trim()
    const customerNumber = (sp.get('customer_number') || '').trim()
    if (!cardNumber || !productCode) {
      const r = NextResponse.json({ success: false, error: 'card_number and product_code are required' }, { status: 400 })
      return addCorsHeaders(request, r)
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    // Look back 24h for a still-pending same-card payment by this user.
    const since = new Date(Date.now() - 24 * 3600_000).toISOString()
    let q = (supabaseAdmin as any)
      .from('pay2new_transactions')
      .select('request_id, amount, total_debit, created_at')
      .eq('user_id', user.partner_id)
      .eq('product_code', productCode)
      .eq('card_number', cardNumber)
      .eq('status', 'pending')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
    if (customerNumber) q = q.eq('customer_number', customerNumber)

    const { data } = await q
    const row = (data || [])[0]
    const r = NextResponse.json({
      success: true,
      pending: !!row,
      info: row
        ? {
            request_id: row.request_id,
            amount: Number(row.total_debit) || Number(row.amount || 0),
            created_at: row.created_at,
          }
        : null,
    })
    return addCorsHeaders(request, r)
  } catch (error: any) {
    console.error('[Pay2New Pending-Check] Error:', error)
    const r = NextResponse.json({ success: false, error: 'Check failed' }, { status: 500 })
    return addCorsHeaders(request, r)
  }
}
