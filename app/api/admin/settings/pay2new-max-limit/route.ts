import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/security/admin-guard'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { PAY2NEW_MAX_SETTING_KEY, PAY2NEW_DEFAULT_MAX } from '@/lib/txn-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIN_LIMIT = 50_000
const MAX_LIMIT = 10_000_000

export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin(request)
    if (!guard.ok) return guard.response

    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('portal_settings')
      .select('active_provider, updated_by, updated_at')
      .eq('service_key', PAY2NEW_MAX_SETTING_KEY)
      .single()

    const limit = data?.active_provider ? parseInt(data.active_provider, 10) : PAY2NEW_DEFAULT_MAX

    return NextResponse.json({
      success: true,
      limit: isNaN(limit) ? PAY2NEW_DEFAULT_MAX : limit,
      updated_by: data?.updated_by || null,
      updated_at: data?.updated_at || null,
    })
  } catch (err: any) {
    console.error('[Pay2New Max Limit] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin(request)
    if (!guard.ok) return guard.response

    const { limit } = await request.json()
    const parsed = parseInt(limit, 10)

    if (isNaN(parsed) || parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
      return NextResponse.json(
        { error: `Limit must be between ₹${MIN_LIMIT.toLocaleString('en-IN')} and ₹${MAX_LIMIT.toLocaleString('en-IN')}` },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()
    const adminEmail = guard.user.email || 'admin'

    const { data: current } = await supabase
      .from('portal_settings')
      .select('active_provider')
      .eq('service_key', PAY2NEW_MAX_SETTING_KEY)
      .single()

    const oldValue = current?.active_provider || String(PAY2NEW_DEFAULT_MAX)

    const { error } = await supabase
      .from('portal_settings')
      .upsert({
        service_key: PAY2NEW_MAX_SETTING_KEY,
        enabled: true,
        active_provider: String(parsed),
        updated_by: adminEmail,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'service_key' })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await supabase.from('portal_audit_log').insert({
      service_key: PAY2NEW_MAX_SETTING_KEY,
      action: `Pay2New/CC max transaction limit changed from ₹${parseInt(oldValue).toLocaleString('en-IN')} to ₹${parsed.toLocaleString('en-IN')}`,
      old_value: oldValue,
      new_value: String(parsed),
      performed_by: adminEmail,
    })

    return NextResponse.json({ success: true, limit: parsed })
  } catch (err: any) {
    console.error('[Pay2New Max Limit] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
