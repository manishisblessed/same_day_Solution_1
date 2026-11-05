import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, getVerifications, OPEN_INVITE_STATUSES } from '@/lib/onboarding/invites'
import { createSigningRequest } from '@/services/leegality/client'
import { getLeegalityWorkflowId } from '@/services/leegality/config'
import { generateMsaHtml, type MsaPrefillData } from '@/lib/onboarding/generate-msa-pdf'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboard/[token]/esign/initiate
 * Generates a prefilled MSA PDF from onboarding KYC data, sends it to
 * Leegality for eSigning, and returns the signUrl for the partner to sign.
 */
export async function POST(_request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = getSupabaseAdmin()
    const { invite, error } = await loadInviteByToken(supabase, params.token)
    if (error || !invite) {
      return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })
    }
    if (!OPEN_INVITE_STATUSES.includes(invite.status)) {
      return NextResponse.json({ error: 'This invite is not active' }, { status: 410 })
    }

    // Check if there's already an active esign for this invite
    const { data: existingDoc } = await supabase
      .from('esign_documents')
      .select('id, status')
      .eq('invite_id', invite.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingDoc) {
      if (existingDoc.status === 'COMPLETED') {
        return NextResponse.json({ error: 'Agreement already signed', alreadySigned: true }, { status: 400 })
      }
      // If still in progress, return the existing sign URL instead of creating a duplicate
      if (existingDoc.status === 'IN PROGRESS') {
        const { data: existingInvitee } = await supabase
          .from('esign_invitees')
          .select('sign_url')
          .eq('document_id', existingDoc.id)
          .eq('status', 'pending')
          .limit(1)
          .maybeSingle()

        if (existingInvitee?.sign_url) {
          return NextResponse.json({
            success: true,
            signUrl: existingInvitee.sign_url,
            existing: true,
          })
        }
      }
    }

    // Gather KYC data for prefilling
    const verifications = await getVerifications(supabase, invite.id)
    const byType = new Map(verifications.map((v) => [v.type, v]))
    const pan = byType.get('PAN_360')?.response_payload as any
    const aadhaar = byType.get('AADHAAR_DIGILOCKER')?.response_payload as any
    const bank = byType.get('BANK_PENNY_DROP')?.response_payload as any
    const gst = byType.get('GST')?.response_payload as any
    const businessName = byType.get('BUSINESS_NAME')?.verified_name
    const businessRole = (byType.get('BUSINESS_NAME')?.response_payload as any)?.role || ''
    const split = (aadhaar?.split_address || {}) as any

    let addressStr = ''
    if (typeof aadhaar?.address === 'string') {
      addressStr = aadhaar.address
    } else if (split && Object.keys(split).length) {
      addressStr = [split.house, split.street, split.landmark, split.po, split.subdist]
        .filter(Boolean)
        .join(', ')
    }

    const name = pan?.registered_name || invite.name || aadhaar?.name || bank?.nameAtBank || ''
    if (!name) {
      return NextResponse.json({ error: 'Partner name not available. Complete KYC first.' }, { status: 400 })
    }

    const prefill: MsaPrefillData = {
      name,
      phone: invite.phone,
      email: invite.email,
      targetRole: invite.target_role,
      pan: pan?.pan,
      aadhaarUid: aadhaar?.uid,
      bankAccountHolder: bank?.nameAtBank,
      businessName: gst?.legal_name_of_business || businessName,
      businessRole,
      gstin: gst?.GSTIN,
      address: addressStr,
      city: split?.vtc || split?.dist || '',
      state: split?.state || aadhaar?.state || '',
      pincode: split?.pincode || '',
      inviteId: invite.id,
    }

    // Generate the MSA HTML → PDF
    const msaHtml = generateMsaHtml(prefill)
    const pdfBuffer = await htmlToPdf(msaHtml, { format: 'A4', margin: '12mm' })
    if (!pdfBuffer) {
      return NextResponse.json({ error: 'Failed to generate agreement PDF' }, { status: 500 })
    }

    const fileBase64 = pdfBuffer.toString('base64')
    const irn = `SDS-MSA-${invite.id.substring(0, 8).toUpperCase()}-${Date.now()}`

    // Send to Leegality for eSigning
    const result = await createSigningRequest({
      profileId: getLeegalityWorkflowId(),
      invitees: [
        {
          name,
          email: invite.email || undefined,
          phone: invite.phone || undefined,
        },
      ],
      file: {
        name: `Partner-Agreement-${name.replace(/\s+/g, '-')}.pdf`,
        file: fileBase64,
      },
      irn,
    })

    // Save to DB with invite_id link
    const { data: doc } = await supabase
      .from('esign_documents')
      .insert({
        invite_id: invite.id,
        leegality_document_id: result.documentId,
        irn,
        document_name: `Partner Agreement - ${name}`,
        status: 'IN PROGRESS',
      })
      .select('id')
      .single()

    if (doc && result.invitees?.length) {
      await supabase.from('esign_invitees').insert(
        result.invitees.map((inv) => ({
          document_id: doc.id,
          name: inv.name,
          email: inv.email || null,
          phone: inv.phone || null,
          sign_url: inv.signUrl,
          status: 'pending',
        }))
      )
    }

    const signUrl = result.invitees?.[0]?.signUrl
    return NextResponse.json({
      success: true,
      signUrl,
      documentId: result.documentId,
    })
  } catch (err: any) {
    console.error('[esign/initiate] error:', err)
    return NextResponse.json({ error: err.message || 'Failed to initiate eSigning' }, { status: 500 })
  }
}
