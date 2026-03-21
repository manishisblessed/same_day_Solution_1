import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/subscriptions/user-machines?user_id=X&role=Y
 * Returns POS machines assigned to a user based on their role in the hierarchy.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const url = new URL(request.url)
    const userId = url.searchParams.get('user_id')?.trim()
    const role = url.searchParams.get('role')?.trim()

    if (!userId || !role) {
      return NextResponse.json({ error: 'user_id and role are required' }, { status: 400 })
    }

    const roleColumnMap: Record<string, string> = {
      partner: 'partner_id',
      master_distributor: 'master_distributor_id',
      distributor: 'distributor_id',
      retailer: 'retailer_id',
    }
    const column = roleColumnMap[role]
    if (!column) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const { data: machines, error } = await supabaseAdmin
      .from('pos_machines')
      .select('id, machine_id, serial_number, brand, machine_type, status, inventory_status, retailer_id, distributor_id, master_distributor_id')
      .eq(column, userId)
      .order('machine_id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Also check if a subscription already exists for this user + role
    const { data: existingSub } = await supabaseAdmin
      .from('subscriptions')
      .select('id, billing_day, monthly_amount, pos_machine_count, next_billing_date, auto_debit_enabled, status')
      .eq('user_id', userId)
      .eq('user_role', role)
      .maybeSingle()

    // Check existing rate for POS Machine product
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
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle()
      existingRate = rate
    }

    return NextResponse.json({
      machines: machines || [],
      existingSubscription: existingSub || null,
      existingRate,
      productId: posProduct?.id || null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
