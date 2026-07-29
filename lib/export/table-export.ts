import { downloadBlob, type ExportFormat } from '@/components/ExportDropdown'

const escapeCSV = (v: string) =>
  v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v

const escapeXML = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface ExportTableOptions {
  format: ExportFormat
  title: string
  filename: string
  headers: string[]
  rows: (string | number)[][]
  themeColor?: string
}

export function exportTable({
  format,
  title,
  filename,
  headers,
  rows,
  themeColor = '#059669',
}: ExportTableOptions) {
  const stringRows = rows.map(r => r.map(c => (c == null ? '' : String(c))))
  const datePart = new Date().toISOString().split('T')[0]

  if (format === 'csv') {
    const csv = [headers.join(','), ...stringRows.map(r => r.map(escapeCSV).join(','))].join('\n')
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `${filename}-${datePart}.csv`)
    return
  }

  if (format === 'excel') {
    const hdr = `<Row>${headers.map(h => `<Cell><Data ss:Type="String">${escapeXML(h)}</Data></Cell>`).join('')}</Row>`
    const xr = stringRows
      .map(r => `<Row>${r.map(c => `<Cell><Data ss:Type="String">${escapeXML(c)}</Data></Cell>`).join('')}</Row>`)
      .join('\n')
    const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${escapeXML(title)}"><Table>${hdr}${xr}</Table></Worksheet></Workbook>`
    downloadBlob(new Blob([xml], { type: 'application/vnd.ms-excel' }), `${filename}-${datePart}.xls`)
    return
  }

  // pdf via print window
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeXML(title)}</title><style>body{font-family:Arial,sans-serif;padding:20px;font-size:11px}h1{color:#333;font-size:18px}table{width:100%;border-collapse:collapse;margin-top:15px}th{background:${themeColor};color:white;padding:6px;text-align:left;font-size:9px}td{padding:5px;border-bottom:1px solid #E5E7EB;font-size:9px}tr:nth-child(even){background:#F9FAFB}.footer{margin-top:15px;text-align:center;font-size:9px;color:#888}</style></head><body><h1>${escapeXML(title)}</h1><p style="color:#666;font-size:11px">Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} | ${stringRows.length} entries</p><table><thead><tr>${headers.map(h => `<th>${escapeXML(h)}</th>`).join('')}</tr></thead><tbody>${stringRows.map(r => `<tr>${r.map(c => `<td>${escapeXML(c)}</td>`).join('')}</tr>`).join('')}</tbody></table><div class="footer">System-generated report &copy; ${new Date().getFullYear()} Same Day Solution</div></body></html>`
  const w = window.open('', '_blank')
  if (w) {
    w.document.write(html)
    w.document.close()
    w.print()
  }
}
