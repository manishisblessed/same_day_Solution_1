import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { computeShadvalRefundAmount } from '@/lib/settlement-2/shadval-refund'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ALLOWED_ROLES = ['admin', 'finance_executive']

const SELECT_COLS =
  'id, retailer_id, reference_id, order_id, status, status_message, amount, charges, total_debit, actual_wallet_debit, utr, account_holder_name, account_number, ifsc_code, mode, created_at, updated_at'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * GET /api/admin/reversal/shadval-search
 *
 * Discovery endpoint for the Reversals console. Finds shadval settlement /
 * payout transactions by date range, status and free-text search, and annotates
 * each row with:
 *   - refund_state: 'refunded' | 'not_refunded'  (from the wallet ledgers)
 *   - target: 'partner' | 'retailer'             (authoritative, partners table)
 *   - owner_name                                 (partner/retailer display name)
 *   - refund_amount                              (exact wallet debit)
 *
 * Query params: start, end (YYYY-MM-DD), status (ALL|PENDING|FAILED|SUCCESS|REFUNDABLE),
 * search, limit.
 */
export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Session expired', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (!ALLOWED_ROLES.includes(admin.role as string)) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const start = sp.get('start') || ''
    const end = sp.get('end') || ''
    const status = (sp.get('status') || 'ALL').toUpperCase()
    const search = (sp.get('search') || '').trim()
    const limit = Math.min(parseInt(sp.get('limit') || '200', 10) || 200, 1000)

    const supabase = getSupabase()

    let query = supabase.from('shadval_settlement').select(SELECT_COLS).order('created_at', { ascending: false }).limit(limit)

    if (start) query = query.gte('created_at', `${start}T00:00:00`)
    if (end) query = query.lte('created_at', `${end}T23:59:59`)
    if (['PENDING', 'FAILED', 'SUCCESS'].includes(status)) query = query.eq('status', status)
    if (status === 'REFUNDABLE') query = query.in('status', ['PENDING', 'FAILED'])
    if (search) {
      const s = search.replace(/[%,]/g, '')
      query = query.or(
        `order_id.ilike.%${s}%,reference_id.ilike.%${s}%,account_holder_name.ilike.%${s}%,account_number.ilike.%${s}%,utr.ilike.%${s}%`
      )
    }

    const { data: rows, error } = await query
    if (error) {
      console.error('[Shadval Search] Query error:', error)
      return NextResponse.json({ success: false, error: 'Failed to fetch transactions' }, { status: 500 })
    }

    const txns = rows || []
    if (txns.length === 0) {
      return NextResponse.json({ success: true, count: 0, transactions: [], stats: emptyStats() })
    }

    // Batch: which retailer_ids are partners (authoritative target routing).
    const retailerIds = Array.from(new Set(txns.map((t) => t.retailer_id).filter(Boolean)))
    const [{ data: partnerRows }, { data: retailerRows }] = await Promise.all([
      supabase.from('partners').select('id, name, business_name').in('id', retailerIds),
      supabase.from('retailers').select('partner_id, name').in('partner_id', retailerIds),
    ])
    const partnerMap = new Map<string, string>()
    for (const p of partnerRows || []) partnerMap.set(p.id, p.business_name || p.name || p.id)
    const retailerMap = new Map<string, string>()
    for (const r of retailerRows || []) retailerMap.set(r.partner_id, r.name || r.partner_id)

    // Batch: which references already have a refund credit in either ledger.
    const refKeys: string[] = []
    for (const t of txns) {
      if (t.reference_id) {
        refKeys.push(`REFUND_${t.reference_id}`, `REFUND_TIMEOUT_${t.reference_id}`)
      }
    }
    const refundedRefs = new Set<string>()
    if (refKeys.length > 0) {
      const [{ data: wl }, { data: pwl }] = await Promise.all([
        supabase.from('wallet_ledger').select('reference_id').in('reference_id', refKeys).gt('credit', 0),
        supabase.from('partner_wallet_ledger').select('reference_id').in('reference_id', refKeys).gt('credit', 0),
      ])
      for (const r of wl || []) refundedRefs.add(r.reference_id)
      for (const r of pwl || []) refundedRefs.add(r.reference_id)
    }

    const annotated = txns.map((t) => {
      const isPartner = partnerMap.has(t.retailer_id)
      const refunded = t.reference_id
        ? refundedRefs.has(`REFUND_${t.reference_id}`) || refundedRefs.has(`REFUND_TIMEOUT_${t.reference_id}`)
        : false
      return {
        ...t,
        refund_amount: computeShadvalRefundAmount(t),
        target: isPartner ? 'partner' : 'retailer',
        owner_name: (isPartner ? partnerMap.get(t.retailer_id) : retailerMap.get(t.retailer_id)) || t.retailer_id,
        refund_state: refunded ? 'refunded' : 'not_refunded',
      }
    })

    // Stats
    const stats = {
      total: annotated.length,
      pending: annotated.filter((t) => t.status === 'PENDING').length,
      failed: annotated.filter((t) => t.status === 'FAILED').length,
      success: annotated.filter((t) => t.status === 'SUCCESS').length,
      already_refunded: annotated.filter((t) => t.refund_state === 'refunded').length,
      refundable: annotated.filter((t) => t.refund_state === 'not_refunded' && t.status !== 'SUCCESS').length,
      refundable_amount: Number(
        annotated
          .filter((t) => t.refund_state === 'not_refunded' && t.status !== 'SUCCESS')
          .reduce((s, t) => s + (t.refund_amount || 0), 0)
          .toFixed(2)
      ),
    }

    return NextResponse.json({ success: true, count: annotated.length, transactions: annotated, stats })
  } catch (error: any) {
    console.error('[Shadval Search] Error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 })
  }
}

function emptyStats() {
  return { total: 0, pending: 0, failed: 0, success: 0, already_refunded: 0, refundable: 0, refundable_amount: 0 }
}
