import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/subscriptions/product-rates/[id]
 * Update rate_per_unit and/or gst_percent for a product rate. Admin only.
 * Also updates all subscription_items using this rate and recalculates subscription monthly_amount.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Rate id is required' }, { status: 400 })
    }

    const body = await request.json()
    const { rate_per_unit, gst_percent, md_commission_additional, distributor_commission_additional } = body

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (rate_per_unit != null) {
      const val = parseFloat(rate_per_unit)
      if (Number.isNaN(val) || val < 0) {
        return NextResponse.json({ error: 'rate_per_unit must be a non-negative number' }, { status: 400 })
      }
      updates.rate_per_unit = val
    }
    if (gst_percent != null) {
      const val = parseFloat(gst_percent)
      if (Number.isNaN(val) || val < 0 || val > 100) {
        return NextResponse.json({ error: 'gst_percent must be between 0 and 100' }, { status: 400 })
      }
      updates.gst_percent = val
    }
    if (md_commission_additional !== undefined) {
      updates.md_commission_additional = md_commission_additional == null || md_commission_additional === '' ? null : Math.max(0, parseFloat(md_commission_additional) || 0)
    }
    if (distributor_commission_additional !== undefined) {
      updates.distributor_commission_additional = distributor_commission_additional == null || distributor_commission_additional === '' ? null : Math.max(0, parseFloat(distributor_commission_additional) || 0)
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: 'Provide at least one field to update' }, { status: 400 })
    }

    // Fetch current rate row to get product_id, user_id, user_role (for propagating to subscription_items)
    const { data: existingRate, error: fetchErr } = await supabaseAdmin
      .from('subscription_product_rates')
      .select('product_id, user_id, user_role')
      .eq('id', id)
      .single()
    if (fetchErr || !existingRate) {
      return NextResponse.json({ error: fetchErr?.message || 'Rate not found' }, { status: 404 })
    }

    const existingRole = existingRate.user_role as string
    if (existingRole === 'master_distributor') {
      delete updates.md_commission_additional
      delete updates.distributor_commission_additional
    } else if (existingRole !== 'retailer') {
      delete updates.distributor_commission_additional
    }

    const { data, error } = await supabaseAdmin
      .from('subscription_product_rates')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const productId = existingRate.product_id
    const userId = existingRate.user_id
    const userRole = existingRate.user_role as string
    const newRate = updates.rate_per_unit != null ? Number(updates.rate_per_unit) : Number(data.rate_per_unit)
    const newGst = updates.gst_percent != null ? Number(updates.gst_percent) : Number(data.gst_percent) || 18

    // Propagate to subscription_items: update the rate column for this user's items
    const rateColumn = userRole === 'retailer' ? 'retailer_rate' : userRole === 'distributor' ? 'distributor_rate' : 'md_rate'
    let itemsToUpdate: { id: string; subscription_id: string }[] = []

    if (userRole === 'master_distributor') {
      const { data: items } = await supabaseAdmin
        .from('subscription_items')
        .select('id, subscription_id')
        .eq('product_id', productId)
        .eq('is_active', true)
        .eq('master_distributor_id', userId)
      itemsToUpdate = items || []
      if (itemsToUpdate.length > 0) {
        await supabaseAdmin
          .from('subscription_items')
          .update({ [rateColumn]: newRate, gst_percent: newGst, updated_at: new Date().toISOString() })
          .eq('product_id', productId)
          .eq('is_active', true)
          .eq('master_distributor_id', userId)
      }
    } else if (userRole === 'distributor') {
      const { data: items } = await supabaseAdmin
        .from('subscription_items')
        .select('id, subscription_id')
        .eq('product_id', productId)
        .eq('is_active', true)
        .eq('distributor_id', userId)
      itemsToUpdate = items || []
      if (itemsToUpdate.length > 0) {
        await supabaseAdmin
          .from('subscription_items')
          .update({ [rateColumn]: newRate, gst_percent: newGst, updated_at: new Date().toISOString() })
          .eq('product_id', productId)
          .eq('is_active', true)
          .eq('distributor_id', userId)
      }
    } else {
      const { data: retailerSubs } = await supabaseAdmin
        .from('subscriptions')
        .select('id')
        .eq('user_id', userId)
        .eq('user_role', 'retailer')
      const subIds = (retailerSubs || []).map((s: any) => s.id)
      if (subIds.length > 0) {
        const { data: items } = await supabaseAdmin
          .from('subscription_items')
          .select('id, subscription_id')
          .eq('product_id', productId)
          .eq('is_active', true)
          .in('subscription_id', subIds)
        itemsToUpdate = items || []
        if (itemsToUpdate.length > 0) {
          await supabaseAdmin
            .from('subscription_items')
            .update({ [rateColumn]: newRate, gst_percent: newGst, updated_at: new Date().toISOString() })
            .eq('product_id', productId)
            .eq('is_active', true)
            .in('subscription_id', subIds)
        }
      }
    }

    if (itemsToUpdate.length > 0) {
      const subIds = Array.from(new Set(itemsToUpdate.map((i) => i.subscription_id)))
      for (const subId of subIds) {
        const { data: allItems } = await supabaseAdmin
          .from('subscription_items')
          .select('retailer_rate, distributor_rate, md_rate, gst_percent')
          .eq('subscription_id', subId)
          .eq('is_active', true)
        const { data: sub } = await supabaseAdmin.from('subscriptions').select('user_role').eq('id', subId).single()
        let total = 0
        for (const it of allItems || []) {
          const rateForUser =
            sub?.user_role === 'retailer'
              ? Number(it.retailer_rate) || 0
              : sub?.user_role === 'distributor'
                ? Number(it.distributor_rate) || 0
                : Number(it.md_rate) || 0
          total += rateForUser + (rateForUser * (Number(it.gst_percent) || 18)) / 100
        }
        await supabaseAdmin
          .from('subscriptions')
          .update({
            monthly_amount: Math.round(total * 100) / 100,
            pos_machine_count: (allItems || []).length,
            updated_at: new Date().toISOString(),
          })
          .eq('id', subId)
      }
    }

    return NextResponse.json({ rate: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
