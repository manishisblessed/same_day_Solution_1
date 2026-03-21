import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/master-distributor/subscriptions/distributor-machines?distributor_id=X
 * Returns POS machines assigned to a distributor (only if distributor is under this MD).
 * Also returns existing subscription and rate for that distributor.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'master_distributor' || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const url = new URL(request.url)
    const distributorId = url.searchParams.get('distributor_id')?.trim()
    if (!distributorId) {
      return NextResponse.json({ error: 'distributor_id is required' }, { status: 400 })
    }

    // Ensure this distributor belongs to this MD
    const { data: dist, error: distErr } = await supabaseAdmin
      .from('distributors')
      .select('partner_id, name, master_distributor_id')
      .eq('partner_id', distributorId)
      .single()

    if (distErr || !dist || dist.master_distributor_id !== user.partner_id) {
      return NextResponse.json({ error: 'Distributor not found or not under your network' }, { status: 403 })
    }

    // Get POS machines where distributor_id = distributorId
    const { data: machines, error } = await supabaseAdmin
      .from('pos_machines')
      .select('id, machine_id, serial_number, brand, machine_type, status, inventory_status, retailer_id, distributor_id, master_distributor_id')
      .eq('distributor_id', distributorId)
      .order('machine_id')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Existing subscription for this distributor
    const { data: existingSub } = await supabaseAdmin
      .from('subscriptions')
      .select('id, billing_day, monthly_amount, pos_machine_count, next_billing_date, auto_debit_enabled, status')
      .eq('user_id', distributorId)
      .eq('user_role', 'distributor')
      .maybeSingle()

    // Existing rate for POS Machine product
    const { data: posProduct } = await supabaseAdmin
      .from('subscription_products')
      .select('id')
      .eq('name', 'POS Machine')
      .eq('is_active', true)
      .maybeSingle()

    let existingRate = null
    if (posProduct) {
      const { data: rate } = await supabaseAdmin
        .from('subscription_product_rates')
        .select('rate_per_unit, gst_percent')
        .eq('product_id', posProduct.id)
        .eq('user_id', distributorId)
        .eq('is_active', true)
        .maybeSingle()
      existingRate = rate
    }

    return NextResponse.json({
      distributor: { partner_id: dist.partner_id, name: dist.name },
      machines: machines || [],
      existingSubscription: existingSub || null,
      existingRate,
      productId: posProduct?.id || null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
