import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/security/admin-guard'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import {
  ACCOUNT_VERIFICATION_SETTING_KEY,
  clearAccountVerificationCache,
} from '@/lib/settings/account-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin(request)
    if (!guard.ok) return guard.response

    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('portal_settings')
      .select('enabled, updated_by, updated_at')
      .eq('service_key', ACCOUNT_VERIFICATION_SETTING_KEY)
      .maybeSingle()

    return NextResponse.json({
      success: true,
      enabled: data ? data.enabled !== false : true,
      updated_by: data?.updated_by || null,
      updated_at: data?.updated_at || null,
    })
  } catch (err: any) {
    console.error('[Account Verification Setting] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin(request)
    if (!guard.ok) return guard.response

    const { enabled } = await request.json()
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const adminEmail = guard.user.email || 'admin'

    const { data: current } = await supabase
      .from('portal_settings')
      .select('enabled')
      .eq('service_key', ACCOUNT_VERIFICATION_SETTING_KEY)
      .maybeSingle()

    const oldValue = current ? current.enabled !== false : true

    const { error } = await supabase
      .from('portal_settings')
      .upsert({
        service_key: ACCOUNT_VERIFICATION_SETTING_KEY,
        enabled,
        updated_by: adminEmail,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'service_key' })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await supabase.from('portal_audit_log').insert({
      service_key: ACCOUNT_VERIFICATION_SETTING_KEY,
      action: `Account verification ${enabled ? 'ENABLED' : 'DISABLED'} (was ${oldValue ? 'enabled' : 'disabled'})`,
      old_value: String(oldValue),
      new_value: String(enabled),
      performed_by: adminEmail,
    })

    clearAccountVerificationCache()

    return NextResponse.json({ success: true, enabled })
  } catch (err: any) {
    console.error('[Account Verification Setting] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
