import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/** GET - List all subscription plans (admin) */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const { data, error } = await supabaseAdmin
      .from('subscription_plans')
      .select('*')
      .order('name')
    if (error) {
      console.error('[Subscriptions Plans]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ plans: data || [] })
  } catch (e: any) {
    console.error('[Subscriptions Plans GET]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}

/** POST - Create subscription plan (admin) */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const body = await request.json()
    const {
      name,
      description,
      monthly_rental_per_machine,
      other_charges = 0,
      billing_cycle_day = 1,
      is_active = true,
    } = body
    if (!name || monthly_rental_per_machine == null) {
      return NextResponse.json(
        { error: 'name and monthly_rental_per_machine are required' },
        { status: 400 }
      )
    }
    const { data, error } = await supabaseAdmin
      .from('subscription_plans')
      .insert({
        name,
        description: description || null,
        monthly_rental_per_machine: parseFloat(monthly_rental_per_machine),
        other_charges: parseFloat(other_charges) || 0,
        billing_cycle_day: Math.min(28, Math.max(1, parseInt(String(billing_cycle_day), 10) || 1)),
        is_active: !!is_active,
      })
      .select()
      .single()
    if (error) {
      console.error('[Subscriptions Plans POST]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ plan: data })
  } catch (e: any) {
    console.error('[Subscriptions Plans POST]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
