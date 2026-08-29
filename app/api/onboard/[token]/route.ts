import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, getVerifications } from '@/lib/onboarding/invites'
import { needsUplineApproval, roleLabel } from '@/lib/hierarchy'
import { ONBOARD_DOCUMENTS, SELF_DECLARATION_TYPE } from '@/lib/onboarding/requiredDocuments'

export const dynamic = 'force-dynamic'

/**
 * GET /api/onboard/[token]
 * Public: load the invite metadata + verification progress for the wizard.
 * Sensitive inviter data is not exposed beyond display name/role.
 */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = getSupabaseAdmin()
    const { invite, error } = await loadInviteByToken(supabase, params.token)

    if (error || !invite) {
      return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })
    }

    if (invite.status === 'approved') {
      return NextResponse.json(
        { error: 'This onboarding is already complete.', status: invite.status },
        { status: 410 }
      )
    }
    if (invite.status === 'rejected') {
      return NextResponse.json(
        { error: 'This onboarding was rejected. Please contact your upline.', status: invite.status },
        { status: 410 }
      )
    }
    if (invite.status === 'expired') {
      return NextResponse.json(
        { error: 'This onboarding link has expired. Please request a new one.', status: invite.status },
        { status: 410 }
      )
    }

    const verifications = await getVerifications(supabase, invite.id)

    // Best-effort prefill for the final "Personal details" step, derived from the
    // verified KYC data (PAN name + Aadhaar/DigiLocker address) so the applicant
    // only has to set a password.
    const byType = new Map(verifications.map((v) => [v.type, v]))
    const pan = byType.get('PAN_360')?.response_payload as any
    const aadhaar = byType.get('AADHAAR_DIGILOCKER')?.response_payload as any
    const bank = byType.get('BANK_PENNY_DROP')?.response_payload as any
    const split = (aadhaar?.split_address || {}) as any

    let addressStr = ''
    if (typeof aadhaar?.address === 'string') {
      addressStr = aadhaar.address
    } else if (split && Object.keys(split).length) {
      addressStr = [split.house, split.street, split.landmark, split.po, split.subdist]
        .filter(Boolean)
        .join(', ')
    }
    let pincode = split.pincode || ''
    if (!pincode && addressStr) {
      const m = addressStr.match(/\b(\d{6})\b/)
      if (m) pincode = m[1]
    }

    const prefill = {
      name:
        invite.name ||
        pan?.registered_name ||
        aadhaar?.name ||
        bank?.nameAtBank ||
        '',
      email: invite.email,
      phone: invite.phone,
      address: addressStr,
      city: split.vtc || split.dist || split.subdist || '',
      state: split.state || aadhaar?.state || '',
      pincode,
    }

    return NextResponse.json({
      success: true,
      invite: {
        id: invite.id,
        phone: invite.phone,
        email: invite.email,
        name: invite.name,
        target_role: invite.target_role,
        target_role_label: roleLabel(invite.target_role),
        status: invite.status,
        phone_verified_at: invite.phone_verified_at,
        email_verified_at: invite.email_verified_at,
        aadhaar_verified_at: invite.aadhaar_verified_at,
        invited_by_name: invite.invited_by_name,
        invited_by_role: invite.invited_by_role,
        expires_at: invite.expires_at,
      },
      prefill,
      requiresUplineApproval: needsUplineApproval(invite.invited_by_role),
      documents: ONBOARD_DOCUMENTS,
      selfDeclarationType: SELF_DECLARATION_TYPE,
      verifications: verifications.map((v) => ({
        type: v.type,
        status: v.status,
        verified_name: v.verified_name,
        ...(v.type === 'GST' ? { gstin: (v.response_payload as any)?.GSTIN || null } : {}),
      })),
    })
  } catch (error: any) {
    console.error('[onboard GET] error:', error)
    return NextResponse.json({ error: error.message || 'Failed to load invite' }, { status: 500 })
  }
}
