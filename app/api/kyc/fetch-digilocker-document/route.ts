import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner, normalizeMasterPartner } from '@/lib/partner-access'
import { upsertKycVerification } from '@/lib/kyc/store'
import { getDigilockerDocument, generateOrderId } from '@/services/ekyc'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const access = authorizeSubPartner(user, 'aeps')
    if (!access.ok) return access.response

    const allowedRoles = ['admin', 'master_distributor', 'distributor', 'retailer', 'partner']
    if (!allowedRoles.includes(user.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { verification_id, reference_id, document_type } = body

    if (!verification_id) {
      return NextResponse.json({ error: 'verification_id is required' }, { status: 400 })
    }

    const orderid = generateOrderId('DIGI_FETCH')
    const result = await getDigilockerDocument(
      verification_id,
      reference_id || verification_id,
      orderid,
      document_type || 'AADHAAR'
    )

    console.log('[Fetch Digilocker Doc] Result:', JSON.stringify(result))

    if (result.status === 'Failure') {
      return NextResponse.json({
        success: false,
        error: result.message || 'Failed to fetch document from Digilocker',
      })
    }

    // Persist trusted Aadhaar name for server-side name-match at onboarding.
    if (user.partner_id && result.name) {
      await upsertKycVerification(user.partner_id, {
        aadhaar_name: result.name,
        aadhaar_verification_id: verification_id,
        aadhaar_verified_at: new Date().toISOString(),
      })
    }

    // Derive city + pincode from the structured Aadhaar address (fallback: parse).
    const sa = (result as any).split_address || {}
    const city = sa.vtc || sa.subdist || sa.dist || sa.state || ''
    const pincode =
      (sa.pincode ? String(sa.pincode).replace(/\D/g, '').slice(0, 6) : '') ||
      (result.address ? (String(result.address).match(/\b(\d{6})\b/)?.[1] || '') : '')

    return NextResponse.json({
      success: true,
      data: {
        name: result.name || '',
        uid: result.uid || '',
        dob: result.dob || '',
        gender: result.gender || '',
        address: result.address || '',
        care_of: result.care_of || '',
        city,
        pincode,
        state: sa.state || '',
        verification_id,
      },
    })
  } catch (error: any) {
    console.error('[Fetch Digilocker Doc] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch Digilocker document' },
      { status: 500 }
    )
  }
}
