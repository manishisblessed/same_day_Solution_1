import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/distributor/subscriptions/retailer-machines?retailer_id=X
 * Returns POS machines assigned to a retailer (only if retailer is under this distributor).
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'distributor' || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const url = new URL(request.url)
    const retailerId = url.searchParams.get('retailer_id')?.trim()
    if (!retailerId) {
      return NextResponse.json({ error: 'retailer_id is required' }, { status: 400 })
    }

    const { data: retailer, error: retErr } = await supabaseAdmin
      .from('retailers')
      .select('partner_id, name, distributor_id')
      .eq('partner_id', retailerId)
      .single()

    if (retErr || !retailer || retailer.distributor_id !== user.partner_id) {
      return NextResponse.json({ error: 'Retailer not found or not under your network' }, { status: 403 })
    }

    const { data: machines, error } = await supabaseAdmin
      .from('pos_machines')
      .select('id, machine_id, serial_number, brand, machine_type, status, inventory_status, retailer_id, distributor_id, master_distributor_id')
      .eq('retailer_id', retailerId)
      .order('machine_id')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: existingSub } = await supabaseAdmin
      .from('subscriptions')
      .select('id, billing_day, monthly_amount, pos_machine_count, next_billing_date, auto_debit_enabled, status')
      .eq('user_id', retailerId)
      .eq('user_role', 'retailer')
      .maybeSingle()

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
        .eq('user_id', retailerId)
        .eq('is_active', true)
        .maybeSingle()
      existingRate = rate
    }

    return NextResponse.json({
      retailer: { partner_id: retailer.partner_id, name: retailer.name },
      machines: machines || [],
      existingSubscription: existingSub || null,
      existingRate,
      productId: posProduct?.id || null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
