import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, OPEN_INVITE_STATUSES, INVITE_TABLE, upsertVerification, getVerifications } from '@/lib/onboarding/invites'
import { namesMatch } from '@/lib/onboarding/nameMatch'
import {
  verifyPAN360,
  verifyBankPennyDrop,
  verifyGST,
  createDigilockerURL,
  getDigilockerDocument,
  generateOrderId,
} from '@/services/ekyc'

export const dynamic = 'force-dynamic'

/** Reference names already verified for this invite (for cross-checking). */
async function referenceNames(supabase: any, inviteId: string) {
  const rows = await getVerifications(supabase, inviteId)
  const pick = (type: string) => {
    const r = rows.find((v: any) => v.type === type && v.status === 'Success')
    return r?.verified_name || null
  }
  return {
    aadhaar: pick('AADHAAR_DIGILOCKER'),
    pan: pick('PAN_360'),
    bank: pick('BANK_PENNY_DROP'),
    gst: pick('GST'),
  }
}

/**
 * POST /api/onboard/[token]/verify
 * Public eKYC verification step. Discriminated on `type`:
 *   PAN_360           { pan }
 *   BANK_PENNY_DROP   { account_number, ifsc }
 *   GST               { gst }
 *   AADHAAR_INIT      { redirect_url }  -> returns DigiLocker URL
 *   AADHAAR_COMPLETE  { verification_id, reference_id } -> fetches Aadhaar doc
 *
 * Results are stored on onboarding_verifications keyed by invite_id.
 */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = getSupabaseAdmin()
    const { invite, error } = await loadInviteByToken(supabase, params.token)
    if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })
    if (!OPEN_INVITE_STATUSES.includes(invite.status)) {
      return NextResponse.json({ error: 'This invite is not active' }, { status: 410 })
    }

    const body = await request.json().catch(() => ({}))
    const type = String(body.type || '').trim()

    switch (type) {
      case 'PAN_360': {
        const pan = String(body.pan || '').toUpperCase().trim()
        if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) {
          return NextResponse.json({ error: 'Valid PAN required (e.g. ABCDE1234F)' }, { status: 400 })
        }
        const result = await verifyPAN360(pan, generateOrderId('PAN360'))
        let ok = result.status === 'Success'
        const panName = (result as any).registered_name || null

        // Cross-check: PAN name must match the Aadhaar name.
        let mismatch: string | null = null
        if (ok) {
          const ref = await referenceNames(supabase, invite.id)
          if (ref.aadhaar && panName && !namesMatch(ref.aadhaar, panName).match) {
            ok = false
            mismatch = `The name on this PAN (${panName}) does not match your Aadhaar name (${ref.aadhaar}). Please use your own PAN — the PAN and Aadhaar must belong to the same person.`
          }
        }

        const saved = await upsertVerification(supabase, {
          inviteId: invite.id,
          type: 'PAN_360',
          status: ok ? 'Success' : 'Failure',
          verifiedName: panName,
          payload: mismatch ? ({ ...(result as any), name_mismatch: true, mismatch_reason: mismatch } as any) : (result as any),
        })
        if (!saved.ok) return NextResponse.json({ error: `Could not save PAN result: ${saved.error}` }, { status: 500 })
        if (mismatch) return NextResponse.json({ success: false, error: mismatch })
        if (!ok) return NextResponse.json({ success: false, error: result.message || 'PAN verification failed' })
        return NextResponse.json({
          success: true,
          data: {
            pan: result.pan,
            registered_name: result.registered_name,
            type: result.type,
            date_of_birth: result.date_of_birth,
            gender: result.gender,
          },
        })
      }

      case 'BANK_PENNY_DROP': {
        const account_number = String(body.account_number || '').trim()
        const ifsc = String(body.ifsc || '').toUpperCase().trim()
        if (!account_number || !ifsc) {
          return NextResponse.json({ error: 'Account number and IFSC required' }, { status: 400 })
        }
        const result = await verifyBankPennyDrop(account_number, ifsc, generateOrderId('BANK'))
        let ok = result.status === 'Success'
        const bankName = (result as any).nameAtBank || null

        // Cross-check: account holder name must match the Aadhaar / PAN name,
        // or the GST business name when GST is already verified.
        let mismatch: string | null = null
        if (ok) {
          const ref = await referenceNames(supabase, invite.id)
          const candidates = [ref.aadhaar, ref.pan, ref.gst].filter(Boolean) as string[]
          if (candidates.length && bankName && !candidates.some((c) => namesMatch(c, bankName).match)) {
            ok = false
            const expected = [ref.aadhaar && `Aadhaar: ${ref.aadhaar}`, ref.pan && `PAN: ${ref.pan}`, ref.gst && `GST: ${ref.gst}`]
              .filter(Boolean)
              .join(', ')
            mismatch = `The account holder name (${bankName}) does not match your verified identity (${expected}). Use a bank account in your own name (or your verified GST business name).`
          }
        }

        const saved = await upsertVerification(supabase, {
          inviteId: invite.id,
          type: 'BANK_PENNY_DROP',
          status: ok ? 'Success' : 'Failure',
          verifiedName: bankName,
          payload: { ...result, account_number, ifsc, ...(mismatch ? { name_mismatch: true, mismatch_reason: mismatch } : {}) },
        })
        if (!saved.ok) return NextResponse.json({ error: `Could not save bank result: ${saved.error}` }, { status: 500 })
        if (mismatch) return NextResponse.json({ success: false, error: mismatch })
        if (!ok) return NextResponse.json({ success: false, error: result.message || 'Bank verification failed' })
        return NextResponse.json({
          success: true,
          data: { nameAtBank: result.nameAtBank, utr: result.utr },
        })
      }

      case 'GST': {
        const gst = String(body.gst || '').toUpperCase().trim()
        if (!gst) return NextResponse.json({ error: 'GSTIN required' }, { status: 400 })
        const result = await verifyGST(gst, generateOrderId('GST'))
        const ok = result.status === 'Success'
        const saved = await upsertVerification(supabase, {
          inviteId: invite.id,
          type: 'GST',
          status: ok ? 'Success' : 'Failure',
          verifiedName: (result as any).legal_name_of_business || null,
          payload: result as any,
        })
        if (!saved.ok) return NextResponse.json({ error: `Could not save GST result: ${saved.error}` }, { status: 500 })
        if (!ok) return NextResponse.json({ success: false, error: result.message || 'GST verification failed' })
        return NextResponse.json({
          success: true,
          data: {
            legal_name: result.legal_name_of_business,
            trade_name: result.trade_name_of_business,
            status: result.gst_in_status,
            address: result.principal_place_address,
          },
        })
      }

      case 'AADHAAR_INIT': {
        // eKYC Hub's WAF returns 403 for redirect URLs containing a nested
        // query string, so strip everything after "?" — the wizard restores
        // its token from localStorage when DigiLocker redirects back.
        const redirect_url = String(body.redirect_url || '').trim().split('?')[0]
        if (!redirect_url) return NextResponse.json({ error: 'redirect_url required' }, { status: 400 })
        const result = await createDigilockerURL('aadhaar', redirect_url, generateOrderId('DIGILOCKER'))
        const ok = result.status === 'Success' && !!result.url
        if (!ok) {
          console.error('[onboard verify] AADHAAR_INIT failed:', result)
          return NextResponse.json(
            { success: false, error: result.message || 'Could not start DigiLocker verification' },
            { status: 502 }
          )
        }
        await upsertVerification(supabase, {
          inviteId: invite.id,
          type: 'AADHAAR_DIGILOCKER_INIT',
          status: 'Pending',
          payload: {
            verification_id: result.verification_id,
            reference_id: result.reference_id,
          },
        })
        return NextResponse.json({
          success: true,
          url: result.url,
          verification_id: result.verification_id,
          reference_id: result.reference_id,
        })
      }

      case 'AADHAAR_COMPLETE': {
        const verification_id = String(body.verification_id || '').trim()
        const reference_id = String(body.reference_id || '').trim()
        if (!verification_id || !reference_id) {
          return NextResponse.json({ error: 'verification_id and reference_id required' }, { status: 400 })
        }
        const result = await getDigilockerDocument(
          verification_id,
          reference_id,
          generateOrderId('DIGILOCKER'),
          'AADHAAR'
        )
        let ok = result.status === 'Success'
        const aadhaarName = (result as any).name || null

        // Cross-check: if PAN was already verified (e.g. re-verifying Aadhaar),
        // the Aadhaar name must still match the PAN name.
        let mismatch: string | null = null
        if (ok) {
          const ref = await referenceNames(supabase, invite.id)
          if (ref.pan && aadhaarName && !namesMatch(ref.pan, aadhaarName).match) {
            ok = false
            mismatch = `This Aadhaar name (${aadhaarName}) does not match your verified PAN name (${ref.pan}). The Aadhaar and PAN must belong to the same person.`
          }
        }

        const saved = await upsertVerification(supabase, {
          inviteId: invite.id,
          type: 'AADHAAR_DIGILOCKER',
          status: ok ? 'Success' : 'Failure',
          verifiedName: aadhaarName,
          payload: mismatch ? ({ ...(result as any), name_mismatch: true, mismatch_reason: mismatch } as any) : (result as any),
        })
        if (!saved.ok) return NextResponse.json({ error: `Could not save Aadhaar result: ${saved.error}` }, { status: 500 })
        if (ok) {
          await supabase
            .from(INVITE_TABLE)
            .update({ aadhaar_verified_at: new Date().toISOString() })
            .eq('id', invite.id)
        }
        if (mismatch) return NextResponse.json({ success: false, error: mismatch })
        if (!ok) return NextResponse.json({ success: false, error: result.message || 'Aadhaar verification failed' })
        return NextResponse.json({
          success: true,
          data: {
            name: result.name,
            uid: result.uid,
            dob: result.dob,
            gender: result.gender,
            address: result.address,
          },
        })
      }

      default:
        return NextResponse.json({ error: `Unknown verification type: ${type}` }, { status: 400 })
    }
  } catch (error: any) {
    console.error('[onboard verify] error:', error)
    return NextResponse.json({ error: error.message || 'Verification failed' }, { status: 500 })
  }
}
