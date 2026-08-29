import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, getVerifications } from '@/lib/onboarding/invites'
import { roleLabel } from '@/lib/hierarchy'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'
import { getLogoDataUrl } from '@/lib/onboarding/brand'

export const dynamic = 'force-dynamic'

function esc(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * GET /api/onboard/[token]/declaration/download
 * Returns a prefilled self-declaration PDF (falls back to HTML if the PDF
 * renderer is unavailable). The applicant signs it physically and re-uploads.
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
  const business = byType.get('BUSINESS_NAME')?.verified_name

  const name = invite.name || pan?.registered_name || aadhaar?.name || '________________'
  const today = new Date().toLocaleDateString('en-IN')
  const logo = getLogoDataUrl()

  const logoHtml = logo
    ? `<img src="${logo}" alt="Same Day Solution" style="height:56px;object-fit:contain" />`
    : `<div style="height:56px;width:56px;border-radius:14px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px">SDS</div>`

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Self Declaration</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;padding:40px;color:#111;line-height:1.7;font-size:12.5px}
  .brand{display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:8px}
  .company{font-size:16px;font-weight:800;color:#1e293b;text-align:center}
  .company small{display:block;font-weight:500;color:#64748b;font-size:11px}
  h1{font-size:19px;text-align:center;margin:6px 0 2px;color:#1e293b}
  .sub{text-align:center;color:#64748b;margin-bottom:18px}
  table{width:100%;border-collapse:collapse;margin:14px 0}
  td{padding:6px 8px;border:1px solid #cbd5e1}
  .label{background:#f1f5f9;font-weight:600;width:38%}
  .decl{margin-top:14px}
  ol{padding-left:18px}
  ol li{margin-bottom:6px;text-align:justify}
  .sign{margin-top:48px;display:flex;justify-content:space-between}
  .foot{margin-top:26px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:10px;color:#94a3b8;text-align:center}
</style></head><body>
  <div class="brand">
    ${logoHtml}
    <div class="company">Same Day Solution Pvt. Ltd.<small>Registered Fintech / Payments Partner Network</small></div>
  </div>
  <h1>Self Declaration &amp; Undertaking</h1>
  <div class="sub">${esc(roleLabel(invite.target_role))} Onboarding</div>
  <table>
    <tr><td class="label">Full Name</td><td>${esc(name)}</td></tr>
    <tr><td class="label">Role Applied For</td><td>${esc(roleLabel(invite.target_role))}</td></tr>
    <tr><td class="label">Mobile</td><td>${esc(invite.phone)}</td></tr>
    <tr><td class="label">Email</td><td>${esc(invite.email)}</td></tr>
    <tr><td class="label">PAN</td><td>${esc(pan?.pan || '—')}</td></tr>
    <tr><td class="label">Aadhaar (as per DigiLocker)</td><td>${esc(aadhaar?.uid || '—')}</td></tr>
    <tr><td class="label">Bank Account (name)</td><td>${esc(bank?.nameAtBank || '—')}</td></tr>
    <tr><td class="label">Business / Shop</td><td>${esc(business || '—')}</td></tr>
  </table>
  <div class="decl">
    <p>I, <strong>${esc(name)}</strong>, the undersigned, do hereby solemnly declare and undertake that:</p>
    <ol>
      <li>All information and documents submitted during this onboarding are true, correct, complete and up to date to the best of my knowledge and belief.</li>
      <li>The KYC documents (PAN, Aadhaar, bank account, business/GST) belong to me / my business and have been submitted voluntarily and with my consent, and the names therein pertain to one and the same person.</li>
      <li>The live selfie, liveness video and shop photographs captured during onboarding are genuine, captured in real time, and have not been tampered with, morphed or reused.</li>
      <li>I authorise the Company and its verification partners to verify my identity, address, bank and business details with the concerned authorities and databases.</li>
      <li>I shall comply with all applicable laws, the PMLA 2002, the IT Act 2000, and all RBI / NPCI guidelines, and the Company's terms of service and policies as amended from time to time.</li>
      <li>I shall not use the platform for any unlawful, fraudulent or unauthorised purpose, and I remain solely responsible for all transactions carried out under my account and credentials.</li>
      <li>I consent to the collection, storage and processing of my personal data, KYC information and geo-location for onboarding, verification and regulatory compliance.</li>
      <li>I understand that any misrepresentation, suppression of facts or breach of this declaration may result in immediate termination, forfeiture of dues, recovery proceedings and appropriate legal action.</li>
    </ol>
  </div>
  <div class="sign">
    <div>Place: ____________________<br/>Date: ${esc(today)}</div>
    <div style="text-align:center">____________________<br/>Signature of Applicant<br/>(${esc(name)})</div>
  </div>
  <div class="foot">This is a system-generated declaration prefilled from your onboarding details. Please verify all particulars, sign, and upload the signed copy.</div>
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
  } catch (e) {
    console.warn('[declaration/download] PDF render failed, returning HTML', e)
  }

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="self-declaration-${invite.id}.html"`,
    },
  })
}
