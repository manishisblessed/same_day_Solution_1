import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/ca/reimbursement/by-company
 *
 * Per-brand live summary for the CA dashboard: today + month-to-date transaction
 * count, value, bank MDR, and projected service charge + GST (using each brand's
 * company config). Powered by the ca_company_live_summary() DB function.
 */
export async function GET(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ca_executive' && user.role !== 'admin') {
    return NextResponse.json({ error: 'CA access required' }, { status: 403 })
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.rpc('ca_company_live_summary')
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const companies = (data || []).map((r: any) => ({
      brand_id: r.brand_id,
      brand_name: r.brand_name,
      brand_short: r.brand_short,
      today_count: Number(r.today_count || 0),
      today_txn_value: Number(r.today_txn_value || 0),
      today_bank_mdr: Number(r.today_bank_mdr || 0),
      month_count: Number(r.month_count || 0),
      month_txn_value: Number(r.month_txn_value || 0),
      month_bank_mdr: Number(r.month_bank_mdr || 0),
      margin_percent: Number(r.margin_percent || 0),
      gst_percent: Number(r.gst_percent || 0),
      month_service_charge: Number(r.month_service_charge || 0),
      month_gst: Number(r.month_gst || 0),
    }))

    // Totals across all companies
    const totals = companies.reduce(
      (acc: any, c: any) => ({
        today_count: acc.today_count + c.today_count,
        today_bank_mdr: acc.today_bank_mdr + c.today_bank_mdr,
        month_count: acc.month_count + c.month_count,
        month_txn_value: acc.month_txn_value + c.month_txn_value,
        month_bank_mdr: acc.month_bank_mdr + c.month_bank_mdr,
        month_gst: acc.month_gst + c.month_gst,
      }),
      { today_count: 0, today_bank_mdr: 0, month_count: 0, month_txn_value: 0, month_bank_mdr: 0, month_gst: 0 }
    )

    return NextResponse.json({ success: true, companies, totals })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
