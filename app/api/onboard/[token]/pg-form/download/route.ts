import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, getVerifications } from '@/lib/onboarding/invites'
import { roleLabel } from '@/lib/hierarchy'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'

export const dynamic = 'force-dynamic'

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * GET /api/onboard/[token]/pg-form/download
 * Personal Guarantee cum Declaration form, prefilled from the details captured
 * during onboarding (PAN, Aadhaar, bank, business, GST). The invitee signs it
 * physically and re-uploads it as the PG_FORM document.
 */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const supabase = getSupabaseAdmin()
  const { invite, error } = await loadInviteByToken(supabase, params.token)
  if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })

  const verifications = await getVerifications(supabase, invite.id)
  const byType = new Map(verifications.map((v) => [v.type, v]))
  const pan = byType.get('PAN_360')?.response_payload as any
  const aadhaar = byType.get('AADHAAR_DIGILOCKER')?.response_payload as any
  const bank = byType.get('BANK_PENNY_DROP')?.response_payload as any
  const gst = byType.get('GST')?.response_payload as any
  const business = byType.get('BUSINESS_NAME')?.verified_name

  const name = invite.name || pan?.registered_name || aadhaar?.name || '________________'
  const today = new Date().toLocaleDateString('en-IN')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Personal Guarantee Form</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;padding:40px;color:#111;line-height:1.7;font-size:13px}
  h1{font-size:20px;text-align:center;margin-bottom:6px;color:#1e293b}
  .sub{text-align:center;color:#64748b;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  td{padding:6px 8px;border:1px solid #cbd5e1}
  .label{background:#f1f5f9;font-weight:600;width:38%}
  ol{margin-top:8px}
  .sign{margin-top:60px;display:flex;justify-content:space-between}
</style></head><body>
  <h1>Personal Guarantee cum Declaration</h1>
  <div class="sub">Same Day Solution &mdash; ${esc(roleLabel(invite.target_role))} Onboarding</div>
  <table>
    <tr><td class="label">Applicant Name</td><td>${esc(name)}</td></tr>
    <tr><td class="label">Role Applied For</td><td>${esc(roleLabel(invite.target_role))}</td></tr>
    <tr><td class="label">Mobile</td><td>${esc(invite.phone)}</td></tr>
    <tr><td class="label">Email</td><td>${esc(invite.email)}</td></tr>
    <tr><td class="label">PAN</td><td>${esc(pan?.pan || '—')}</td></tr>
    <tr><td class="label">Aadhaar (as per DigiLocker)</td><td>${esc(aadhaar?.uid || '—')}</td></tr>
    <tr><td class="label">Bank Account Holder</td><td>${esc(bank?.nameAtBank || '—')}</td></tr>
    <tr><td class="label">Business / Shop Name</td><td>${esc(business || '—')}</td></tr>
    <tr><td class="label">GSTIN</td><td>${esc(gst?.GSTIN || 'Not provided')}</td></tr>
  </table>
  <p>I, <strong>${esc(name)}</strong>, the undersigned, in consideration of Same Day Solution Pvt. Ltd.
  ("the Company") on-boarding me as a <strong>${esc(roleLabel(invite.target_role))}</strong>, hereby
  unconditionally and irrevocably declare and guarantee that:</p>
  <ol>
    <li>All information and documents submitted during this onboarding (PAN, Aadhaar, bank account, business and GST details above) are true, correct and complete, and belong to me.</li>
    <li>I personally guarantee the due performance of all obligations under the partner agreement and accept full liability for any dues, chargebacks, refunds or losses arising from transactions conducted under my account.</li>
    <li>I shall comply with all applicable laws and RBI / NPCI guidelines and the Company's terms of service, and shall not use the platform for any unlawful or fraudulent purpose.</li>
    <li>I understand that any misrepresentation or breach may result in immediate termination, recovery of dues and appropriate legal action.</li>
  </ol>
  <div class="sign">
    <div>Date: ${esc(today)}</div>
    <div>Signature: ____________________</div>
  </div>
</body></html>`

  try {
    const pdf = await htmlToPdf(html, {})
    if (pdf) {
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="pg-form-${invite.id}.pdf"`,
        },
      })
    }
  } catch {}

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="pg-form-${invite.id}.html"`,
    },
  })
}
