// Shared builders for CA GST Transaction Invoice exports (CSV / PDF HTML).
// Used by the single-invoice export route and the bulk export-all route so a
// single source of truth drives every format (csv, pdf, zip).

import type { CompanyConfig } from '@/lib/ca/company-invoice'

export const INR = (n: number) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const pct = (n: number) => `${Number(n || 0).toFixed(2)}%`

export function esc(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function invoiceMeta(inv: any) {
  const brandName = inv.brands?.name || 'Unknown Brand'
  const breakdown: any[] = inv.breakdown || []
  const generatedAt = new Date(inv.generated_at || inv.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  return { brandName, breakdown, generatedAt }
}

/** Single-invoice CSV (summary + per-TID breakdown). */
export function invoiceCsv(inv: any): string {
  const { brandName, breakdown, generatedAt } = invoiceMeta(inv)
  const lines: any[][] = [
    ['Invoice Number', inv.invoice_number],
    ['Brand', brandName],
    ['Period', `${inv.period_start} to ${inv.period_end}`],
    ['Transaction Count', inv.txn_count],
    ['Total Transaction Value', Number(inv.total_transaction_value).toFixed(2)],
    ['Bank MDR Total (₹)', Number(inv.bank_mdr_total).toFixed(2)],
    [`Margin (${pct(inv.margin_percent)})`, Number(inv.margin_amount).toFixed(2)],
    ['Service Charge Total (₹)', Number(inv.service_charge_total).toFixed(2)],
    [`GST (${pct(inv.gst_percent)})`, Number(inv.gst_amount).toFixed(2)],
    ['Total with GST (₹)', Number(inv.total_with_gst).toFixed(2)],
    ['Status', inv.status],
    ['Generated At', generatedAt],
    [],
    ['--- Per-TID Breakdown ---'],
    ['TID', 'Payment Mode', 'Txn Count', 'Transaction Value (₹)', 'Bank MDR %', 'Bank MDR Amount (₹)'],
    ...breakdown.map((b) => [
      b.tid, b.payment_mode, b.txn_count,
      Number(b.transaction_value).toFixed(2),
      Number(b.bank_mdr_percent).toFixed(4),
      Number(b.bank_mdr_amount).toFixed(2),
    ]),
  ]
  return '\uFEFF' + lines
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
}

/** Issuer block (company details) printed atop the GST invoice when available. */
function issuerBlock(company?: CompanyConfig | null): string {
  if (!company) return ''
  const addr = String(company.address || '').split(/\n|,(?=\s)/).map((s) => s.trim()).filter(Boolean)
  return `
    <div class="issuer">
      ${addr.map((l) => `<div class="iss-addr">${esc(l)}</div>`).join('')}
      <div class="iss-meta">GSTIN: ${esc(company.gstin || '')}${company.pan ? '  |  PAN: ' + esc(company.pan) : ''}</div>
      <div class="iss-meta">${company.email ? 'Email: ' + esc(company.email) : ''}${company.phone ? '  |  Phone: ' + esc(company.phone) : ''}${company.cin ? '  |  CIN: ' + esc(company.cin) : ''}</div>
    </div>`
}

/** Bank + signatory footer printed on the GST invoice when available. */
function issuerFooter(company?: CompanyConfig | null): string {
  if (!company) return ''
  const bank: [string, any][] = [
    ['Bank Account Number', company.bank_account_number],
    ['Particular of A/C', company.bank_account_type],
    ["A/C Holder's Name", company.bank_holder_name],
    ['Bank Name', company.bank_name],
    ['IFSC Code', company.bank_ifsc],
    ['Branch Name', company.bank_branch],
  ].filter(([, v]) => v && String(v).trim()) as [string, any][]
  const bankHtml = bank.length
    ? `<div class="bankbox"><div class="section-title">Bank Details</div><table class="bankt">${bank.map(([k, v]) => `<tr><td class="bk">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>`
    : ''
  const sig = `<div class="sigbox">
      <div class="sig-for">For ${esc(company.legal_name || company.brands?.name || '')}</div>
      ${company.signature_image ? `<img src="${esc(company.signature_image)}" class="sig-img" alt="signature"/>` : ''}
      <div class="sig-name">${esc(company.authorized_signatory_name || '')}</div>
      <div class="sig-line">Authorized Signatory</div>
    </div>`
  return `<div class="issuer-foot">${bankHtml}${sig}</div>`
}

/** Inner HTML body for one invoice (no <html> wrapper) — reusable for merged PDFs. */
export function invoiceBodyHtml(inv: any, company?: CompanyConfig | null): string {
  const { brandName, breakdown, generatedAt } = invoiceMeta(inv)
  const title = company?.legal_name || brandName
  const breakdownRows = breakdown.map((b) => `
    <tr>
      <td>${esc(b.tid)}</td>
      <td>${esc(b.payment_mode)}</td>
      <td class="num">${b.txn_count}</td>
      <td class="num">${INR(b.transaction_value)}</td>
      <td class="num">${pct(b.bank_mdr_percent)}</td>
      <td class="num">${INR(b.bank_mdr_amount)}</td>
    </tr>`).join('')

  return `
  <div class="invoice">
    <div class="header">
      <div class="brand-block">
        <h1>${esc(title)}</h1>
        <p>GST Transaction Invoice</p>
        <p>Period: ${esc(inv.period_start)} to ${esc(inv.period_end)}</p>
        ${issuerBlock(company)}
      </div>
      <div class="inv-block">
        <div class="inv-no">${esc(inv.invoice_number)}</div>
        <p>Generated: ${esc(generatedAt)}</p>
        <p>Transactions: ${esc(inv.txn_count)}</p>
        <span class="badge">${esc(inv.status)}</span>
      </div>
    </div>

    <div class="summary">
      <div class="summary-card">
        <div class="label">Total Transaction Value</div>
        <div class="value">${INR(inv.total_transaction_value)}</div>
      </div>
      <div class="summary-card">
        <div class="label">Bank MDR Total</div>
        <div class="value">${INR(inv.bank_mdr_total)}</div>
      </div>
      <div class="summary-card">
        <div class="label">Margin (${pct(inv.margin_percent)})</div>
        <div class="value">${INR(inv.margin_amount)}</div>
      </div>
      <div class="summary-card highlight">
        <div class="label">GST Output Tax (GSTR-1) @ ${pct(inv.gst_percent)}</div>
        <div class="value">${INR(inv.gst_amount)}</div>
      </div>
    </div>

    <div class="section-title">Per-TID Transaction Breakdown</div>
    <table>
      <thead>
        <tr>
          <th>TID</th>
          <th>Payment Mode</th>
          <th class="num">Txn Count</th>
          <th class="num">Transaction Value</th>
          <th class="num">Bank MDR %</th>
          <th class="num">Bank MDR Amount</th>
        </tr>
      </thead>
      <tbody>${breakdownRows}</tbody>
    </table>

    <div class="gst-table">
      <div class="section-title">Invoice Summary</div>
      <table>
        <tbody>
          <tr><td>Bank MDR Total</td><td class="num">${INR(inv.bank_mdr_total)}</td></tr>
          <tr><td>Company Margin @ ${pct(inv.margin_percent)}</td><td class="num">${INR(inv.margin_amount)}</td></tr>
          <tr><td><strong>Service Charge Total</strong></td><td class="num"><strong>${INR(inv.service_charge_total)}</strong></td></tr>
          <tr><td>GST @ ${pct(inv.gst_percent)}</td><td class="num">${INR(inv.gst_amount)}</td></tr>
          <tr class="total"><td>Total with GST</td><td class="num">${INR(inv.total_with_gst)}</td></tr>
        </tbody>
      </table>
    </div>

    ${issuerFooter(company)}

    <div class="footer">Same Day Solution &mdash; System Generated CA Invoice &copy; ${new Date().getFullYear()}</div>
  </div>`
}

const INVOICE_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; padding: 32px; color: #1F2937; font-size: 12px; }
  .invoice { page-break-after: always; }
  .invoice:last-child { page-break-after: auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #6D28D9; padding-bottom: 16px; margin-bottom: 24px; }
  .brand-block h1 { font-size: 22px; color: #6D28D9; font-weight: 700; }
  .brand-block p { color: #6B7280; font-size: 11px; margin-top: 2px; }
  .inv-block { text-align: right; }
  .inv-block .inv-no { font-size: 14px; font-weight: 700; color: #374151; }
  .inv-block p { color: #6B7280; font-size: 11px; margin-top: 2px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; background: #EDE9FE; color: #5B21B6; margin-top: 6px; }
  .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
  .summary-card { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px; }
  .summary-card .label { font-size: 10px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .summary-card .value { font-size: 18px; font-weight: 700; color: #1F2937; }
  .highlight { background: #EDE9FE; border-color: #C4B5FD; }
  .highlight .value { color: #5B21B6; }
  .section-title { font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 8px; margin-top: 20px; border-bottom: 1px solid #E5E7EB; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #6D28D9; color: #fff; padding: 7px 8px; text-align: left; font-weight: 600; }
  th.num, td.num { text-align: right; }
  td { padding: 6px 8px; border-bottom: 1px solid #F3F4F6; }
  tr:nth-child(even) td { background: #F9FAFB; }
  .gst-table { margin-top: 20px; }
  .gst-table table { max-width: 420px; margin-left: auto; }
  .gst-table tr td:first-child { font-weight: 600; color: #374151; }
  .gst-table tr.total td { background: #6D28D9; color: #fff; font-size: 13px; font-weight: 700; }
  .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #9CA3AF; border-top: 1px solid #E5E7EB; padding-top: 10px; }
  .issuer { margin-top: 6px; }
  .issuer .iss-addr { font-size: 10px; color: #374151; }
  .issuer .iss-meta { font-size: 9.5px; color: #6B7280; margin-top: 2px; }
  .issuer-foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin-top: 22px; }
  .bankbox { flex: 1; }
  table.bankt { width: auto; }
  table.bankt td { padding: 3px 8px; border-bottom: 1px dotted #E5E7EB; font-size: 10px; }
  table.bankt td.bk { font-weight: 700; color: #6B7280; }
  table.bankt tr:nth-child(even) td { background: transparent; }
  .sigbox { text-align: center; min-width: 190px; }
  .sig-for { font-size: 10px; color: #374151; margin-bottom: 30px; }
  .sig-img { max-height: 46px; margin-bottom: 2px; }
  .sig-name { font-size: 10px; font-weight: 700; color: #111827; }
  .sig-line { font-size: 9px; color: #6B7280; border-top: 1px solid #9CA3AF; display: inline-block; padding-top: 2px; }
  @media print { body { padding: 16px; } @page { size: A4; margin: 10mm; } }
`

/** Full standalone HTML doc for one or more invoices (merged PDF). */
export function invoicesHtmlDoc(
  invoices: any[],
  title = 'GST Transaction Invoices',
  companyMap?: Record<string, CompanyConfig>,
): string {
  const bodies = invoices.map((inv) => invoiceBodyHtml(inv, companyMap?.[inv.brand_id])).join('\n')
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>${INVOICE_STYLES}</style></head>
<body>${bodies}</body></html>`
}

/** Combined list-level CSV across many invoices (one row each). */
export function invoicesListCsv(invoices: any[]): string {
  const header = [
    'Invoice No', 'Brand', 'Period Start', 'Period End', 'Txn Count',
    'Total Txn Value', 'Bank MDR Total', 'Margin %', 'Margin Amount',
    'Service Charge', 'GST %', 'GST Amount', 'Total With GST', 'Status',
  ]
  const rows = invoices.map((inv) => {
    const { brandName } = invoiceMeta(inv)
    return [
      inv.invoice_number, brandName, inv.period_start, inv.period_end, inv.txn_count,
      Number(inv.total_transaction_value).toFixed(2), Number(inv.bank_mdr_total).toFixed(2),
      Number(inv.margin_percent).toFixed(2), Number(inv.margin_amount).toFixed(2),
      Number(inv.service_charge_total).toFixed(2), Number(inv.gst_percent).toFixed(2),
      Number(inv.gst_amount).toFixed(2), Number(inv.total_with_gst).toFixed(2), inv.status,
    ]
  })
  return '\uFEFF' + [header, ...rows]
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
}
