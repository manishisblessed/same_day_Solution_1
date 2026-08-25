import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken } from '@/lib/onboarding/invites'
import { roleLabel } from '@/lib/hierarchy'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'

export const dynamic = 'force-dynamic'

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * GET /api/onboard/[token]/pg-form/download
 * Prefilled Personal Guarantee (PG) form for the invitee to sign and re-upload.
 */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const supabase = getSupabaseAdmin()
  const { invite, error } = await loadInviteByToken(supabase, params.token)
  if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Personal Guarantee Form</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;padding:40px;color:#111;line-height:1.7;font-size:13px}
  h1{font-size:20px;text-align:center;margin-bottom:6px;color:#1e293b}
  .sub{text-align:center;color:#64748b;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  td{padding:6px 8px;border:1px solid #cbd5e1}
  .label{background:#f1f5f9;font-weight:600;width:38%}
  .sign{margin-top:70px;display:flex;justify-content:space-between}
</style></head><body>
  <h1>Personal Guarantee Form</h1>
  <div class="sub">Same Day Solution &mdash; ${esc(roleLabel(invite.target_role))} Onboarding</div>
  <table>
    <tr><td class="label">Applicant Name</td><td>${esc(invite.name || '________________')}</td></tr>
    <tr><td class="label">Role</td><td>${esc(roleLabel(invite.target_role))}</td></tr>
    <tr><td class="label">Mobile</td><td>${esc(invite.phone)}</td></tr>
    <tr><td class="label">Email</td><td>${esc(invite.email)}</td></tr>
  </table>
  <p>I hereby personally guarantee the due performance of all obligations under the partner agreement and
  accept liability for any dues arising from transactions conducted under my account.</p>
  <div class="sign">
    <div>Date: ${new Date().toLocaleDateString('en-IN')}</div>
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
