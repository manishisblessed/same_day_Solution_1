// Shared CA company invoice-profile helpers + GST "Tax Invoice" document renderer.
// Issuer = the Company/Brand (ca_company_config). Billed To = the Partner.
// Layout mirrors the reference generator in D:\tech\invoice_python.

export interface ServiceLine { description: string; sac: string; percent: number }

export interface CompanyConfig {
  brand_id: string
  legal_name?: string | null
  address?: string | null
  gstin?: string | null
  pan?: string | null
  email?: string | null
  phone?: string | null
  state_code?: string | null
  cin?: string | null
  place_of_supply?: string | null
  jurisdiction?: string | null
  reverse_charge?: string | null
  service_lines?: ServiceLine[] | null
  terms?: string[] | null
  bank_account_number?: string | null
  bank_account_type?: string | null
  bank_holder_name?: string | null
  bank_name?: string | null
  bank_branch?: string | null
  bank_ifsc?: string | null
  authorized_signatory_name?: string | null
  signature_image?: string | null
  gst_percent?: number | null
  margin_percent?: number | null
  brands?: { id: string; key: string; name: string; short_name: string }
}

export interface Receiver {
  name?: string | null
  address?: string | null
  gstin?: string | null
  pan?: string | null
  email?: string | null
  phone?: string | null
  state?: string | null
}

// Fields required before an invoice document can be generated.
export const REQUIRED_COMPANY_FIELDS: { key: keyof CompanyConfig; label: string }[] = [
  { key: 'legal_name', label: 'Company Name' },
  { key: 'address', label: 'Address' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'pan', label: 'PAN' },
  { key: 'email', label: 'Email' },
  { key: 'bank_account_number', label: 'Bank Account Number' },
  { key: 'bank_holder_name', label: "A/C Holder's Name" },
  { key: 'bank_name', label: 'Bank Name' },
  { key: 'bank_ifsc', label: 'IFSC Code' },
]

export function checkCompanyComplete(cfg: CompanyConfig | null | undefined): { complete: boolean; missing: string[] } {
  if (!cfg) return { complete: false, missing: ['Company profile not configured'] }
  const missing: string[] = []
  for (const f of REQUIRED_COMPANY_FIELDS) {
    const v = cfg[f.key]
    if (v === null || v === undefined || String(v).trim() === '') missing.push(f.label)
  }
  const lines = Array.isArray(cfg.service_lines) ? cfg.service_lines : []
  if (lines.length === 0 || !lines.some((l) => l && String(l.description || '').trim() && String(l.sac || '').trim())) {
    missing.push('Description of Service + SAC/HSN')
  }
  return { complete: missing.length === 0, missing }
}

// ── formatting helpers ──────────────────────────────────────────────────────
export const INR = (n: number) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const num = (n: number) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function esc(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const fmtDate = (d: string | Date) => {
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// amount in words (Indian system)
function amountInWords(amount: number): string {
  const n = Math.round(amount * 100)
  const rupees = Math.floor(n / 100)
  const paise = n % 100
  const words = (x: number): string => {
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
    if (x === 0) return ''
    if (x < 20) return a[x]
    if (x < 100) return b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : '')
    if (x < 1000) return a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + words(x % 100) : '')
    if (x < 100000) return words(Math.floor(x / 1000)) + ' Thousand' + (x % 1000 ? ' ' + words(x % 1000) : '')
    if (x < 10000000) return words(Math.floor(x / 100000)) + ' Lakh' + (x % 100000 ? ' ' + words(x % 100000) : '')
    return words(Math.floor(x / 10000000)) + ' Crore' + (x % 10000000 ? ' ' + words(x % 10000000) : '')
  }
  let out = rupees === 0 ? 'Zero' : words(rupees)
  out += ' Rupees'
  if (paise > 0) out += ' and ' + words(paise) + ' Paise'
  return out + ' Only'
}

const norm = (s?: string | null) => String(s || '').trim().toLowerCase()

export interface InvoiceInput {
  invoiceNumber: string
  date: string | Date
  taxableValue: number     // base amount the GST is computed on
  gstPercent: number
  kind: 'Reimbursement Invoice' | 'Tax Invoice'
}

export interface ComputedInvoice {
  rate: number
  taxable: number
  placeOfSupply: string
  intra: boolean
  cgst: number
  sgst: number
  igst: number
  gstTotal: number
  grand: number
  lines: { description: string; sac: string; amount: number }[]
  bank: [string, string][]
  words: string
  addrLines: string[]
  recvAddr: string
}

/** Single source of truth for all invoice math + line split (HTML + PDF). */
export function computeInvoice(company: CompanyConfig, receiver: Receiver, inv: InvoiceInput): ComputedInvoice {
  const rate = Number(inv.gstPercent ?? company.gst_percent ?? 18)
  const taxable = Number(inv.taxableValue || 0)
  const placeOfSupply = receiver.state || company.place_of_supply || ''
  const intra = norm(placeOfSupply) === norm(company.place_of_supply) || norm(placeOfSupply) === norm(company.jurisdiction)
  const gstTotal = Math.round(taxable * rate) / 100
  const cgst = Math.round((gstTotal / 2) * 100) / 100
  const sgst = gstTotal - cgst
  const igst = gstTotal
  const grand = taxable + gstTotal

  let src = Array.isArray(company.service_lines) ? company.service_lines.filter((l) => l && l.description) : []
  if (src.length === 0) src = [{ description: 'Information technology & payment support services', sac: '998314', percent: 100 }]
  const totalPct = src.reduce((s, l) => s + (Number(l.percent) || 0), 0) || 100
  let allocated = 0
  const lines = src.map((l, i) => {
    let amount: number
    if (i === src.length - 1) amount = Math.round((taxable - allocated) * 100) / 100
    else { amount = Math.round(taxable * (Number(l.percent) || 0) / totalPct * 100) / 100; allocated += amount }
    return { description: String(l.description), sac: String(l.sac || ''), amount }
  })

  const bank = ([
    ['Bank Account Number', company.bank_account_number],
    ['Particular of A/C', company.bank_account_type],
    ["A/C Holder's Name", company.bank_holder_name],
    ['Bank Name', company.bank_name],
    ['IFSC Code', company.bank_ifsc],
    ['Branch Name', company.bank_branch],
  ] as [string, any][]).filter(([, v]) => v && String(v).trim()).map(([k, v]) => [k, String(v)] as [string, string])

  const addrLines = String(company.address || '').split(/\n|,(?=\s)/).map((s) => s.trim()).filter(Boolean)
  const recvAddr = String(receiver.address || '').split(/\n/).map((s) => s.trim()).filter(Boolean).join(', ')

  return { rate, taxable, placeOfSupply, intra, cgst, sgst, igst, gstTotal, grand, lines, bank, words: amountInWords(grand), addrLines, recvAddr }
}

// Build the inner HTML for ONE invoice (no <html> wrapper).
export function renderInvoiceBody(company: CompanyConfig, receiver: Receiver, inv: InvoiceInput): string {
  const { rate, taxable, placeOfSupply, intra, cgst, sgst, igst, grand, lines, bank, words, addrLines, recvAddr } =
    computeInvoice(company, receiver, inv)

  const lineRows = lines.map((l, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(l.description)}</td>
      <td class="c">${esc(l.sac)}</td>
      <td class="r">${num(l.amount)}</td>
    </tr>`).join('')

  const bankRows = bank.map(([k, v]) => `<tr><td class="bk">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')

  const totalsRows = [
    `<tr><td>Total</td><td class="r">${num(taxable)}</td></tr>`,
    ...(intra
      ? [`<tr><td>CGST (${(rate / 2)}%)</td><td class="r">${num(cgst)}</td></tr>`,
         `<tr><td>SGST (${(rate / 2)}%)</td><td class="r">${num(sgst)}</td></tr>`]
      : [`<tr><td>IGST (${rate}%)</td><td class="r">${num(igst)}</td></tr>`]),
    `<tr class="grand"><td>Invoice Total</td><td class="r">${num(grand)}</td></tr>`,
  ].join('')

  const terms = Array.isArray(company.terms) ? company.terms.filter(Boolean) : []
  const sigImg = company.signature_image
    ? `<img src="${esc(company.signature_image)}" class="sig-img" alt="signature"/>`
    : ''

  return `
  <div class="inv">
    <div class="ihead">
      <div class="co">
        <div class="co-name">${esc(company.legal_name || company.brands?.name || 'Company')}</div>
        ${addrLines.map((l) => `<div class="co-addr">${esc(l)}</div>`).join('')}
        <div class="co-meta">GSTIN: ${esc(company.gstin || '')}${company.pan ? '  |  PAN: ' + esc(company.pan) : ''}</div>
        <div class="co-meta">${company.email ? 'Email: ' + esc(company.email) : ''}${company.phone ? '  |  Phone: ' + esc(company.phone) : ''}</div>
        ${company.cin ? `<div class="co-meta">CIN: ${esc(company.cin)}</div>` : ''}
      </div>
    </div>

    <div class="metabar">
      <div class="mb-left">
        <div>Place of Supply: ${esc(placeOfSupply)}</div>
        <div>Reverse Charge: ${esc(company.reverse_charge || 'NO')}</div>
      </div>
      <div class="mb-title">${esc(inv.kind)}</div>
      <div class="mb-right">
        <div>Invoice No: <b>${esc(inv.invoiceNumber)}</b></div>
        <div>Invoice Date: <b>${fmtDate(inv.date)}</b></div>
      </div>
    </div>

    <div class="recv">
      <div class="recv-title">Details of Receiver (Billed To)</div>
      <div class="recv-name">${esc(receiver.name || '—')}</div>
      ${recvAddr ? `<div class="recv-ln">${esc(recvAddr)}</div>` : ''}
      ${receiver.gstin ? `<div class="recv-ln">GSTIN: ${esc(receiver.gstin)}</div>` : ''}
      ${receiver.pan ? `<div class="recv-ln">PAN: ${esc(receiver.pan)}</div>` : ''}
      ${receiver.email ? `<div class="recv-ln">Email: ${esc(receiver.email)}</div>` : ''}
    </div>

    <table class="items">
      <thead><tr>
        <th class="c" style="width:7%">S.No</th>
        <th>Description of Goods / Services</th>
        <th class="c" style="width:14%">SAC / HSN</th>
        <th class="r" style="width:20%">Taxable Value (INR)</th>
      </tr></thead>
      <tbody>${lineRows}</tbody>
    </table>

    <div class="lower">
      <table class="totals">${totalsRows}</table>
    </div>

    <div class="words">Invoice Total (In Words): <b>${esc(words)}</b></div>

    ${bankRows ? `<div class="bank"><div class="bank-title">Bank Details</div><table>${bankRows}</table></div>` : ''}

    <div class="foot">
      <div class="terms">
        ${terms.length ? `<div class="terms-title">Terms &amp; Conditions</div>${terms.map((t) => `<div>${esc(t)}</div>`).join('')}` : ''}
      </div>
      <div class="sign">
        <div class="sign-for">For ${esc(company.legal_name || company.brands?.name || '')}</div>
        ${sigImg}
        <div class="sign-name">${esc(company.authorized_signatory_name || '')}</div>
        <div class="sign-line">Authorized Signatory</div>
      </div>
    </div>
  </div>`
}

const STYLES = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#1f2937;font-size:11px}
  .inv{padding:26px 30px;page-break-after:always}
  .inv:last-child{page-break-after:auto}
  .ihead{border-bottom:3px solid #6D28D9;padding-bottom:10px;margin-bottom:10px}
  .co-name{font-size:19px;font-weight:800;color:#6D28D9;letter-spacing:.2px}
  .co-addr{font-size:10px;color:#374151;margin-top:1px}
  .co-meta{font-size:9.5px;color:#6b7280;margin-top:3px}
  .metabar{display:flex;justify-content:space-between;align-items:center;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;margin-bottom:10px}
  .mb-left,.mb-right{font-size:9.5px;color:#374151;line-height:1.5}
  .mb-right{text-align:right}
  .mb-title{font-size:17px;font-weight:800;color:#6D28D9}
  .recv{border:1px solid #e5e7eb;border-radius:6px;background:#fafaff;padding:8px 10px;margin-bottom:10px}
  .recv-title{font-size:10px;font-weight:700;color:#6D28D9;margin-bottom:3px}
  .recv-name{font-size:11px;font-weight:700;color:#111827}
  .recv-ln{font-size:9.5px;color:#374151;margin-top:1px}
  table.items{width:100%;border-collapse:collapse;margin-bottom:10px}
  table.items th{background:#6D28D9;color:#fff;padding:6px 8px;font-size:9.5px;text-align:left}
  table.items td{padding:6px 8px;border:1px solid #e5e7eb;font-size:10px}
  .c{text-align:center}.r{text-align:right}
  .lower{display:flex;justify-content:flex-end;margin-bottom:8px}
  table.totals{border-collapse:collapse;min-width:260px}
  table.totals td{border:1px solid #e5e7eb;padding:5px 10px;font-size:10px}
  table.totals td.r{text-align:right}
  table.totals tr.grand td{background:#6D28D9;color:#fff;font-weight:800;font-size:11px}
  .words{border:1px solid #e5e7eb;border-radius:6px;padding:6px 10px;font-size:10px;margin-bottom:10px}
  .bank{border:1px solid #e5e7eb;border-radius:6px;background:#faf5ff;padding:8px 10px;margin-bottom:10px}
  .bank-title{font-size:10px;font-weight:700;color:#6D28D9;margin-bottom:4px}
  .bank table{border-collapse:collapse;width:100%}
  .bank td{padding:3px 6px;font-size:9.5px;border-bottom:1px dotted #e5e7eb}
  .bank td.bk{font-weight:700;color:#6b7280;width:38%}
  .foot{display:flex;justify-content:space-between;align-items:flex-end;margin-top:14px;gap:20px}
  .terms{font-size:8.5px;color:#6b7280;line-height:1.5;max-width:62%}
  .terms-title{font-weight:700;color:#374151;margin-bottom:2px;font-size:9px}
  .sign{text-align:center;min-width:180px}
  .sign-for{font-size:9.5px;color:#374151;margin-bottom:28px}
  .sig-img{max-height:46px;margin-bottom:2px}
  .sign-name{font-size:10px;font-weight:700;color:#111827}
  .sign-line{font-size:9px;color:#6b7280;border-top:1px solid #9ca3af;display:inline-block;padding-top:2px;margin-top:2px}
  @page{size:A4;margin:0}
`

export function buildInvoiceDoc(bodies: string[], title = 'Invoice'): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>${STYLES}</style></head><body>${bodies.join('\n')}</body></html>`
}

// CSS exported so the browser-side PDF generator (html2pdf.js) can reuse it.
export const INVOICE_CSS = STYLES
