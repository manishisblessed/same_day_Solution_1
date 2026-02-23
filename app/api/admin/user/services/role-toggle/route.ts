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
    console.log('[Role Services Toggle] Auth:', method, '|', admin?.email || 'none')

    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { user_role, service_type, enabled } = body

    if (!['retailer', 'distributor', 'master_distributor'].includes(user_role)) {
      return NextResponse.json({ error: 'user_role must be "retailer", "distributor", or "master_distributor"' }, { status: 400 })
    }
    if (!VALID_SERVICES.includes(service_type)) {
      return NextResponse.json({ error: `Invalid service_type. Must be one of: ${VALID_SERVICES.join(', ')}` }, { status: 400 })
    }
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }

    const tableName = user_role === 'retailer' ? 'retailers' :
                       user_role === 'distributor' ? 'distributors' : 'master_distributors'
    const fieldName = `${service_type}_enabled`
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

    const { data: allRows } = await supabase.from(tableName).select('partner_id')
    const totalInRole = allRows?.length ?? 0

    let updatedCount = 0
    const batchSize = 50
    const partnerIds = (allRows || []).map((r: any) => r.partner_id)

    for (let i = 0; i < partnerIds.length; i += batchSize) {
      const batch = partnerIds.slice(i, i + batchSize)
      const { error: batchError } = await supabase
        .from(tableName)
        .update({ [fieldName]: enabled, updated_at: new Date().toISOString() })
        .in('partner_id', batch)
      if (batchError) {
        console.error(`Batch update error for ${tableName}:`, batchError)
        continue
      }
      updatedCount += batch.length
    }

    if (updatedCount === 0 && totalInRole > 0) {
      return NextResponse.json({ error: 'Failed to update service status. Please run the service permissions migration first.' }, { status: 500 })
    }

    const roleLabel = user_role.replace('_', ' ')
    const serviceLabel = service_type.replace(/_/g, ' ').toUpperCase()

    await supabase.from('admin_audit_log').insert({
      admin_id: admin.id,
      action_type: `role_${service_type}_${enabled ? 'enable' : 'disable'}`,
      target_user_id: 'all_' + user_role,
      target_user_role: user_role,
      wallet_type: 'primary',
      before_balance: 0,
      after_balance: 0,
      ip_address: ipAddress,
      user_agent: request.headers.get('user-agent') || 'unknown',
      remarks: `${serviceLabel} ${enabled ? 'enabled' : 'disabled'} for all ${roleLabel}s (${updatedCount} updated out of ${totalInRole})`,
      metadata: { service_type, enabled, user_role, total_users: totalInRole, updated_users: updatedCount }
    })

    return NextResponse.json({
      success: true,
      message: `${serviceLabel} ${enabled ? 'enabled' : 'disabled'} for all ${roleLabel}s (${updatedCount} users updated)`,
      total_users: totalInRole,
      updated_users: updatedCount
    })
  } catch (error: any) {
    console.error('Error in role service toggle:', error)
    return NextResponse.json({ error: 'Failed to toggle service by role' }, { status: 500 })
  }
}
