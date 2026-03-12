import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'
import { verifyBankAccount } from '@/services/payout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function POST(request: NextRequest) {
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

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { accountNumber, ifscCode, bankName, bankId } = body
    if (!accountNumber || !ifscCode) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'accountNumber and ifscCode are required' } },
        { status: 400 }
      )
    }

    const normalizedAccount = accountNumber.toString().replace(/\s+/g, '').trim()
    const normalizedIfsc = ifscCode.toString().replace(/\s+/g, '').trim().toUpperCase()

    const result = await verifyBankAccount({
      accountNumber: normalizedAccount,
      ifscCode: normalizedIfsc,
      bankName: bankName?.trim() || undefined,
      bankId: bankId ? parseInt(bankId) : undefined,
    })

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_FAILED', message: result.error || 'Account validation failed' }, is_valid: false, verification_charges: 0 },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      is_valid: result.is_valid !== false,
      account_holder_name: result.account_holder_name || null,
      bank_name: result.bank_name,
      branch_name: result.branch_name,
      verification_charges: 0,
      message: result.message || 'Account verified successfully',
      reference_id: result.reference_id,
    })
  } catch (error: any) {
    console.error('[Partner Payout Verify] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
