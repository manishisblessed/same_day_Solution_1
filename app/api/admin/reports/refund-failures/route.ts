import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/reports/refund-failures
 *
 * Surfaces transactions where the status was flipped to failed/refunded but the
 * wallet refund did NOT complete (stamped with [CRITICAL: REFUND_FAILED]).
 * Powers the admin critical-alerts banner. Admin / finance only.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    if (!isAdminOrFinance(admin)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const MARKER = 'REFUND_FAILED'

    const [payoutRes, bbpsRes] = await Promise.all([
      supabase
        .from('payout_transactions')
        .select('id, retailer_id, client_ref_id, amount, charges, status, failure_reason, created_at, updated_at')
        .ilike('failure_reason', `%${MARKER}%`)
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('bbps_transactions')
        .select('id, retailer_id, agent_transaction_id, bill_amount, retailer_charge, status, error_message, created_at')
        .ilike('error_message', `%${MARKER}%`)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    const alerts: any[] = []

    if (payoutRes.data) {
      for (const t of payoutRes.data) {
        alerts.push({
          id: t.id,
          service_type: 'Settlement',
          retailer_id: t.retailer_id,
          reference: t.client_ref_id,
          amount: (parseFloat(String(t.amount || 0)) + parseFloat(String(t.charges || 0))),
          status: t.status,
          detail: t.failure_reason,
          created_at: t.created_at,
        })
      }
    }

    if (bbpsRes.data) {
      for (const t of bbpsRes.data) {
        alerts.push({
          id: t.id,
          service_type: 'BBPS',
          retailer_id: t.retailer_id,
          reference: t.agent_transaction_id,
          amount: (parseFloat(String(t.bill_amount || 0)) + parseFloat(String(t.retailer_charge || 0))),
          status: t.status,
          detail: t.error_message,
          created_at: t.created_at,
        })
      }
    }

    // Newest first
    alerts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({
      success: true,
      count: alerts.length,
      total_amount: alerts.reduce((s, a) => s + a.amount, 0),
      alerts,
    })
  } catch (err: any) {
    console.error('[Refund Failures] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
