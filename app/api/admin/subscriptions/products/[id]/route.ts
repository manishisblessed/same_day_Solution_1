import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/subscriptions/products/[id]
 * Update product (e.g. is_active for enable/disable). Admin only.
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
    if (!id) return NextResponse.json({ error: 'Product id required' }, { status: 400 })

    const body = await request.json()
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.is_active === 'boolean') updates.is_active = body.is_active
    if (body.name !== undefined) updates.name = String(body.name)
    if (body.default_gst_percent != null) updates.default_gst_percent = parseFloat(body.default_gst_percent)

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: 'Provide is_active, name, or default_gst_percent to update' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('subscription_products')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ product: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/subscriptions/products/[id]
 * Permanently delete a product. Cascades to subscription_product_rates and subscription_items. Admin only.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await getCurrentUserWithFallback(_request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Product id required' }, { status: 400 })

    const { error } = await supabaseAdmin
      .from('subscription_products')
      .delete()
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
