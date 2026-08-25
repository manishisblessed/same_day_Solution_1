import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, getVerifications } from '@/lib/onboarding/invites'
import { roleLabel } from '@/lib/hierarchy'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'

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

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Self Declaration</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;padding:40px;color:#111;line-height:1.7;font-size:13px}
  h1{font-size:20px;text-align:center;margin-bottom:6px;color:#1e293b}
  .sub{text-align:center;color:#64748b;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  td{padding:6px 8px;border:1px solid #cbd5e1}
  .label{background:#f1f5f9;font-weight:600;width:38%}
  .decl{margin-top:20px}
  .sign{margin-top:60px;display:flex;justify-content:space-between}
</style></head><body>
  <h1>Self Declaration &amp; Undertaking</h1>
  <div class="sub">Same Day Solution &mdash; ${esc(roleLabel(invite.target_role))} Onboarding</div>
  <table>
    <tr><td class="label">Full Name</td><td>${esc(name)}</td></tr>
    <tr><td class="label">Role Applied For</td><td>${esc(roleLabel(invite.target_role))}</td></tr>
    <tr><td class="label">Mobile</td><td>${esc(invite.phone)}</td></tr>
    <tr><td class="label">Email</td><td>${esc(invite.email)}</td></tr>
    <tr><td class="label">PAN</td><td>${esc(pan?.pan || '—')}</td></tr>
    <tr><td class="label">Aadhaar (masked)</td><td>${esc(aadhaar?.uid || '—')}</td></tr>
    <tr><td class="label">Bank Account (name)</td><td>${esc(bank?.nameAtBank || '—')}</td></tr>
    <tr><td class="label">Business / Shop</td><td>${esc(business || '—')}</td></tr>
  </table>
  <div class="decl">
    <p>I, the undersigned, hereby declare that:</p>
    <ol>
      <li>All information and documents submitted during this onboarding are true, correct and complete to the best of my knowledge.</li>
      <li>The KYC documents (PAN, Aadhaar, bank account) belong to me and have been submitted with my consent.</li>
      <li>I shall comply with all applicable laws, RBI/NPCI guidelines and the platform's terms of service.</li>
      <li>I understand that any misrepresentation may result in immediate termination and legal action.</li>
    </ol>
  </div>
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
