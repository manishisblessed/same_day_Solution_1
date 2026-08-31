import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Read-only view of the MDR (Partner Plan) scheme resolved for each of a Master
 * Channel Partner's CHILD partners, including the master POS commission the
 * master earns on that scheme.
 *
 * Hard-scoped to partners whose master_partner_id = this master. For each child
 * we resolve the active MDR scheme exactly like settlement does
 * (resolve_scheme_for_user), then surface the Partner Plan rates that carry a
 * master_commission_percent. This is the ONLY place a master partner may see the
 * commission %/TDS configured on their children's plans.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'master_partner' || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const supabase = getSupabaseAdmin()
    const masterId = user.partner_id

    const { data: members, error: membersErr } = await supabase
      .from('partners')
      .select('id, name, business_name, email, phone, status')
      .eq('master_partner_id', masterId)
    if (membersErr) return NextResponse.json({ error: membersErr.message }, { status: 500 })

    const memberList = members || []
    if (memberList.length === 0) {
      return NextResponse.json({ success: true, data: { partners: [] } })
    }

    // Resolve the active MDR scheme for each child (same path as settlement).
    const resolved = await Promise.all(
      memberList.map(async (m: any) => {
        const { data } = await supabase.rpc('resolve_scheme_for_user', {
          p_user_id: m.id,
          p_user_role: 'partner',
          p_service_type: 'mdr',
          p_distributor_id: null,
          p_md_id: null,
        })
        const schemeId = data && data.length > 0 ? data[0].scheme_id : null
        return { partnerId: m.id, schemeId }
      })
    )

    const schemeIds = Array.from(new Set(resolved.map((r) => r.schemeId).filter(Boolean))) as string[]

    // Scheme metadata + the Partner Plan MDR rates that carry a master commission.
    const [schemesRes, ratesRes] = await Promise.all([
      schemeIds.length > 0
        ? supabase.from('schemes').select('id, name, scheme_type, is_partner_plan, status').in('id', schemeIds)
        : Promise.resolve({ data: [], error: null } as any),
      schemeIds.length > 0
        ? supabase
            .from('scheme_mdr_rates')
            .select('scheme_id, mode, card_type, merchant_slug, partner_mdr, master_commission_percent, master_commission_tds_percent, status')
            .in('scheme_id', schemeIds)
            .eq('status', 'active')
            .not('master_commission_percent', 'is', null)
        : Promise.resolve({ data: [], error: null } as any),
    ])

    if (schemesRes.error) return NextResponse.json({ error: schemesRes.error.message }, { status: 500 })
    if (ratesRes.error) return NextResponse.json({ error: ratesRes.error.message }, { status: 500 })

    const schemeById = new Map((schemesRes.data || []).map((s: any) => [s.id, s]))
    const ratesByScheme = new Map<string, any[]>()
    for (const r of ratesRes.data || []) {
      const list = ratesByScheme.get(r.scheme_id) || []
      list.push({
        mode: r.mode,
        card_type: r.card_type,
        merchant_slug: r.merchant_slug,
        partner_mdr: r.partner_mdr != null ? Number(r.partner_mdr) : null,
        master_commission_percent: Number(r.master_commission_percent) || 0,
        master_commission_tds_percent: r.master_commission_tds_percent != null ? Number(r.master_commission_tds_percent) : 2,
      })
      ratesByScheme.set(r.scheme_id, list)
    }

    const partners = memberList.map((m: any) => {
      const link = resolved.find((r) => r.partnerId === m.id)
      const scheme = link?.schemeId ? schemeById.get(link.schemeId) : null
      const rates = link?.schemeId ? ratesByScheme.get(link.schemeId) || [] : []
      return {
        partner_id: m.id,
        name: m.business_name || m.name,
        email: m.email,
        phone: m.phone,
        status: m.status,
        scheme: scheme
          ? { id: scheme.id, name: scheme.name, is_partner_plan: scheme.is_partner_plan, status: scheme.status }
          : null,
        commissionRates: rates,
      }
    })

    return NextResponse.json({ success: true, data: { partners } })
  } catch (err: any) {
    console.error('[MCP Schemes] GET error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
