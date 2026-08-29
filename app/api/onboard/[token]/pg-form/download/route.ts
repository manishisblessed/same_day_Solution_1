import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, getVerifications } from '@/lib/onboarding/invites'
import { roleLabel } from '@/lib/hierarchy'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'
import { getLogoDataUrl } from '@/lib/onboarding/brand'

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
  const logo = getLogoDataUrl()

  const logoHtml = logo
    ? `<img src="${logo}" alt="Same Day Solution" style="height:56px;object-fit:contain" />`
    : `<div style="height:56px;width:56px;border-radius:14px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px">SDS</div>`

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Personal Guarantee Form</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;padding:40px;color:#111;line-height:1.7;font-size:12.5px}
  .brand{display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:8px}
  .company{font-size:16px;font-weight:800;color:#1e293b;letter-spacing:.2px}
  .company small{display:block;font-weight:500;color:#64748b;font-size:11px}
  h1{font-size:19px;text-align:center;margin:6px 0 2px;color:#1e293b}
  .sub{text-align:center;color:#64748b;margin-bottom:18px}
  table{width:100%;border-collapse:collapse;margin:14px 0}
  td{padding:6px 8px;border:1px solid #cbd5e1}
  .label{background:#f1f5f9;font-weight:600;width:38%}
  ol{margin-top:8px;padding-left:18px}
  ol li{margin-bottom:6px;text-align:justify}
  h3{font-size:13px;color:#1e293b;margin:18px 0 4px}
  .sign{margin-top:48px;display:flex;justify-content:space-between}
  .foot{margin-top:26px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:10px;color:#94a3b8;text-align:center}
</style></head><body>
  <div class="brand">
    ${logoHtml}
    <div class="company" style="text-align:center">Same Day Solution Pvt. Ltd.<small>Registered Fintech / Payments Partner Network</small></div>
  </div>
  <h1>Personal Guarantee cum Declaration</h1>
  <div class="sub">${esc(roleLabel(invite.target_role))} Onboarding</div>
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
  <p>I, <strong>${esc(name)}</strong>, son/daughter/spouse of ________________, the undersigned, in
  consideration of <strong>Same Day Solution Pvt. Ltd.</strong> ("the Company") agreeing to on-board me as a
  <strong>${esc(roleLabel(invite.target_role))}</strong>, do hereby unconditionally and irrevocably declare,
  undertake and personally guarantee as follows:</p>

  <h3>A. Declaration of Accuracy</h3>
  <ol>
    <li>All information and documents submitted during this onboarding — including the PAN, Aadhaar, bank account, business and GST details set out above — are true, correct, complete and up to date, and belong to me.</li>
    <li>The name recorded on my PAN, Aadhaar and bank account pertain to one and the same person, i.e. me, and I authorise the Company to verify the same with the concerned authorities and third-party verification agencies.</li>
    <li>I have submitted the KYC documents voluntarily and with my free consent, and I have not impersonated any other person or submitted any forged, fabricated or morphed document, photograph or video.</li>
  </ol>

  <h3>B. Personal Guarantee &amp; Liability</h3>
  <ol start="4">
    <li>I personally, unconditionally and irrevocably guarantee the due performance of all my obligations under the Partner/Merchant Agreement and all associated policies of the Company, as amended from time to time.</li>
    <li>I accept full and sole liability for any and all dues, shortfalls, chargebacks, refunds, reversals, penalties, fines or losses (including consequential losses) arising out of or in connection with any transaction conducted through, or any activity carried out under, my account, login or device.</li>
    <li>I authorise the Company to recover any such amounts by adjusting/set-off against my wallet balance, commissions, security deposit or any other sums payable to me, and to report defaults to the appropriate authorities and credit bureaus.</li>
  </ol>

  <h3>C. Compliance &amp; Conduct</h3>
  <ol start="7">
    <li>I shall at all times comply with all applicable laws, including the Prevention of Money Laundering Act, 2002, the Information Technology Act, 2000, and all RBI / NPCI / regulatory guidelines, directions and circulars applicable to the services offered.</li>
    <li>I shall not use the platform for any unlawful, fraudulent, deceptive or unauthorised purpose, nor for money laundering, terror financing, gambling, or any transaction prohibited by law or by the Company.</li>
    <li>I shall keep my login credentials, TPIN and devices secure and confidential, and I remain responsible for every transaction executed using my credentials.</li>
    <li>I shall promptly intimate the Company of any change in the details or documents furnished herein.</li>
  </ol>

  <h3>D. Consent &amp; Acknowledgement</h3>
  <ol start="11">
    <li>I consent to the collection, storage, processing and sharing of my personal data, KYC information, live photographs/video, and geo-location for the purposes of onboarding, verification, risk management and regulatory compliance.</li>
    <li>I understand and agree that any misrepresentation, suppression of facts or breach of this undertaking may result in immediate suspension or termination of my account, forfeiture of dues, recovery proceedings and appropriate civil and/or criminal legal action, without further notice.</li>
    <li>This declaration and guarantee shall be governed by the laws of India and subject to the exclusive jurisdiction of the competent courts.</li>
  </ol>

  <div class="sign">
    <div>Place: ____________________<br/>Date: ${esc(today)}</div>
    <div style="text-align:center">____________________<br/>Signature of Applicant<br/>(${esc(name)})</div>
  </div>
  <div class="foot">This is a system-generated form prefilled from your onboarding details. Please verify all particulars, sign, and upload the signed copy.</div>
</body></html>`

  try {
    const pdf = await htmlToPdf(html, {})
    if (pdf) {
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="self-declaration-${invite.id}.pdf"`,
        },
      })
    }
  } catch {}

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="self-declaration-${invite.id}.html"`,
    },
  })
}
