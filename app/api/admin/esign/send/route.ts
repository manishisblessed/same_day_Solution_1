import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getVerifications } from '@/lib/onboarding/invites'
import { createSigningRequest } from '@/services/leegality/client'
import { getLeegalityWorkflowId } from '@/services/leegality/config'
import { generateMsaHtml, type MsaPrefillData } from '@/lib/onboarding/generate-msa-pdf'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'

export const dynamic = 'force-dynamic'

const COMPANY_SIGNATORY = {
  name: 'Manish Kumar',
  email: 'manish_kumar@samedaysolution.in',
  phone: '7399599958',
}

/**
 * POST /api/admin/esign/send
 * Admin triggers a partner agreement for an approved partner to sign.
 * Body: { inviteId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    if (user.role !== 'admin' && user.role !== 'finance_executive') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { inviteId } = await request.json()
    if (!inviteId) return NextResponse.json({ error: 'inviteId is required' }, { status: 400 })

    const supabase = getSupabaseAdmin()

    const { data: invite } = await supabase
      .from('onboarding_invites')
      .select('id, name, email, phone, status, target_role')
      .eq('id', inviteId)
      .maybeSingle()

    if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })

    // Check for existing active/completed esign
    const { data: existingDoc } = await supabase
      .from('esign_documents')
      .select('id, status')
      .eq('invite_id', invite.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingDoc?.status === 'COMPLETED') {
      return NextResponse.json({ error: 'Agreement already signed', alreadySigned: true }, { status: 400 })
    }
    if (existingDoc?.status === 'IN PROGRESS') {
      return NextResponse.json({ error: 'Agreement already sent and pending signature', alreadySent: true }, { status: 400 })
    }

    // Gather KYC data
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
      return NextResponse.json({ error: 'Partner name not available from KYC data' }, { status: 400 })
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

    // Generate MSA PDF
    const msaHtml = generateMsaHtml(prefill)
    const pdfBuffer = await htmlToPdf(msaHtml, { format: 'A4', margin: '12mm' })
    if (!pdfBuffer) {
      return NextResponse.json({ error: 'Failed to generate agreement PDF' }, { status: 500 })
    }

    const fileBase64 = pdfBuffer.toString('base64')
    const irn = `SDS-MSA-${invite.id.substring(0, 8).toUpperCase()}-${Date.now()}`

    // Send to Leegality — partner signs first, then company signatory
    const result = await createSigningRequest({
      profileId: getLeegalityWorkflowId(),
      invitees: [
        { name, email: invite.email || undefined, phone: invite.phone || undefined, signingOrder: 1 },
        { ...COMPANY_SIGNATORY, signingOrder: 2 },
      ],
      file: {
        name: `Partner-Agreement-${name.replace(/\s+/g, '-')}.pdf`,
        file: fileBase64,
      },
      irn,
    })

    // Save to DB
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
        result.invitees.map((inv, idx) => ({
          document_id: doc.id,
          name: inv.name,
          email: inv.email || null,
          phone: inv.phone || null,
          sign_url: inv.signUrl,
          status: 'pending',
          signing_order: idx + 1,
        }))
      )
    }

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      partnerName: name,
      message: `Agreement sent to ${name} (${invite.email || invite.phone}) for signing`,
    })
  } catch (err: any) {
    console.error('[admin/esign/send] error:', err)
    return NextResponse.json({ error: err.message || 'Failed to send agreement' }, { status: 500 })
  }
}
