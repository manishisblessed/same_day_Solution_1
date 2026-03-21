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
    const productId = url.searchParams.get('product_id')
    const userId = url.searchParams.get('user_id')

    let query = supabaseAdmin
      .from('subscription_product_rates')
      .select('*, subscription_products(name)')
      .order('user_role')
      .order('user_id')

    if (productId) query = query.eq('product_id', productId)
    if (userId) query = query.eq('user_id', userId)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rates: data || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const body = await request.json()
    const {
      product_id,
      user_id,
      user_role,
      rate_per_unit,
      gst_percent = 18.0,
      md_commission_additional,
      distributor_commission_additional,
    } = body

    if (!product_id || !user_id || !user_role || rate_per_unit == null) {
      return NextResponse.json({ error: 'product_id, user_id, user_role, rate_per_unit are required' }, { status: 400 })
    }
    if (!['retailer', 'distributor', 'master_distributor'].includes(user_role)) {
      return NextResponse.json({ error: 'Invalid user_role' }, { status: 400 })
    }

    const row: Record<string, unknown> = {
      product_id,
      user_id,
      user_role,
      rate_per_unit: parseFloat(rate_per_unit),
      gst_percent: parseFloat(gst_percent) || 18.0,
      assigned_by: user.partner_id || user.id,
      assigned_by_role: 'admin',
      is_active: true,
      updated_at: new Date().toISOString(),
    }
    if (user_role === 'distributor' || user_role === 'retailer') {
      if (md_commission_additional != null) row.md_commission_additional = Math.max(0, parseFloat(md_commission_additional) || 0)
      else row.md_commission_additional = null
    }
    if (user_role === 'retailer') {
      if (distributor_commission_additional != null) row.distributor_commission_additional = Math.max(0, parseFloat(distributor_commission_additional) || 0)
      else row.distributor_commission_additional = null
    }

    const { data, error } = await supabaseAdmin
      .from('subscription_product_rates')
      .upsert(row, { onConflict: 'product_id,user_id' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rate: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
