import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

async function requireAdmin(request: NextRequest) {
  const { user: admin } = await getCurrentUserWithFallback(request)
  if (!admin) return { error: 'Session expired', status: 401 }
  if (admin.role !== 'admin') return { error: 'Admin access required', status: 403 }
  return { admin }
}

/**
 * GET /api/admin/portal-settings
 * Returns all portal service settings + audit logs
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request)
    if ('error' in auth) {
      return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
    }

    const supabase = getSupabaseAdmin()

    const { data: rows, error } = await supabase
      .from('portal_settings')
      .select('*')
      .order('service_key')

    if (error) {
      console.error('[Portal Settings] DB error:', error)
      return addCorsHeaders(request, NextResponse.json({ success: false, error: error.message }, { status: 500 }))
    }

    const settings: Record<string, any> = {}
    let masterSwitch = true

    for (const row of rows || []) {
      if (row.service_key === '__master__') {
        masterSwitch = row.enabled
        continue
      }
      settings[row.service_key] = {
        enabled: row.enabled,
        active_provider: row.active_provider,
        updated_at: row.updated_at,
        updated_by: row.updated_by,
      }
    }

    const { data: logs } = await supabase
      .from('portal_audit_log')
      .select('*')
      .order('performed_at', { ascending: false })
      .limit(50)

    return addCorsHeaders(request, NextResponse.json({
      success: true,
      settings,
      master_switch: masterSwitch,
      audit_logs: logs || [],
    }))
  } catch (err: any) {
    console.error('[Portal Settings] Error:', err)
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}

/**
 * POST /api/admin/portal-settings
 * Update a service setting (toggle on/off, switch provider, master switch)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request)
    if ('error' in auth) {
      return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
    }

    const body = await request.json()
    const supabase = getSupabaseAdmin()
    const adminEmail = auth.admin.email || 'admin'

    // Master switch
    if (body.master_switch !== undefined) {
      const { error } = await supabase
        .from('portal_settings')
        .upsert({
          service_key: '__master__',
          enabled: body.master_switch,
          active_provider: 'system',
          updated_by: adminEmail,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'service_key' })

      if (error) {
        return addCorsHeaders(request, NextResponse.json({ success: false, error: error.message }, { status: 500 }))
      }

      await supabase.from('portal_audit_log').insert({
        service_key: '__master__',
        action: body.master_switch ? 'Master switch ENABLED' : 'Master switch DISABLED',
        old_value: String(!body.master_switch),
        new_value: String(body.master_switch),
        performed_by: adminEmail,
      })

      return addCorsHeaders(request, NextResponse.json({ success: true }))
    }

    // Service toggle or provider switch
    const { service_key, enabled, active_provider } = body
    if (!service_key) {
      return addCorsHeaders(request, NextResponse.json({ error: 'service_key required' }, { status: 400 }))
    }

    // Get current state
    const { data: current } = await supabase
      .from('portal_settings')
      .select('*')
      .eq('service_key', service_key)
      .single()

    const updateData: any = {
      service_key,
      updated_by: adminEmail,
      updated_at: new Date().toISOString(),
    }

    if (enabled !== undefined) updateData.enabled = enabled
    if (active_provider !== undefined) updateData.active_provider = active_provider

    // Keep existing values for fields not being updated
    if (current) {
      if (enabled === undefined) updateData.enabled = current.enabled
      if (active_provider === undefined) updateData.active_provider = current.active_provider
    }

    const { error } = await supabase
      .from('portal_settings')
      .upsert(updateData, { onConflict: 'service_key' })

    if (error) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: error.message }, { status: 500 }))
    }

    // Audit log
    const action = enabled !== undefined
      ? `Service ${enabled ? 'ENABLED' : 'DISABLED'}`
      : `Provider switched to ${active_provider}`

    await supabase.from('portal_audit_log').insert({
      service_key,
      action,
      old_value: current ? (enabled !== undefined ? String(current.enabled) : current.active_provider) : '',
      new_value: enabled !== undefined ? String(enabled) : active_provider || '',
      performed_by: adminEmail,
    })

    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    console.error('[Portal Settings] POST error:', err)
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}
