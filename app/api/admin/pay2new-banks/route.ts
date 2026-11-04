/**
 * GET  /api/admin/pay2new-banks          → list all CC billers from DB
 * POST /api/admin/pay2new-banks          → { action: 'toggle', product_code, enabled }
 *                                           { action: 'refresh' }  — sync from Pay2New API
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/security/admin-guard'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getAllCcBillers } from '@/lib/pay2new/cc-billers'
import { getPay2NewCreditCardBillers } from '@/services/pay2new'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── GET — list all billers ──────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin(request)
    if (!guard.ok) return guard.response

    const billers = await getAllCcBillers()
    const enabled = billers.filter((b) => b.enabled).length

    return NextResponse.json({
      success: true,
      billers,
      stats: { total: billers.length, enabled, disabled: billers.length - enabled },
    })
  } catch (err: any) {
    console.error('[Pay2New Banks] GET error:', err)
    return NextResponse.json({ error: err.message || 'Failed to load' }, { status: 500 })
  }
}

// ─── POST — toggle or refresh ────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin(request)
    if (!guard.ok) return guard.response

    const adminEmail = guard.user.email || 'admin'
    const body = await request.json()
    const { action } = body

    if (action === 'toggle') {
      const { product_code, enabled } = body
      if (!product_code || typeof enabled !== 'boolean') {
        return NextResponse.json({ error: 'product_code and enabled are required' }, { status: 400 })
      }

      const supabase = getSupabaseAdmin()
      const { error } = await supabase
        .from('pay2new_cc_billers')
        .update({ enabled, updated_by: adminEmail, updated_at: new Date().toISOString() })
        .eq('product_code', product_code)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      // Audit log
      await supabase.from('portal_audit_log').insert({
        service_key: 'pay2new_cc_billers',
        action: `Pay2New CC bank ${product_code} ${enabled ? 'ENABLED' : 'DISABLED'}`,
        old_value: String(!enabled),
        new_value: String(enabled),
        performed_by: adminEmail,
      }).throwOnError().then(() => {}).catch(() => {})

      return NextResponse.json({ success: true, product_code, enabled })
    }

    if (action === 'refresh') {
      const supabase = getSupabaseAdmin()

      // Fetch all CC billers from Pay2New
      const result = await getPay2NewCreditCardBillers()
      if (!result.success || !result.billers) {
        return NextResponse.json({ error: result.error || 'Failed to fetch from Pay2New' }, { status: 502 })
      }

      const remoteBillers = result.billers

      // Load existing enabled states so we can preserve them on upsert
      const { data: existing } = await supabase
        .from('pay2new_cc_billers')
        .select('product_code, enabled')

      const existingMap = new Map<string, boolean>(
        (existing || []).map((r: any) => [r.product_code, r.enabled])
      )

      const rows = remoteBillers.map((b) => ({
        product_code: b.product_code,
        product_name: b.product_name,
        service_id: String(b.service_id),
        // Preserve existing enabled state; brand-new banks default to FALSE
        enabled: existingMap.has(b.product_code) ? existingMap.get(b.product_code)! : false,
        updated_by: adminEmail,
        updated_at: new Date().toISOString(),
      }))

      const { error } = await supabase
        .from('pay2new_cc_billers')
        .upsert(rows, { onConflict: 'product_code' })

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await supabase.from('portal_audit_log').insert({
        service_key: 'pay2new_cc_billers',
        action: `Pay2New CC bank list refreshed from API — ${rows.length} billers synced`,
        new_value: String(rows.length),
        performed_by: adminEmail,
      }).throwOnError().then(() => {}).catch(() => {})

      const billers = await getAllCcBillers()
      const enabled = billers.filter((b) => b.enabled).length

      return NextResponse.json({
        success: true,
        synced: rows.length,
        billers,
        stats: { total: billers.length, enabled, disabled: billers.length - enabled },
      })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    console.error('[Pay2New Banks] POST error:', err)
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 })
  }
}
