import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

export type UserSearchResult = {
  id: string
  name: string
  business_name: string | null
  role: 'retailer' | 'distributor' | 'master_distributor' | 'partner'
  status: string | null
}

/**
 * GET /api/admin/users/search?q=<text>&roles=retailer,distributor,...
 * Search users across all hierarchy tables by id, name, business name, email or phone.
 * Admin/finance only. Returns up to 8 matches per role.
 * Pass all=1 (with roles) to list every user of the role(s) without a query.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !isAdminOrFinance(user)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const q = (sp.get('q') || '').trim()
    const listAll = sp.get('all') === '1'
    if (!listAll && q.length < 2) {
      return NextResponse.json({ results: [] })
    }
    const rolesParam = (sp.get('roles') || '').trim()
    const roles = rolesParam
      ? rolesParam.split(',').map((r) => r.trim()).filter(Boolean)
      : ['retailer', 'distributor', 'master_distributor', 'partner']

    const supabase = getSupabaseAdmin()
    const like = `%${q.replace(/%/g, '\\%')}%`
    const perRole = listAll ? 500 : 8

    const searches: Promise<UserSearchResult[]>[] = []

    const hierarchySearch = async (
      table: 'retailers' | 'distributors' | 'master_distributors',
      role: UserSearchResult['role']
    ): Promise<UserSearchResult[]> => {
      let query = supabase
        .from(table)
        .select('partner_id, name, business_name, email, phone, status')
      if (!listAll) {
        query = query.or(
          `partner_id.ilike.${like},name.ilike.${like},business_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`
        )
      }
      const { data } = await query.order('name', { ascending: true }).limit(perRole)
      return (data || []).map((r: any) => ({
        id: r.partner_id,
        name: r.name || r.business_name || r.partner_id,
        business_name: r.business_name || null,
        role,
        status: r.status || null,
      }))
    }

    if (roles.includes('retailer')) searches.push(hierarchySearch('retailers', 'retailer'))
    if (roles.includes('distributor')) searches.push(hierarchySearch('distributors', 'distributor'))
    if (roles.includes('master_distributor'))
      searches.push(hierarchySearch('master_distributors', 'master_distributor'))

    if (roles.includes('partner')) {
      searches.push(
        (async (): Promise<UserSearchResult[]> => {
          // partners.id is a uuid — ilike doesn't work on it, so match exact id separately
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)
          const orFilter = isUuid
            ? `id.eq.${q},name.ilike.${like},business_name.ilike.${like},email.ilike.${like}`
            : `name.ilike.${like},business_name.ilike.${like},email.ilike.${like}`
          let query = supabase
            .from('partners')
            .select('id, name, business_name, email, status')
          if (!listAll) {
            query = query.or(orFilter)
          }
          const { data } = await query.order('name', { ascending: true }).limit(perRole)
          return (data || []).map((p: any) => ({
            id: p.id,
            name: p.name || p.business_name || p.id,
            business_name: p.business_name || null,
            role: 'partner' as const,
            status: p.status || null,
          }))
        })()
      )
    }

    const settled = await Promise.allSettled(searches)
    const results = settled
      .filter((s): s is PromiseFulfilledResult<UserSearchResult[]> => s.status === 'fulfilled')
      .flatMap((s) => s.value)

    return NextResponse.json({ results })
  } catch (e: any) {
    console.error('[admin/users/search]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
