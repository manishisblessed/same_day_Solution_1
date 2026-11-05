/**
 * Generate the actual MSA (Master Service Agreement) as HTML for PDF conversion.
 * Loads the full legal template from msa-template.html and fills partner-specific
 * fields from KYC-verified data captured during onboarding.
 */

import fs from 'fs'
import path from 'path'
import { roleLabel } from '@/lib/hierarchy'
import { getLogoDataUrl } from './brand'

let cachedTemplate: string | null = null
function loadTemplate(): string {
  if (!cachedTemplate) {
    cachedTemplate = fs.readFileSync(
      path.join(process.cwd(), 'lib', 'onboarding', 'msa-template.html'),
      'utf-8'
    )
  }
  return cachedTemplate
}

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

function formatDateLong(d: Date): string {
  const day = d.getDate()
  const suffix = [, 'st', 'nd', 'rd'][day % 10 > 3 ? 0 : (day % 100 - day % 10 !== 10 ? day % 10 : 0)] || 'th'
  const month = d.toLocaleDateString('en-IN', { month: 'long' })
  return `${day}${suffix} day of ${month} ${d.getFullYear()}`
}

function formatDateShort(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const day = d.getDate()
  const suffix = [, 'st', 'nd', 'rd'][day % 10 > 3 ? 0 : (day % 100 - day % 10 !== 10 ? day % 10 : 0)] || 'th'
  return `${months[d.getMonth()]} ${day}${suffix}, ${d.getFullYear()}`
}

function getConstitution(data: MsaPrefillData): string {
  const role = data.businessRole?.toLowerCase() || ''
  if (role.includes('proprietor')) return '☒ Proprietorship ☐ Partnership ☐ Pvt Ltd ☐ LLP ☐ Other'
  if (role.includes('partner')) return '☐ Proprietorship ☒ Partnership ☐ Pvt Ltd ☐ LLP ☐ Other'
  if (role.includes('director')) return '☐ Proprietorship ☐ Partnership ☒ Pvt Ltd ☐ LLP ☐ Other'
  if (role.includes('llp')) return '☐ Proprietorship ☐ Partnership ☐ Pvt Ltd ☒ LLP ☐ Other'
  return '☐ Proprietorship ☐ Partnership ☐ Pvt Ltd ☐ LLP ☒ Other'
}

export function generateMsaHtml(data: MsaPrefillData): string {
  const today = new Date()
  const logo = getLogoDataUrl()
  const fullAddress = [data.address, data.city, data.state, data.pincode].filter(Boolean).join(', ')
  const partnerLegalName = data.businessName || data.name
  const ref = `SDS-MSA-${data.inviteId.substring(0, 8).toUpperCase()}`

  let body = loadTemplate()

  const replacements: Record<string, string> = {
    '{{PARTNER_LEGAL_NAME}}': esc(partnerLegalName),
    '{{PARTNER_SHORT_NAME}}': esc(partnerLegalName),
    '{{PARTNER_FULL_ADDRESS}}': esc(fullAddress || '(Address as per KYC records)'),
    '{{PARTNER_ADDRESS_SHORT}}': esc(fullAddress || '(Address as per KYC records)'),
    '{{PARTNER_SIGNATORY_NAME}}': esc(data.name),
    '{{PARTNER_DESIGNATION}}': esc(data.businessRole || roleLabel(data.targetRole)),
    '{{EXECUTION_DATE}}': esc(formatDateShort(today)),
    '{{EXECUTION_DATE_LONG}}': esc(formatDateLong(today)),
    '{{EFFECTIVE_DATE}}': esc(formatDateShort(today)),
    '{{PARTNER_CITY}}': esc(data.city || 'New Delhi'),
    '{{PARTNER_CONSTITUTION}}': getConstitution(data),
    '{{DOCUMENT_VERSION}}': esc(`${ref}-v1.1`),
  }

  for (const [placeholder, value] of Object.entries(replacements)) {
    body = body.split(placeholder).join(value)
  }

  const logoHtml = logo
    ? `<img src="${logo}" alt="Same Day Solution" style="height:50px;object-fit:contain;display:block;margin:0 auto 8px" />`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Master Service Agreement — ${esc(data.name)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: 'Segoe UI', 'Noto Sans', Arial, sans-serif; padding: 0; color: #111; line-height: 1.65; font-size: 10.5px; }
  h1 { font-size: 15px; text-align: center; margin: 14px 0 6px; color: #1e293b; }
  h2 { font-size: 12.5px; color: #1e293b; margin: 16px 0 4px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
  h3 { font-size: 11px; color: #334155; margin: 10px 0 3px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  td, th { padding: 4px 7px; border: 1px solid #cbd5e1; font-size: 10px; vertical-align: top; }
  p { margin: 4px 0; text-align: justify; font-size: 10.5px; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  ol, ul { margin: 4px 0; padding-left: 18px; }
  ol li, ul li { margin-bottom: 3px; font-size: 10.5px; text-align: justify; }
  sup { font-size: 70%; vertical-align: super; }
  .ref-line { text-align: center; font-size: 9.5px; color: #64748b; margin-bottom: 12px; }
  .foot { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 6px; font-size: 8.5px; color: #94a3b8; text-align: center; }
</style></head><body>

${logoHtml}
<div class="ref-line">Reference: <strong>${esc(ref)}</strong> &nbsp;|&nbsp; Generated: ${esc(today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }))}</div>

${body}

<div class="foot">
  This document is digitally generated and signed via Aadhaar eSign through Leegality eSigning Gateway.<br/>
  ${esc(ref)} &bull; ${esc(today.toISOString())}
</div>

</body></html>`
}
