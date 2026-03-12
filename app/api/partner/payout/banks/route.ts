import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'
import { getBankList } from '@/services/payout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const e = error as PartnerAuthError
      return NextResponse.json(
        { success: false, error: { code: e.code, message: e.message } },
        { status: e.status }
      )
    }

    const { partner } = authResult
    if (!partner.permissions.includes('payout') && !partner.permissions.includes('all')) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Missing required permission: payout' } },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const result = await getBankList({
      impsOnly: searchParams.get('imps') === 'true',
      neftOnly: searchParams.get('neft') === 'true',
      popularOnly: searchParams.get('popular') === 'true',
      searchQuery: searchParams.get('search') || undefined,
      useCache: true,
    })

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: result.error || 'Failed to fetch bank list' } },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      banks: result.banks || [],
      total: result.total || 0,
      imps_enabled: result.imps_enabled || 0,
      neft_enabled: result.neft_enabled || 0,
    })
  } catch (error: any) {
    console.error('[Partner Payout Banks] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
