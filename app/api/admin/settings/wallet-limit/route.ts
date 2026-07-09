import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/security/admin-guard'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SETTING_KEY = 'wallet_op_max_amount'
const DEFAULT_LIMIT = 500_000

export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin(request)
    if (!guard.ok) return guard.response

    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('portal_settings')
      .select('active_provider, updated_by, updated_at')
      .eq('service_key', SETTING_KEY)
      .single()

    const limit = data?.active_provider ? parseInt(data.active_provider, 10) : DEFAULT_LIMIT

    return NextResponse.json({
      success: true,
      limit: isNaN(limit) ? DEFAULT_LIMIT : limit,
      updated_by: data?.updated_by || null,
      updated_at: data?.updated_at || null,
    })
  } catch (err: any) {
    console.error('[Wallet Limit] GET error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin(request)
    if (!guard.ok) return guard.response

    const { limit } = await request.json()
    const parsed = parseInt(limit, 10)

    if (isNaN(parsed) || parsed < 1_000 || parsed > 100_000_000) {
      return NextResponse.json(
        { error: 'Limit must be between ₹1,000 and ₹10,00,00,000' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()
    const adminEmail = guard.user.email || 'admin'

    const { data: current } = await supabase
      .from('portal_settings')
      .select('active_provider')
      .eq('service_key', SETTING_KEY)
      .single()

    const oldValue = current?.active_provider || String(DEFAULT_LIMIT)

    const { error } = await supabase
      .from('portal_settings')
      .upsert({
        service_key: SETTING_KEY,
        enabled: true,
        active_provider: String(parsed),
        updated_by: adminEmail,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'service_key' })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await supabase.from('portal_audit_log').insert({
      service_key: SETTING_KEY,
      action: `Wallet push/pull limit changed from ₹${parseInt(oldValue).toLocaleString('en-IN')} to ₹${parsed.toLocaleString('en-IN')}`,
      old_value: oldValue,
      new_value: String(parsed),
      performed_by: adminEmail,
    })

    return NextResponse.json({ success: true, limit: parsed })
  } catch (err: any) {
    console.error('[Wallet Limit] POST error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
