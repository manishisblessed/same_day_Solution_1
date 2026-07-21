import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getRechargekitBaseUrl, getRechargekitApiToken } from '@/services/rechargekit/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/rechargekit-balance
 * Fetches Rechargekit wallet balance for admin dashboard.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const base = getRechargekitBaseUrl().replace(/\/$/, '')
    const token = getRechargekitApiToken()

    if (!token) {
      return NextResponse.json({ success: false, error: 'Rechargekit API token not configured' }, { status: 500 })
    }

    const res = await fetch(`${base}/recharge/balanceCheck`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    })

    const data = await res.json()

    if (data.error !== 0 && data.error !== '0') {
      return NextResponse.json({
        success: false,
        error: data.msg || 'Failed to fetch Rechargekit balance',
        last_checked: new Date().toISOString(),
      })
    }

    return NextResponse.json({
      success: true,
      balance: data.wallet_amount ?? 0,
      dmr_balance: data.dmr_wallet_amount ?? 0,
      last_checked: new Date().toISOString(),
    })
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error?.message?.includes('timeout')
        ? 'Request timed out — Rechargekit server may be slow.'
        : error?.message || 'Failed to fetch Rechargekit balance',
      last_checked: new Date().toISOString(),
    }, { status: 500 })
  }
}
