import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_SERVICES = [
  'banking_payments', 'mini_atm_pos', 'aeps', 'aadhaar_pay', 'dmt',
  'bbps', 'recharge', 'travel', 'cash_management', 'lic', 'insurance'
] as const

type ServiceType = typeof VALID_SERVICES[number]

function getFieldName(serviceType: ServiceType): string {
  return `${serviceType}_enabled`
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Services Toggle] Auth:', method, '|', admin?.email || 'none')

    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { user_id, user_role, service_type, enabled } = body

    if (!user_id || !user_role || !service_type || enabled === undefined) {
      return NextResponse.json({ error: 'user_id, user_role, service_type, and enabled are required' }, { status: 400 })
    }

    if (!['retailer', 'distributor', 'master_distributor'].includes(user_role)) {
      return NextResponse.json({ error: 'Invalid user_role' }, { status: 400 })
    }

    if (!VALID_SERVICES.includes(service_type)) {
      return NextResponse.json({ error: `Invalid service_type. Must be one of: ${VALID_SERVICES.join(', ')}` }, { status: 400 })
    }

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

    const tableName = user_role === 'retailer' ? 'retailers' :
                     user_role === 'distributor' ? 'distributors' : 'master_distributors'
    const fieldName = getFieldName(service_type)

    const { data: user, error: fetchError } = await supabase
      .from(tableName)
      .select('*')
      .eq('partner_id', user_id)
      .single()

    if (fetchError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const currentStatus = (user as any)[fieldName] as boolean | null

    const { error: updateError } = await supabase
      .from(tableName)
      .update({ [fieldName]: enabled, updated_at: new Date().toISOString() })
      .eq('partner_id', user_id)

    if (updateError) {
      console.error('Error updating service status:', updateError)
      return NextResponse.json({ error: 'Failed to update service status' }, { status: 500 })
    }

    const { data: walletBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user_id,
      p_wallet_type: 'primary'
    })

    await supabase.from('admin_audit_log').insert({
      admin_id: admin.id,
      action_type: enabled ? `${service_type}_enable` : `${service_type}_disable`,
      target_user_id: user_id,
      target_user_role: user_role,
      wallet_type: 'primary',
      before_balance: walletBalance || 0,
      after_balance: walletBalance || 0,
      ip_address: ipAddress,
      user_agent: request.headers.get('user-agent') || 'unknown',
      remarks: `${service_type.toUpperCase()} ${enabled ? 'enabled' : 'disabled'} for user`,
      metadata: {
        service_type,
        previous_status: currentStatus,
        new_status: enabled,
        user_name: (user as any).name,
        user_email: (user as any).email
      }
    })

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, admin, {
      activity_type: 'admin_service_toggle',
      activity_category: 'admin',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: `${service_type.replace(/_/g, ' ').toUpperCase()} ${enabled ? 'enabled' : 'disabled'} successfully`,
      service_type,
      enabled,
      previous_status: currentStatus
    })
  } catch (error: any) {
    console.error('Error toggling service:', error)
    return NextResponse.json({ error: 'Failed to toggle service' }, { status: 500 })
  }
}
