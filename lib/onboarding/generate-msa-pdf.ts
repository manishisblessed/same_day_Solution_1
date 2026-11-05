/**
 * Generate a prefilled MSA (Master Service Agreement) as HTML for PDF conversion.
 * Uses the partner's KYC-verified details captured during onboarding.
 */

import { roleLabel } from '@/lib/hierarchy'
import { getLogoDataUrl } from './brand'

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface MsaPrefillData {
  name: string
  phone: string
  email: string
  targetRole: string
  pan?: string
  aadhaarUid?: string
  bankAccountHolder?: string
  businessName?: string
  businessRole?: string
  gstin?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  inviteId: string
}

export function generateMsaHtml(data: MsaPrefillData): string {
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const logo = getLogoDataUrl()

  const logoHtml = logo
    ? `<img src="${logo}" alt="Same Day Solution" style="height:56px;object-fit:contain" />`
    : `<div style="height:56px;width:56px;border-radius:14px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px">SDS</div>`

  const fullAddress = [data.address, data.city, data.state, data.pincode].filter(Boolean).join(', ')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Partner Agreement — ${esc(data.name)}</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;padding:40px 48px;color:#111;line-height:1.75;font-size:12px}
  .brand{display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:12px}
  .company{font-size:15px;font-weight:800;color:#1e293b;letter-spacing:.2px;text-align:center}
  .company small{display:block;font-weight:500;color:#64748b;font-size:10px;margin-top:2px}
  h1{font-size:17px;text-align:center;margin:8px 0 4px;color:#1e293b;text-transform:uppercase;letter-spacing:.5px}
  .sub{text-align:center;color:#64748b;margin-bottom:16px;font-size:11px}
  .date-line{text-align:center;margin-bottom:20px;font-size:11.5px;color:#475569}
  table{width:100%;border-collapse:collapse;margin:14px 0}
  td{padding:6px 10px;border:1px solid #cbd5e1;font-size:11.5px}
  .label{background:#f1f5f9;font-weight:600;width:36%;color:#334155}
  h2{font-size:13.5px;color:#1e293b;margin:22px 0 6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  h3{font-size:12px;color:#334155;margin:16px 0 4px}
  ol,ul{margin-top:4px;padding-left:20px}
  ol li,ul li{margin-bottom:5px;text-align:justify;font-size:11.5px}
  .highlight{background:#fffbeb;border-left:3px solid #f59e0b;padding:8px 12px;margin:10px 0;font-size:11px}
  .sign-block{margin-top:50px;display:flex;justify-content:space-between;gap:40px}
  .sign-box{flex:1;border-top:1px solid #94a3b8;padding-top:8px;text-align:center;font-size:11px;color:#475569}
  .foot{margin-top:30px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:9.5px;color:#94a3b8;text-align:center}
  .page-break{page-break-before:always}
</style></head><body>

<div class="brand">
  ${logoHtml}
  <div class="company">Same Day Solution Pvt. Ltd.<small>CIN: U74999WB2024PTC275608 &bull; Registered Fintech / Payments Partner Network</small></div>
</div>

<h1>Master Service Agreement</h1>
<div class="sub">${esc(roleLabel(data.targetRole))} Partner Onboarding Agreement</div>
<div class="date-line">Date of Execution: <strong>${esc(today)}</strong> &nbsp;|&nbsp; Reference: <strong>SDS/MSA/${esc(data.inviteId.substring(0, 8).toUpperCase())}</strong></div>

<p>This Master Service Agreement ("<strong>Agreement</strong>") is entered into between:</p>

<table>
  <tr><td class="label" colspan="2" style="text-align:center;background:#e0e7ff;font-weight:700">PARTY A — The Company</td></tr>
  <tr><td class="label">Name</td><td>Same Day Solution Pvt. Ltd.</td></tr>
  <tr><td class="label">Registered Office</td><td>Kolkata, West Bengal, India</td></tr>
  <tr><td class="label">CIN</td><td>U74999WB2024PTC275608</td></tr>
</table>

<table>
  <tr><td class="label" colspan="2" style="text-align:center;background:#e0e7ff;font-weight:700">PARTY B — The Partner</td></tr>
  <tr><td class="label">Name</td><td>${esc(data.name)}</td></tr>
  <tr><td class="label">Role</td><td>${esc(roleLabel(data.targetRole))}</td></tr>
  <tr><td class="label">Mobile</td><td>${esc(data.phone)}</td></tr>
  <tr><td class="label">Email</td><td>${esc(data.email)}</td></tr>
  <tr><td class="label">PAN</td><td>${esc(data.pan || '—')}</td></tr>
  <tr><td class="label">Aadhaar (Masked)</td><td>${esc(data.aadhaarUid || '—')}</td></tr>
  <tr><td class="label">Bank A/C Holder</td><td>${esc(data.bankAccountHolder || '—')}</td></tr>
  <tr><td class="label">Business / Firm</td><td>${esc(data.businessName || '—')}</td></tr>
  ${data.businessRole ? `<tr><td class="label">Signing Capacity</td><td>${esc(data.businessRole)}</td></tr>` : ''}
  <tr><td class="label">GSTIN</td><td>${esc(data.gstin || 'Not provided')}</td></tr>
  <tr><td class="label">Address</td><td>${esc(fullAddress || '—')}</td></tr>
</table>

<h2>1. Scope of Services</h2>
<ol>
  <li>The Company hereby appoints the Partner as a <strong>${esc(roleLabel(data.targetRole))}</strong> to distribute, facilitate and provide financial technology services including but not limited to: AEPS, Mini-ATM, POS transactions, Domestic Money Transfer (DMT), Bill Payments, Recharges, and such other services as may be offered by the Company from time to time.</li>
  <li>The Partner shall operate under the brand, platform, guidelines and service-level agreements as prescribed by the Company.</li>
</ol>

<h2>2. Term &amp; Termination</h2>
<ol>
  <li>This Agreement shall be effective from the date of execution and shall continue for a period of <strong>one (1) year</strong>, automatically renewable for successive one-year terms unless either party provides 30 days' written notice of non-renewal.</li>
  <li>Either party may terminate this Agreement with 30 days' prior written notice. The Company may terminate immediately for cause, including breach of this Agreement, fraud, regulatory non-compliance, or conduct detrimental to the Company's interests.</li>
  <li>Upon termination, the Partner shall immediately cease using all Company platforms, trademarks and materials, and settle all outstanding dues within 15 days.</li>
</ol>

<h2>3. Financial Terms</h2>
<ol>
  <li><strong>Commissions:</strong> The Partner shall earn commissions/margins as per the prevailing rate card published on the Company's dashboard, which may be updated from time to time at the Company's sole discretion.</li>
  <li><strong>Wallet &amp; Settlement:</strong> All transactions shall be routed through the Company's wallet system. Settlement shall be as per the prevailing T+1 / instant settlement policy.</li>
  <li><strong>Deductions:</strong> The Company is authorised to deduct/adjust any amounts owed (chargebacks, reversals, penalties, dues) from the Partner's wallet, commissions, security deposit, or any pending settlements.</li>
</ol>

<h2>4. Partner Obligations</h2>
<ol>
  <li>Comply with all applicable laws including the Prevention of Money Laundering Act, 2002, IT Act, 2000, and all RBI/NPCI guidelines.</li>
  <li>Maintain KYC documents current and promptly update the Company of any changes.</li>
  <li>Not engage in or facilitate fraudulent, unauthorised, or illegal transactions.</li>
  <li>Keep login credentials, TPIN and devices secure; the Partner is solely responsible for all activity under their account.</li>
  <li>Not sub-license, assign, or transfer any rights under this Agreement without the Company's prior written consent.</li>
  <li>Cooperate fully with any audit, investigation, or regulatory inquiry.</li>
</ol>

<h2>5. Intellectual Property</h2>
<p>All intellectual property, including the Company's brand, logo, software, documentation, and proprietary systems, remain the exclusive property of the Company. The Partner is granted a limited, non-exclusive, revocable licence to use the same solely for providing the agreed services during the term.</p>

<h2>6. Confidentiality</h2>
<p>Each party shall maintain the confidentiality of the other's proprietary information, customer data, and business strategies. This obligation survives termination of this Agreement for a period of 2 years.</p>

<h2>7. Data Protection &amp; Consent</h2>
<ol>
  <li>The Partner consents to the collection, processing, storage and sharing of personal data, KYC information, live photographs/video, geo-location, and transaction data for onboarding, verification, risk management, regulatory compliance, and service delivery.</li>
  <li>The Partner shall ensure compliance with applicable data protection regulations in handling any customer or transaction data accessed through the Company's platform.</li>
</ol>

<h2>8. Liability &amp; Indemnity</h2>
<ol>
  <li>The Partner shall indemnify and hold harmless the Company against all claims, losses, damages, penalties, and expenses arising from the Partner's breach of this Agreement or applicable law.</li>
  <li>The Company's maximum aggregate liability under this Agreement shall not exceed the total commissions paid to the Partner in the 3 months preceding the event giving rise to the claim.</li>
</ol>

<h2>9. Dispute Resolution</h2>
<ol>
  <li>This Agreement shall be governed by the laws of India.</li>
  <li>Any disputes shall first be attempted to be resolved amicably. Failing resolution within 30 days, disputes shall be referred to arbitration under the Arbitration and Conciliation Act, 1996, with the seat of arbitration in <strong>Kolkata, West Bengal</strong>.</li>
  <li>Courts at Kolkata shall have exclusive jurisdiction.</li>
</ol>

<h2>10. General</h2>
<ol>
  <li>This Agreement constitutes the entire agreement between the parties and supersedes all prior understandings.</li>
  <li>Amendments to this Agreement shall be effective only when communicated in writing or published on the Company's dashboard.</li>
  <li>Failure to enforce any provision shall not constitute a waiver thereof.</li>
  <li>If any provision is held invalid, the remaining provisions shall continue in full force.</li>
</ol>

<div class="highlight">
  <strong>Declaration:</strong> I, ${esc(data.name)}, confirm that the information provided is true, complete and accurate. I have read, understood and agree to be bound by the terms of this Agreement.
</div>

<div class="sign-block">
  <div class="sign-box">
    <br/><br/>
    Authorised Signatory<br/>
    <strong>Same Day Solution Pvt. Ltd.</strong>
  </div>
  <div class="sign-box">
    <br/><br/>
    ${esc(data.name)}<br/>
    <strong>${esc(roleLabel(data.targetRole))} Partner</strong><br/>
    ${esc(data.phone)}
  </div>
</div>

<div class="foot">
  This is a digitally generated agreement. Upon eSign completion via Leegality, this document shall be legally binding.<br/>
  Agreement Ref: SDS/MSA/${esc(data.inviteId.substring(0, 8).toUpperCase())} &bull; Generated on ${esc(today)}
</div>

</body></html>`
}
