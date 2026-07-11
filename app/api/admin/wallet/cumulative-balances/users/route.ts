import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

const ROLE_TABLES: Record<string, string> = {
  retailer: 'retailers',
  distributor: 'distributors',
  master_distributor: 'master_distributors',
}

type UserBalance = {
  user_id: string
  name: string | null
  business_name: string | null
  primary: number
  aeps: number
  api: number
  total: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * GET /api/admin/wallet/cumulative-balances/users?role=retailer|distributor|master_distributor|partner
 * Per-user wallet balances for a role (admin/finance only), sorted by total desc.
 * - retailer/distributor/master_distributor: primary + aeps from `wallets`
 * - partner: API wallet balance from `partner_wallets` (+ any primary/aeps rows in `wallets`)
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !isAdminOrFinance(user)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const role = request.nextUrl.searchParams.get('role') || 'retailer'
    if (!['retailer', 'distributor', 'master_distributor', 'partner'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const pageSize = 1000
    const byUser = new Map<string, UserBalance>()

    const getEntry = (id: string): UserBalance => {
      let e = byUser.get(id)
      if (!e) {
        e = { user_id: id, name: null, business_name: null, primary: 0, aeps: 0, api: 0, total: 0 }
        byUser.set(id, e)
      }
      return e
    }

    // Primary / AEPS wallets from `wallets` (all roles, including any partner rows)
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('wallets')
        .select('user_id, wallet_type, balance')
        .eq('user_role', role)
        .range(from, from + pageSize - 1)

      if (error) {
        console.error('[cumulative-balances/users] wallets', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      for (const w of data || []) {
        if (!w.user_id) continue
        const e = getEntry(w.user_id)
        const bal = Number(w.balance) || 0
        if (w.wallet_type === 'aeps') e.aeps += bal
        else e.primary += bal
      }

      if (!data || data.length < pageSize) break
    }

    // Partner API wallets (separate system)
    if (role === 'partner') {
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from('partner_wallets')
          .select('partner_id, balance')
          .range(from, from + pageSize - 1)

        if (error) {
          console.error('[cumulative-balances/users] partner_wallets', error)
          break
        }

        for (const w of data || []) {
          if (!w.partner_id) continue
          getEntry(w.partner_id).api += Number(w.balance) || 0
        }

        if (!data || data.length < pageSize) break
      }
    }

    // Resolve names
    const ids = [...byUser.keys()]
    const chunkSize = 200
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      if (role === 'partner') {
        const { data } = await supabase
          .from('partners')
          .select('id, name, business_name')
          .in('id', chunk)
        for (const p of data || []) {
          const e = byUser.get(p.id)
          if (e) {
            e.name = p.name || null
            e.business_name = p.business_name || null
          }
        }
      } else {
        const { data } = await supabase
          .from(ROLE_TABLES[role])
          .select('partner_id, name, business_name')
          .in('partner_id', chunk)
        for (const r of data || []) {
          const e = byUser.get(r.partner_id)
          if (e) {
            e.name = r.name || null
            e.business_name = r.business_name || null
          }
        }
      }
    }

    const users = [...byUser.values()]
      .map((e) => ({
        ...e,
        primary: round2(e.primary),
        aeps: round2(e.aeps),
        api: round2(e.api),
        total: round2(e.primary + e.aeps + e.api),
      }))
      .sort((a, b) => b.total - a.total)

    return NextResponse.json({
      success: true,
      role,
      users,
      totals: {
        primary: round2(users.reduce((s, u) => s + u.primary, 0)),
        aeps: round2(users.reduce((s, u) => s + u.aeps, 0)),
        api: round2(users.reduce((s, u) => s + u.api, 0)),
        total: round2(users.reduce((s, u) => s + u.total, 0)),
        user_count: users.length,
      },
      generated_at: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('[cumulative-balances/users]', e)
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
  }
}
