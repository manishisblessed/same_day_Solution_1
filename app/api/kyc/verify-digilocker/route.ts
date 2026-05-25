import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createDigilockerURL, generateOrderId } from '@/services/ekyc'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const allowedRoles = ['admin', 'master_distributor', 'distributor', 'retailer']
    if (!allowedRoles.includes(user.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { type, redirect_url } = body

    if (!type || !['aadhaar', 'pan'].includes(type)) {
      return NextResponse.json(
        { error: 'Document type required: "aadhaar" or "pan"' },
        { status: 400 }
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://www.samedaysolution.in'
    const callbackUrl = redirect_url || `${appUrl}/api/kyc/digilocker-callback`

    console.log('[KYC Digilocker] Using callback URL:', callbackUrl)

    const orderid = generateOrderId('DIGI')
    const result = await createDigilockerURL(type, callbackUrl, orderid)

    console.log('[KYC Digilocker] Full response:', JSON.stringify(result))

    if (result.status === 'Failure' || (!result.url && !result.verification_id)) {
      return NextResponse.json({
        success: false,
        error: result.message || 'Digilocker URL is not created',
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        verification_id: result.verification_id,
        reference_id: result.reference_id,
        url: result.url,
        document_requested: result.document_requested,
        user_flow: result.user_flow,
        message: result.message,
        txid: result.txid,
        code: result.code,
        type: result.type,
      },
      orderid,
    })
  } catch (error: any) {
    console.error('[KYC Digilocker] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Digilocker verification failed' },
      { status: 500 }
    )
  }
}
