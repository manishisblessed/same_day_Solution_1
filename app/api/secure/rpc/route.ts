import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback, AuthNetworkError } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
import { executeSecureRpc } from '@/lib/secure-query-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const access = authorizeSubPartner(user)
    if (!access.ok) return access.response

    const body = await request.json()
    const fn = body?.fn
    const args = body?.args || {}
    if (!fn || typeof fn !== 'string') {
      return NextResponse.json({ error: 'fn required' }, { status: 400 })
    }

    const result = await executeSecureRpc(user, fn, args)
    return NextResponse.json(result)
  } catch (err: any) {
    if (err instanceof AuthNetworkError) {
      return NextResponse.json({ error: 'Auth service temporarily unavailable' }, { status: 503 })
    }
    console.error('[secure/rpc]', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
