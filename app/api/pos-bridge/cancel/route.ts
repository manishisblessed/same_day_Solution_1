import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { ezetapCancel } from '@/lib/ezetap/client'
import { getEzetapCredentials } from '@/lib/ezetap/config'
import { retailerOwnsDevice, serialFromDeviceId } from '@/lib/pos-bridge/device-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/pos-bridge/cancel
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'admin' && user.role !== 'retailer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const merchant_slug = String(body.merchant_slug || '').toLowerCase().trim()
    const origP2pRequestId = String(body.origP2pRequestId || '').trim()

    if (!merchant_slug || !origP2pRequestId) {
      return NextResponse.json(
        { error: 'merchant_slug and origP2pRequestId are required' },
        { status: 400 }
      )
    }

    try {
      getEzetapCredentials(merchant_slug)
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Credentials not configured' }, { status: 400 })
    }

    if (user.role === 'retailer') {
      if (!user.partner_id) {
        return NextResponse.json({ error: 'Account misconfigured' }, { status: 400 })
      }
      const serial = serialFromDeviceId(String(body.device_id || body.device_serial || ''))
      if (!serial) {
        return NextResponse.json({ error: 'device_serial or device_id required' }, { status: 400 })
      }
      const supabase = getSupabaseAdmin()
      const ok = await retailerOwnsDevice(supabase, user.partner_id, serial)
      if (!ok) {
        return NextResponse.json({ error: 'Device not assigned to your account' }, { status: 403 })
      }
    }

    const result = await ezetapCancel(
      merchant_slug,
      origP2pRequestId,
      body.device_serial,
      body.device_id
    )

    return NextResponse.json({
      success: result.ok,
      status: result.status,
      data: result.data,
    })
  } catch (e: any) {
    console.error('[pos-bridge/cancel]', e)
    return NextResponse.json({ error: e?.message || 'Cancel request failed' }, { status: 500 })
  }
}
