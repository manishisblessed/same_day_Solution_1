// Pure-JS PDF generation for CA invoices using jsPDF (no headless browser).
// Runs reliably in serverless (AWS Amplify / Lambda) where Puppeteer/Chromium
// is unavailable or times out.

import { jsPDF } from 'jspdf'
import {
  computeInvoice, fmtDate, type CompanyConfig, type Receiver, type InvoiceInput,
} from '@/lib/ca/company-invoice'

// Palette
const PURPLE: [number, number, number] = [109, 40, 217]
const DARK: [number, number, number] = [31, 41, 55]
const GRAY: [number, number, number] = [107, 114, 128]
const BORDER: [number, number, number] = [209, 213, 219]
const LIGHT: [number, number, number] = [244, 243, 255]

const inr = (n: number) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export interface InvoiceRender { company: CompanyConfig; receiver: Receiver; inv: InvoiceInput }

/** Renders one Tax/Reimbursement invoice per page; returns a PDF Buffer. */
export function buildTaxInvoicesPdf(items: InvoiceRender[]): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 36
  const R = PW - M
  const CW = R - M

  items.forEach((item, idx) => {
    if (idx > 0) doc.addPage()
    drawInvoice(doc, item, M, R, CW, PW, PH)
  })

  const ab = doc.output('arraybuffer')
  return Buffer.from(ab)
}

function drawInvoice(doc: jsPDF, item: InvoiceRender, M: number, R: number, CW: number, PW: number, PH: number) {
  const { company, receiver, inv } = item
  const c = computeInvoice(company, receiver, inv)
  let y = M + 4

  const setFill = (rgb: [number, number, number]) => doc.setFillColor(rgb[0], rgb[1], rgb[2])
  const setText = (rgb: [number, number, number]) => doc.setTextColor(rgb[0], rgb[1], rgb[2])
  const setDraw = (rgb: [number, number, number]) => doc.setDrawColor(rgb[0], rgb[1], rgb[2])

  // ── Header: company name + address + tax meta ──
  setText(PURPLE); doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text(company.legal_name || company.brands?.name || 'Company', M, y)
  y += 14
  setText(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  for (const ln of c.addrLines) { doc.text(ln, M, y); y += 10 }
  y += 2
  setText(GRAY); doc.setFontSize(8)
  const metaL1 = [company.gstin ? `GSTIN: ${company.gstin}` : '', company.pan ? `PAN: ${company.pan}` : ''].filter(Boolean).join('   |   ')
  if (metaL1) { doc.text(metaL1, M, y); y += 9 }
  const metaL2 = [company.email ? `Email: ${company.email}` : '', company.phone ? `Phone: ${company.phone}` : '', company.cin ? `CIN: ${company.cin}` : ''].filter(Boolean).join('   |   ')
  if (metaL2) { doc.text(metaL2, M, y); y += 9 }
  y += 2
  setDraw(PURPLE); doc.setLineWidth(2); doc.line(M, y, R, y); doc.setLineWidth(0.5)
  y += 12

  // ── Meta bar: place of supply | title | invoice no/date ──
  const barH = 34
  setDraw(BORDER); doc.setFillColor(255, 255, 255)
  doc.rect(M, y, CW, barH, 'S')
  setText(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  doc.text(`Place of Supply: ${c.placeOfSupply || '-'}`, M + 6, y + 13)
  doc.text(`Reverse Charge: ${company.reverse_charge || 'NO'}`, M + 6, y + 25)
  setText(PURPLE); doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
  doc.text(inv.kind, PW / 2, y + 21, { align: 'center' })
  setText(DARK); doc.setFontSize(8.5)
  doc.text(`Invoice No: ${inv.invoiceNumber}`, R - 6, y + 13, { align: 'right' })
  doc.text(`Invoice Date: ${fmtDate(inv.date)}`, R - 6, y + 25, { align: 'right' })
  y += barH + 10

  // ── Receiver (Billed To) ──
  const recvLines: string[] = []
  if (c.recvAddr) recvLines.push(...doc.splitTextToSize(c.recvAddr, CW - 14))
  if (receiver.gstin) recvLines.push(`GSTIN: ${receiver.gstin}`)
  if (receiver.pan) recvLines.push(`PAN: ${receiver.pan}`)
  if (receiver.email) recvLines.push(`Email: ${receiver.email}`)
  const recvH = 30 + recvLines.length * 10
  setFill([250, 250, 255]); setDraw(BORDER)
  doc.rect(M, y, CW, recvH, 'FD')
  setText(PURPLE); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('Details of Receiver (Billed To)', M + 6, y + 13)
  setText(DARK); doc.setFontSize(10)
  doc.text(receiver.name || '-', M + 6, y + 25)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setText(DARK)
  let ry = y + 36
  for (const ln of recvLines) { doc.text(ln, M + 6, ry); ry += 10 }
  y += recvH + 10

  // ── Items table ──
  const col = { sno: M, desc: M + 36, sac: R - 180, amt: R }
  const descW = col.sac - col.desc - 8
  const sacX = col.sac + 6
  const headH = 20
  setFill(PURPLE); doc.rect(M, y, CW, headH, 'F')
  setText([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
  doc.text('S.No', col.sno + 4, y + 13)
  doc.text('Description of Goods / Services', col.desc + 2, y + 13)
  doc.text('SAC/HSN', sacX, y + 13)
  doc.text('Taxable Value (INR)', col.amt - 4, y + 13, { align: 'right' })
  y += headH

  setText(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  c.lines.forEach((l, i) => {
    const wrapped = doc.splitTextToSize(l.description, descW)
    const rowH = Math.max(18, wrapped.length * 10 + 8)
    setDraw(BORDER); doc.rect(M, y, CW, rowH, 'S')
    doc.line(col.desc, y, col.desc, y + rowH)
    doc.line(col.sac, y, col.sac, y + rowH)
    doc.text(String(i + 1), col.sno + 8, y + 13)
    doc.text(wrapped, col.desc + 2, y + 13)
    doc.text(l.sac || '', sacX, y + 13)
    doc.text(inr(l.amount), col.amt - 4, y + 13, { align: 'right' })
    y += rowH
  })
  y += 12

  // ── Totals (right block) ──
  const tW = 220
  const tX = R - tW
  const rows: [string, string, boolean][] = [['Total', inr(c.taxable), false]]
  if (c.intra) {
    rows.push([`CGST (${c.rate / 2}%)`, inr(c.cgst), false])
    rows.push([`SGST (${c.rate / 2}%)`, inr(c.sgst), false])
  } else {
    rows.push([`IGST (${c.rate}%)`, inr(c.igst), false])
  }
  rows.push(['Invoice Total', inr(c.grand), true])
  const rH = 18
  rows.forEach(([label, val, grand], i) => {
    const ry2 = y + i * rH
    if (grand) { setFill(PURPLE); doc.rect(tX, ry2, tW, rH, 'F'); setText([255, 255, 255]); doc.setFont('helvetica', 'bold') }
    else { setDraw(BORDER); doc.rect(tX, ry2, tW, rH, 'S'); setText(DARK); doc.setFont('helvetica', 'normal') }
    doc.setFontSize(9)
    doc.text(label, tX + 6, ry2 + 12)
    doc.text(val, R - 6, ry2 + 12, { align: 'right' })
  })
  y += rows.length * rH + 12

  // ── Amount in words ──
  setDraw(BORDER); doc.setFillColor(255, 255, 255)
  const wordsWrapped = doc.splitTextToSize(`Invoice Total (In Words): ${c.words}`, CW - 12)
  const wordsH = 10 + wordsWrapped.length * 10
  doc.rect(M, y, CW, wordsH, 'S')
  setText(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  doc.text(wordsWrapped, M + 6, y + 13)
  y += wordsH + 12

  // ── Bank details ──
  if (c.bank.length) {
    const bankH = 24 + c.bank.length * 12
    setFill(LIGHT); setDraw(BORDER); doc.rect(M, y, CW, bankH, 'FD')
    setText(PURPLE); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text('Bank Details', M + 6, y + 14)
    let by = y + 26
    doc.setFontSize(8.5)
    for (const [k, v] of c.bank) {
      setText(GRAY); doc.setFont('helvetica', 'bold'); doc.text(k, M + 6, by)
      setText(DARK); doc.setFont('helvetica', 'normal'); doc.text(v, M + 150, by)
      by += 12
    }
    y += bankH + 14
  }

  // ── Signatory (bottom-right) ──
  const sigX = R - 90
  const sigBase = Math.min(Math.max(y + 40, PH - 90), PH - 60)
  setText(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(`For ${company.legal_name || company.brands?.name || ''}`, sigX, sigBase - 34, { align: 'center' })
  if (company.signature_image && /^data:image\/(png|jpe?g)/i.test(company.signature_image)) {
    try {
      const fmt = /png/i.test(company.signature_image) ? 'PNG' : 'JPEG'
      doc.addImage(company.signature_image, fmt, sigX - 45, sigBase - 30, 90, 24)
    } catch { /* ignore bad image */ }
  }
  if (company.authorized_signatory_name) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text(company.authorized_signatory_name, sigX, sigBase, { align: 'center' })
  }
  setDraw(GRAY); doc.line(sigX - 70, sigBase + 4, sigX + 70, sigBase + 4)
  setText(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text('Authorized Signatory', sigX, sigBase + 14, { align: 'center' })
}

// ── Aggregate GST (monthly) transaction invoice ─────────────────────────────
export function buildGstInvoicesPdf(invoices: any[], companyMap: Record<string, CompanyConfig>): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 36
  const R = PW - M
  const CW = R - M
  invoices.forEach((inv, idx) => {
    if (idx > 0) doc.addPage()
    drawGstInvoice(doc, inv, companyMap?.[inv.brand_id], M, R, CW, PH)
  })
  return Buffer.from(doc.output('arraybuffer'))
}

function drawGstInvoice(doc: jsPDF, inv: any, company: CompanyConfig | undefined, M: number, R: number, CW: number, PH: number) {
  const setFill = (rgb: [number, number, number]) => doc.setFillColor(rgb[0], rgb[1], rgb[2])
  const setText = (rgb: [number, number, number]) => doc.setTextColor(rgb[0], rgb[1], rgb[2])
  const setDraw = (rgb: [number, number, number]) => doc.setDrawColor(rgb[0], rgb[1], rgb[2])
  const name = company?.legal_name || inv.brands?.name || 'Company'
  let y = M + 4

  // Header
  setText(PURPLE); doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text(name, M, y); y += 14
  setText(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  if (company) {
    for (const ln of String(company.address || '').split(/\n|,(?=\s)/).map((s) => s.trim()).filter(Boolean)) { doc.text(ln, M, y); y += 10 }
    setText(GRAY); doc.setFontSize(8)
    const l1 = [company.gstin ? `GSTIN: ${company.gstin}` : '', company.pan ? `PAN: ${company.pan}` : ''].filter(Boolean).join('   |   ')
    if (l1) { doc.text(l1, M, y); y += 9 }
    const l2 = [company.email ? `Email: ${company.email}` : '', company.phone ? `Phone: ${company.phone}` : '', company.cin ? `CIN: ${company.cin}` : ''].filter(Boolean).join('   |   ')
    if (l2) { doc.text(l2, M, y); y += 9 }
  }
  y += 2
  setDraw(PURPLE); doc.setLineWidth(2); doc.line(M, y, R, y); doc.setLineWidth(0.5); y += 12

  // Title + meta bar
  const barH = 34
  setDraw(BORDER); doc.setFillColor(255, 255, 255); doc.rect(M, y, CW, barH, 'S')
  setText(PURPLE); doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text('GST Transaction Invoice', M + 6, y + 21)
  setText(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  doc.text(`Invoice No: ${inv.invoice_number}`, R - 6, y + 13, { align: 'right' })
  doc.text(`Period: ${inv.period_start} to ${inv.period_end}`, R - 6, y + 25, { align: 'right' })
  y += barH + 10

  // Summary table
  const sumRows: [string, string, boolean][] = [
    ['Total Transaction Value', inr(inv.total_transaction_value), false],
    ['Transactions', String(inv.txn_count), false],
    ['Bank MDR Total', inr(inv.bank_mdr_total), false],
    [`Company Margin @ ${Number(inv.margin_percent).toFixed(2)}%`, inr(inv.margin_amount), false],
    ['Service Charge Total', inr(inv.service_charge_total), false],
    [`GST @ ${Number(inv.gst_percent).toFixed(2)}%`, inr(inv.gst_amount), false],
    ['Total with GST', inr(inv.total_with_gst), true],
  ]
  const sRH = 18
  sumRows.forEach(([label, val, grand], i) => {
    const ry = y + i * sRH
    if (grand) { setFill(PURPLE); doc.rect(M, ry, CW, sRH, 'F'); setText([255, 255, 255]); doc.setFont('helvetica', 'bold') }
    else { setDraw(BORDER); doc.rect(M, ry, CW, sRH, 'S'); setText(DARK); doc.setFont('helvetica', 'normal') }
    doc.setFontSize(9)
    doc.text(label, M + 6, ry + 12)
    doc.text(val, R - 6, ry + 12, { align: 'right' })
  })
  y += sumRows.length * sRH + 16

  // Per-TID breakdown table (paginated)
  const breakdown: any[] = Array.isArray(inv.breakdown) ? inv.breakdown : []
  const cols = [
    { x: M, w: 140, label: 'TID', align: 'left' as const },
    { x: M + 140, w: 80, label: 'Mode', align: 'left' as const },
    { x: M + 220, w: 60, label: 'Txns', align: 'right' as const },
    { x: M + 280, w: Math.max(90, CW - 280 - 150), label: 'Txn Value', align: 'right' as const },
    { x: R - 150, w: 70, label: 'MDR %', align: 'right' as const },
    { x: R - 80, w: 80, label: 'MDR Amt', align: 'right' as const },
  ]
  const drawHead = () => {
    setFill(PURPLE); doc.rect(M, y, CW, 18, 'F')
    setText([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    for (const c of cols) doc.text(c.label, c.align === 'right' ? c.x + c.w - 4 : c.x + 4, y + 12, { align: c.align })
    y += 18
  }
  if (breakdown.length) {
    setText(DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text('Per-TID Breakdown', M, y); y += 8
    drawHead()
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(DARK)
    const rowH = 15
    for (const b of breakdown) {
      if (y + rowH > PH - 40) { doc.addPage(); y = M + 4; drawHead(); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setText(DARK) }
      setDraw(BORDER); doc.rect(M, y, CW, rowH, 'S')
      const vals = [
        String(b.tid || ''), String(b.payment_mode || ''), String(b.txn_count || 0),
        inr(b.transaction_value), `${Number(b.bank_mdr_percent).toFixed(2)}%`, inr(b.bank_mdr_amount),
      ]
      cols.forEach((c, i) => doc.text(vals[i], c.align === 'right' ? c.x + c.w - 4 : c.x + 4, y + 10, { align: c.align }))
      y += rowH
    }
    y += 14
  }

  // Bank + signatory
  if (y > PH - 120) { doc.addPage(); y = M + 4 }
  const bank = company ? ([
    ['Bank Account Number', company.bank_account_number],
    ['Particular of A/C', company.bank_account_type],
    ["A/C Holder's Name", company.bank_holder_name],
    ['Bank Name', company.bank_name],
    ['IFSC Code', company.bank_ifsc],
    ['Branch Name', company.bank_branch],
  ] as [string, any][]).filter(([, v]) => v && String(v).trim()) : []
  if (bank.length) {
    const bankH = 24 + bank.length * 12
    setFill(LIGHT); setDraw(BORDER); doc.rect(M, y, CW, bankH, 'FD')
    setText(PURPLE); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('Bank Details', M + 6, y + 14)
    let by = y + 26; doc.setFontSize(8.5)
    for (const [k, v] of bank) {
      setText(GRAY); doc.setFont('helvetica', 'bold'); doc.text(String(k), M + 6, by)
      setText(DARK); doc.setFont('helvetica', 'normal'); doc.text(String(v), M + 150, by)
      by += 12
    }
    y += bankH + 14
  }
  if (company) {
    const sigX = R - 90
    const sigBase = Math.min(Math.max(y + 40, PH - 80), PH - 50)
    setText(DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    doc.text(`For ${name}`, sigX, sigBase - 20, { align: 'center' })
    if (company.authorized_signatory_name) { doc.setFont('helvetica', 'bold'); doc.text(company.authorized_signatory_name, sigX, sigBase, { align: 'center' }) }
    setDraw(GRAY); doc.line(sigX - 70, sigBase + 4, sigX + 70, sigBase + 4)
    setText(GRAY); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text('Authorized Signatory', sigX, sigBase + 14, { align: 'center' })
  }
}
