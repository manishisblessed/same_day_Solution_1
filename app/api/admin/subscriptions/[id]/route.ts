import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const dynamic = 'force-dynamic'

/** PATCH - Update subscription (admin): auto_debit_enabled, status, plan_id, etc. */
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
      return NextResponse.json({ error: 'Subscription ID required' }, { status: 400 })
    }
    const body = await request.json()
    const updates: Record<string, unknown> = {}
    if (typeof body.auto_debit_enabled === 'boolean') updates.auto_debit_enabled = body.auto_debit_enabled
    if (body.status && ['active', 'paused', 'cancelled'].includes(body.status)) updates.status = body.status
    if (body.plan_id !== undefined) updates.plan_id = body.plan_id || null
    if (typeof body.pos_machine_count === 'number' && body.pos_machine_count >= 0) updates.pos_machine_count = body.pos_machine_count
    if (typeof body.monthly_amount === 'number' && body.monthly_amount >= 0) updates.monthly_amount = body.monthly_amount
    if (body.next_billing_date) updates.next_billing_date = body.next_billing_date
    if (typeof body.billing_day === 'number' && body.billing_day >= 1 && body.billing_day <= 28) updates.billing_day = body.billing_day
    updates.updated_at = new Date().toISOString()

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data: oldSub } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id, user_role, status, auto_debit_enabled, monthly_amount')
      .eq('id', id)
      .single()

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) {
      console.error('[Subscriptions PATCH]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const changedFields = Object.keys(updates).filter(k => k !== 'updated_at')
    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'admin_subscription_update',
      activity_category: 'subscription',
      activity_description: `Admin updated subscription for ${oldSub?.user_role || 'user'} ${oldSub?.user_id || id}: ${changedFields.join(', ')}`,
      reference_id: id,
      reference_table: 'subscriptions',
      status: 'success',
      metadata: { subscription_id: id, user_id: oldSub?.user_id, user_role: oldSub?.user_role, changed_fields: changedFields, old_values: oldSub, new_values: updates },
    }).catch(() => {})

    return NextResponse.json({ subscription: data })
  } catch (e: any) {
    console.error('[Subscriptions PATCH]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}

/** DELETE - Delete a subscription and all its items */
export async function DELETE(
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
      return NextResponse.json({ error: 'Subscription ID required' }, { status: 400 })
    }

    const { data: oldSub } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id, user_role, status, monthly_amount, pos_machine_count')
      .eq('id', id)
      .single()

    const { error: itemsErr } = await supabaseAdmin
      .from('subscription_items')
      .delete()
      .eq('subscription_id', id)

    if (itemsErr) {
      console.error('[Subscription DELETE items]', itemsErr)
    }

    const { error: subErr } = await supabaseAdmin
      .from('subscriptions')
      .delete()
      .eq('id', id)

    if (subErr) {
      console.error('[Subscription DELETE]', subErr)
      return NextResponse.json({ error: subErr.message }, { status: 500 })
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'admin_subscription_delete',
      activity_category: 'subscription',
      activity_description: `Admin deleted subscription for ${oldSub?.user_role || 'user'} ${oldSub?.user_id || id}: ₹${oldSub?.monthly_amount || 0}/mo, ${oldSub?.pos_machine_count || 0} machines`,
      reference_id: id,
      reference_table: 'subscriptions',
      status: 'success',
      metadata: { subscription_id: id, deleted_subscription: oldSub },
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('[Subscription DELETE]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
