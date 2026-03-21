import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const url = new URL(request.url)
    const subscriptionId = url.searchParams.get('subscription_id')
    const userId = url.searchParams.get('user_id')

    let query = supabaseAdmin
      .from('subscription_items')
      .select('*, subscription_products(name), subscriptions(user_id, user_role)')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (subscriptionId) query = query.eq('subscription_id', subscriptionId)
    if (userId) query = query.eq('subscriptions.user_id', userId)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ items: data || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * POST - Add a subscription item. Looks up rates from subscription_product_rates
 * for the retailer, distributor, and MD to bake the full rate chain into the item.
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const body = await request.json()
    const {
      subscription_id,
      product_id,
      reference_id,
      reference_type = 'pos_machine',
    } = body

    if (!subscription_id || !product_id) {
      return NextResponse.json({ error: 'subscription_id and product_id are required' }, { status: 400 })
    }

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id, user_role')
      .eq('id', subscription_id)
      .single()
    if (!sub) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })

    const { data: product } = await supabaseAdmin
      .from('subscription_products')
      .select('default_gst_percent')
      .eq('id', product_id)
      .single()
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const retailerId = sub.user_id
    let distributorId: string | null = null
    let mdId: string | null = null

    if (sub.user_role === 'retailer') {
      const { data: ret } = await supabaseAdmin
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', retailerId)
        .maybeSingle()
      distributorId = ret?.distributor_id || null
      mdId = ret?.master_distributor_id || null
    }

    const lookupRate = async (uid: string | null) => {
      if (!uid) return 0
      const { data } = await supabaseAdmin
        .from('subscription_product_rates')
        .select('rate_per_unit')
        .eq('product_id', product_id)
        .eq('user_id', uid)
        .eq('is_active', true)
        .maybeSingle()
      return Number(data?.rate_per_unit) || 0
    }

    const retailerRate = await lookupRate(retailerId)
    const distributorRate = await lookupRate(distributorId)
    const mdRate = await lookupRate(mdId)

    if (retailerRate <= 0) {
      return NextResponse.json(
        { error: `No active rate found for retailer ${retailerId}. Please assign a product rate first.` },
        { status: 400 }
      )
    }

    const { data: item, error } = await supabaseAdmin
      .from('subscription_items')
      .insert({
        subscription_id,
        product_id,
        reference_id: reference_id || null,
        reference_type,
        retailer_rate: retailerRate,
        distributor_rate: distributorRate,
        md_rate: mdRate,
        gst_percent: product.default_gst_percent,
        distributor_id: distributorId,
        master_distributor_id: mdId,
        is_active: true,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await recalcSubscriptionAmount(subscription_id)

    return NextResponse.json({ item })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

async function recalcSubscriptionAmount(subscriptionId: string) {
  const { data: items } = await supabaseAdmin
    .from('subscription_items')
    .select('retailer_rate, gst_percent')
    .eq('subscription_id', subscriptionId)
    .eq('is_active', true)

  let totalBase = 0
  let totalGst = 0
  for (const it of items || []) {
    const base = Number(it.retailer_rate) || 0
    const gst = base * (Number(it.gst_percent) || 18) / 100
    totalBase += base
    totalGst += gst
  }

  await supabaseAdmin
    .from('subscriptions')
    .update({
      monthly_amount: Math.round((totalBase + totalGst) * 100) / 100,
      pos_machine_count: (items || []).length,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId)
}
