import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_SERVICES = [
  'banking_payments', 'mini_atm_pos', 'aeps', 'aadhaar_pay', 'dmt',
  'bbps', 'recharge', 'travel', 'cash_management', 'lic', 'insurance'
] as const

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Bulk Services Toggle] Auth:', method, '|', admin?.email || 'none')

    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { users, service_type, enabled } = body

    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: 'users array is required and must not be empty' }, { status: 400 })
    }
    if (!VALID_SERVICES.includes(service_type)) {
      return NextResponse.json({ error: `Invalid service_type. Must be one of: ${VALID_SERVICES.join(', ')}` }, { status: 400 })
    }
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }

    const fieldName = `${service_type}_enabled`
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

    const results: { user_id: string; user_role: string; success: boolean; error?: string }[] = []

    for (const u of users) {
      const { user_id, user_role } = u
      if (!user_id || !['retailer', 'distributor', 'master_distributor'].includes(user_role)) {
        results.push({ user_id, user_role, success: false, error: 'Invalid user_id or user_role' })
        continue
      }

      const tableName = user_role === 'retailer' ? 'retailers' :
                         user_role === 'distributor' ? 'distributors' : 'master_distributors'

      const { error: updateError } = await supabase
        .from(tableName)
        .update({ [fieldName]: enabled, updated_at: new Date().toISOString() })
        .eq('partner_id', user_id)

      if (updateError) {
        results.push({ user_id, user_role, success: false, error: updateError.message })
        continue
      }

      results.push({ user_id, user_role, success: true })
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length
    const serviceLabel = service_type.replace(/_/g, ' ').toUpperCase()

    await supabase.from('admin_audit_log').insert({
      admin_id: admin.id,
      action_type: `bulk_${service_type}_${enabled ? 'enable' : 'disable'}`,
      target_user_id: users[0]?.user_id || 'bulk',
      target_user_role: 'bulk',
      wallet_type: 'primary',
      before_balance: 0,
      after_balance: 0,
      ip_address: ipAddress,
      user_agent: request.headers.get('user-agent') || 'unknown',
      remarks: `Bulk ${serviceLabel} ${enabled ? 'enabled' : 'disabled'} for ${successCount} users (${failCount} failed)`,
      metadata: { service_type, enabled, total: users.length, success: successCount, failed: failCount }
    })

    return NextResponse.json({
      success: true,
      message: `${serviceLabel} ${enabled ? 'enabled' : 'disabled'} for ${successCount}/${users.length} users`,
      results,
      summary: { total: users.length, success: successCount, failed: failCount }
    })
  } catch (error: any) {
    console.error('Error in bulk service toggle:', error)
    return NextResponse.json({ error: 'Failed to bulk toggle services' }, { status: 500 })
  }
}
