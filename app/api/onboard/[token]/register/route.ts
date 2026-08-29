import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import {
  loadInviteByToken,
  INVITE_TABLE,
  VERIFICATION_TABLE,
  getVerifications,
} from '@/lib/onboarding/invites'
import { needsUplineApproval } from '@/lib/hierarchy'
import { getRequiredDocTypes, docLabel } from '@/lib/onboarding/requiredDocuments'
import { namesMatch } from '@/lib/onboarding/nameMatch'

export const dynamic = 'force-dynamic'

const ROLE_TABLE: Record<string, string> = {
  master_distributor: 'master_distributors',
  distributor: 'distributors',
  retailer: 'retailers',
  partner: 'partners',
  master_partner: 'partners',
}
const ROLE_PREFIX: Record<string, string> = {
  master_distributor: 'MD',
  distributor: 'DIS',
  retailer: 'RET',
}

// partner / master_partner live in the `partners` table, which keys on a UUID
// `id` (no string partner_id column) and needs is_master_partner set.
function isPartnersRole(role: string): boolean {
  return role === 'partner' || role === 'master_partner'
}

function partnerIdFor(role: string): string {
  return `${ROLE_PREFIX[role] || 'PTR'}${Date.now().toString().slice(-8)}`
}

/**
 * POST /api/onboard/[token]/register
 * Final wizard step. Re-enforces every client gate server-side, then creates a
 * Supabase Auth user + inserts the partner row into the correct role table with
 * parent FKs and status 'pending_verification'.
 *
 * Body: { password, name, address, city, state, pincode, shopName? }
 */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = getSupabaseAdmin()
    const { invite, error } = await loadInviteByToken(supabase, params.token)
    if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })

    if (!['pending', 'registered', 'resubmit'].includes(invite.status)) {
      return NextResponse.json({ error: `Cannot register from "${invite.status}" state` }, { status: 410 })
    }
    if (invite.created_partner_id) {
      return NextResponse.json({ error: 'This onboarding was already submitted' }, { status: 409 })
    }

    // ── Contact verification pre-gate ──
    if (!invite.phone_verified_at) {
      return NextResponse.json({ error: 'Phone number is not verified' }, { status: 400 })
    }
    if (!invite.email_verified_at) {
      return NextResponse.json({ error: 'Email is not verified' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const password = String(body.password || '')
    const name = String(body.name || invite.name || '').trim()
    const address = String(body.address || '').trim()
    const city = String(body.city || '').trim()
    const state = String(body.state || '').trim()
    const pincode = String(body.pincode || '').trim()

    // ── Basic field validation ──
    if (name.length < 2) return NextResponse.json({ error: 'Full name is required' }, { status: 400 })
    if (!/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,20}$/.test(password)) {
      return NextResponse.json(
        { error: 'Password must be 8-20 chars with a letter, a number and a special character' },
        { status: 400 }
      )
    }
    if (pincode && !/^\d{6}$/.test(pincode)) {
      return NextResponse.json({ error: 'Pincode must be 6 digits' }, { status: 400 })
    }

    // ── Verification gate ──
    const verifications = await getVerifications(supabase, invite.id)
    const byType = new Map(verifications.map((v) => [v.type, v]))
    const has = (type: string, status = 'Success') => byType.get(type)?.status === status

    const gateErrors: string[] = []
    if (!has('PAN_360')) gateErrors.push('PAN verification is incomplete')
    if (!has('AADHAAR_DIGILOCKER')) gateErrors.push('Aadhaar verification is incomplete')
    if (!has('BANK_PENNY_DROP')) gateErrors.push('Bank verification is incomplete')
    if (!has('DOCUMENT_SELFIE', 'Uploaded')) gateErrors.push('Live selfie is missing')
    if (!has('ONBOARD_VIDEO', 'Uploaded')) gateErrors.push('Liveness video is missing')

    for (const docType of getRequiredDocTypes(invite.target_role)) {
      if (!has(`DOCUMENT_${docType}`, 'Uploaded')) {
        gateErrors.push(`${docLabel(docType)} is missing`)
      }
    }
    if (!has('SELF_DECLARATION', 'Uploaded')) {
      gateErrors.push('Signed self-declaration is missing')
    }

    // ── Name consistency gate (Aadhaar==PAN, Bank matches Aadhaar/PAN/GST) ──
    const aadhaarName = byType.get('AADHAAR_DIGILOCKER')?.verified_name || null
    const panName = byType.get('PAN_360')?.verified_name || null
    const bankName = byType.get('BANK_PENNY_DROP')?.verified_name || null
    const gstName = byType.get('GST')?.verified_name || null
    if (aadhaarName && panName && !namesMatch(aadhaarName, panName).match) {
      gateErrors.push(`Aadhaar name (${aadhaarName}) and PAN name (${panName}) do not match — they must be the same person`)
    }
    if (bankName) {
      const cands = [aadhaarName, panName, gstName].filter(Boolean) as string[]
      if (cands.length && !cands.some((c) => namesMatch(c, bankName).match)) {
        gateErrors.push(`Bank account holder name (${bankName}) does not match your Aadhaar/PAN${gstName ? '/GST' : ''} name`)
      }
    }

    // ── Upline approval gate ──
    if (needsUplineApproval(invite.invited_by_role)) {
      const { data: appr } = await supabase
        .from('declaration_approvals')
        .select('status')
        .eq('invite_id', invite.id)
        .order('created_at', { ascending: false })
        .limit(1)
      const status = appr?.[0]?.status
      if (!status) gateErrors.push('Your upline approval has not been requested yet')
      else if (status !== 'approved') gateErrors.push(`Your upline approval is ${status}`)
    }

    if (gateErrors.length > 0) {
      return NextResponse.json({ error: 'Onboarding is incomplete', gateErrors }, { status: 400 })
    }

    // ── Extract verified KYC data ──
    const pan = byType.get('PAN_360')?.response_payload as any
    const aadhaar = byType.get('AADHAAR_DIGILOCKER')?.response_payload as any
    const bank = byType.get('BANK_PENNY_DROP')?.response_payload as any
    const gst = byType.get('GST')?.response_payload as any
    const shopName = String(body.shopName || byType.get('BUSINESS_NAME')?.verified_name || '').trim()

    // ── Duplicate identity guard across role tables ──
    const roleTables = ['retailers', 'distributors', 'master_distributors', 'partners'] as const
    for (const table of roleTables) {
      if (pan?.pan) {
        const { data: dupPan } = await supabase.from(table).select('id').eq('pan_number', pan.pan).limit(1)
        if (dupPan && dupPan.length > 0) {
          return NextResponse.json({ error: 'This PAN is already registered' }, { status: 409 })
        }
      }
    }

    // ── Create Supabase Auth user ──
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
    })
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    // ── Build partner row ──
    const table = ROLE_TABLE[invite.target_role]
    const partnersTable = isPartnersRole(invite.target_role)
    // Network roles use a human string partner_id; the partners table uses a
    // DB-generated UUID id, so we leave partner_id off and read id back post-insert.
    const partnerId = partnersTable ? '' : partnerIdFor(invite.target_role)
    const now = new Date().toISOString()

    const row: Record<string, any> = {
      partner_id: partnerId,
      name,
      email: invite.email,
      phone: invite.phone,
      business_name: shopName || null,
      address: address || null,
      city: city || null,
      state: state || aadhaar?.state || null,
      pincode: pincode || null,
      gst_number: gst?.GSTIN || null,
      status: 'pending_verification',
      verification_status: 'pending',
      // Parent linkage
      master_distributor_id: invite.parent_master_distributor_id || null,
      distributor_id: invite.parent_distributor_id || null,
      // PAN
      pan_number: pan?.pan || null,
      pan_verified: has('PAN_360'),
      pan_registered_name: pan?.registered_name || null,
      pan_type: pan?.type || null,
      pan_verified_at: has('PAN_360') ? now : null,
      // Aadhaar
      aadhar_number: aadhaar?.uid || null,
      aadhaar_verified: has('AADHAAR_DIGILOCKER'),
      aadhaar_name: aadhaar?.name || null,
      aadhaar_dob: aadhaar?.dob || null,
      aadhaar_gender: aadhaar?.gender || null,
      aadhaar_address: aadhaar?.address || null,
      aadhaar_uid: aadhaar?.uid || null,
      // Bank
      account_number: bank?.account_number || null,
      ifsc_code: bank?.ifsc || null,
      bank_verified: has('BANK_PENNY_DROP'),
      bank_verified_name: bank?.nameAtBank || null,
      bank_utr: bank?.utr || null,
      // GST
      gst_verified: has('GST'),
      gst_legal_name: gst?.legal_name_of_business || null,
      gst_trade_name: gst?.trade_name_of_business || null,
      gst_status: gst?.gst_in_status || null,
      auto_verification_score:
        (has('PAN_360') ? 40 : 0) + (has('BANK_PENNY_DROP') ? 40 : 0) + (has('GST') ? 20 : 0),
    }

    // distributors/master_distributors don't have distributor_id column.
    if (invite.target_role !== 'retailer') delete row.distributor_id
    if (invite.target_role === 'master_distributor') delete row.master_distributor_id

    // partners table: UUID id (drop the empty partner_id), no MD/DT parent
    // columns, business_name is NOT NULL, and a master partner flags itself.
    if (partnersTable) {
      delete row.partner_id
      delete row.master_distributor_id
      delete row.distributor_id
      row.business_name = row.business_name || name
      row.is_master_partner = invite.target_role === 'master_partner'
    }

    const { data: partner, error: insErr } = await supabase.from(table).insert([row]).select().single()
    if (insErr) {
      // Rollback the auth user.
      await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {})
      console.error('[onboard register] insert error:', insErr)
      return NextResponse.json(
        {
          error: insErr.message || 'Failed to create account',
          hint: insErr.message?.includes('does not exist')
            ? 'A required column is missing — ensure eKYC/document migrations are applied.'
            : undefined,
        },
        { status: 400 }
      )
    }

    // Network roles record the string partner_id; partners record the UUID id.
    const createdPartnerId = partnersTable ? partner.id : partnerId

    // ── Backfill invite + verifications ──
    const allVerified =
      has('PAN_360') && has('AADHAAR_DIGILOCKER') && has('BANK_PENNY_DROP') && has('DOCUMENT_SELFIE', 'Uploaded')
    const newStatus = allVerified ? 'verified' : 'registered'

    await supabase
      .from(INVITE_TABLE)
      .update({
        status: newStatus,
        registered_at: now,
        verified_at: allVerified ? now : null,
        created_partner_id: createdPartnerId,
        name,
        updated_at: now,
      })
      .eq('id', invite.id)

    await supabase
      .from(VERIFICATION_TABLE)
      .update({ created_partner_id: createdPartnerId })
      .eq('invite_id', invite.id)

    return NextResponse.json({
      success: true,
      status: newStatus,
      partner_id: createdPartnerId,
      message: 'Registration submitted. Your account is pending admin approval.',
    })
  } catch (error: any) {
    console.error('[onboard register] error:', error)
    return NextResponse.json({ error: error.message || 'Registration failed' }, { status: 500 })
  }
}
