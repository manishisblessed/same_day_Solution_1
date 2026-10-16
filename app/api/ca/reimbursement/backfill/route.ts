import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireCA(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) return { error: 'Session expired. Please login again.', status: 401 as const }
  if (user.role !== 'ca_executive' && user.role !== 'admin') {
    return { error: 'CA access required', status: 403 as const }
  }
  return { user }
}

/**
 * POST /api/ca/reimbursement/backfill
 *
 * Generates reimbursement invoices for historical pos_transactions that
 * don't yet have one (e.g. transactions before the trigger was installed, or
 * TIDs linked to a brand after the fact).
 *
 * Body: { date_from: 'YYYY-MM-DD', date_to: 'YYYY-MM-DD', brand_id?: string }
 *
 * Delegates to the DB function ca_backfill_reimbursements() which reuses the
 * exact same brand/MDR resolution + numbering logic as the live trigger.
 */
export async function POST(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const dateFrom = String(body.date_from || '').trim()
    const dateTo = String(body.date_to || '').trim()
    const brandId = body.brand_id ? String(body.brand_id).trim() : null

    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRe.test(dateFrom) || !dateRe.test(dateTo)) {
      return NextResponse.json({ error: 'date_from and date_to are required (YYYY-MM-DD)' }, { status: 400 })
    }
    if (dateTo < dateFrom) {
      return NextResponse.json({ error: 'date_to must be on or after date_from' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    // Backfill both pos_transactions and razorpay_pos_transactions
    const [posResult, rzResult] = await Promise.all([
      supabase.rpc('ca_backfill_reimbursements', {
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_brand_id: brandId,
      }),
      supabase.rpc('ca_backfill_reimbursements_razorpay', {
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_brand_id: brandId,
      }),
    ])

    if (posResult.error && rzResult.error) {
      return NextResponse.json({ error: posResult.error.message }, { status: 400 })
    }

    const posRow = Array.isArray(posResult.data) ? posResult.data[0] : posResult.data
    const rzRow = Array.isArray(rzResult.data) ? rzResult.data[0] : rzResult.data
    const processed = (posRow?.processed ?? 0) + (rzRow?.processed ?? 0)
    const skipped = (posRow?.skipped ?? 0) + (rzRow?.skipped ?? 0)

    return NextResponse.json({
      success: true,
      processed,
      skipped,
      message: processed > 0
        ? `Generated ${processed} reimbursement invoice(s)${skipped ? `, skipped ${skipped}` : ''}.`
        : 'No unprocessed transactions found for the selected range.',
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
