import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback, AuthNetworkError } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
import { executeSecureQuery, SecureQueryBody } from '@/lib/secure-query-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Normalize sub_partner → partner for ownership (wallet/ledger shared with parent)
    const access = authorizeSubPartner(user)
    if (!access.ok) return access.response

    const body = (await request.json()) as SecureQueryBody
    const result = await executeSecureQuery(user, body)
    if ('status' in result && result.status) {
      return NextResponse.json({ error: result.error, data: null }, { status: result.status })
    }
    return NextResponse.json({
      data: result.data ?? null,
      error: result.error ?? null,
      count: result.count ?? null,
    })
  } catch (err: any) {
    if (err instanceof AuthNetworkError) {
      return NextResponse.json({ error: 'Auth service temporarily unavailable' }, { status: 503 })
    }
    console.error('[secure/query]', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
