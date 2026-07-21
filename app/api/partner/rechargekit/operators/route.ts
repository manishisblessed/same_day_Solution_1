import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { getRechargekitCcOperators } from '@/services/rechargekit'

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
    const access = partnerCanUseApi(partner, 'rechargekit')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'SERVICE_NOT_ENABLED', message: access.message } },
        { status: 403 }
      )
    }

    const result = await getRechargekitCcOperators()

    if (!result.success || !result.operators) {
      return NextResponse.json(
        { success: false, error: { code: 'PROVIDER_ERROR', message: result.error || 'Failed to fetch operators' } },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      operators: result.operators.map((op) => ({
        operator_id: op.operator_id,
        operator_name: op.operator_name,
        operator_code: op.operator_code || op.operator_id,
      })),
      count: result.operators.length,
    })
  } catch (error: any) {
    console.error('[Partner Rechargekit Operators] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch operators' } },
      { status: 500 }
    )
  }
}
