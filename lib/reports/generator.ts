/**
 * Reusable server-side report generation utilities.
 * Supports CSV, Excel (XML Spreadsheet 2003), and PDF (via Puppeteer).
 */

import { NextResponse } from 'next/server'
import { htmlToPdf } from '@/lib/pdf/html-to-pdf'

export interface ReportColumn {
  header: string
  key: string
  type?: 'string' | 'number' | 'currency' | 'date'
}

export interface ReportMeta {
  title: string
  subtitle?: string
  dateRange?: { from: string | null; to: string | null }
  generatedBy?: string
  summaryCards?: { label: string; value: string }[]
}

function escapeCSV(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function cellValue(row: any, col: ReportColumn): string {
  const raw = row[col.key]
  if (raw == null) return '-'
  if (col.type === 'date' && raw) {
    return new Date(raw).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  }
  if (col.type === 'currency') return Number(raw).toFixed(2)
  if (col.type === 'number') return String(Number(raw))
  return String(raw)
}

// ── CSV ─────────────────────────────────────────────────────────────────

export function generateCSVResponse(
  rows: any[],
  columns: ReportColumn[],
  filename: string,
  meta?: ReportMeta
): NextResponse {
  const lines: string[] = []

  if (meta) {
    lines.push(meta.title)
    lines.push(`Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`)
    if (meta.dateRange)
      lines.push(`Date Range: ${meta.dateRange.from || 'All'} to ${meta.dateRange.to || 'Now'}`)
    if (meta.summaryCards)
      meta.summaryCards.forEach(c => lines.push(`${c.label}: ${c.value}`))
    lines.push('')
  }

  lines.push(columns.map(c => escapeCSV(c.header)).join(','))
  for (const row of rows) {
    lines.push(columns.map(c => escapeCSV(cellValue(row, c))).join(','))
  }

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  })
}

// ── Excel (XML Spreadsheet 2003 → opens as .xls) ───────────────────────

export function generateExcelResponse(
  rows: any[],
  columns: ReportColumn[],
  filename: string,
  sheetName = 'Report'
): NextResponse {
  const headerRow = `<Row>${columns.map(c => `<Cell><Data ss:Type="String">${escapeXml(c.header)}</Data></Cell>`).join('')}</Row>`

  const dataRows = rows.map(row => {
    const cells = columns.map(col => {
      const raw = row[col.key]
      if (col.type === 'number' || col.type === 'currency') {
        return `<Cell><Data ss:Type="Number">${Number(raw || 0)}</Data></Cell>`
      }
      return `<Cell><Data ss:Type="String">${escapeXml(cellValue(row, col))}</Data></Cell>`
    })
    return `<Row>${cells.join('')}</Row>`
  })

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="${escapeXml(sheetName)}">
    <Table>
      ${headerRow}
      ${dataRows.join('\n')}
    </Table>
  </Worksheet>
</Workbook>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/vnd.ms-excel',
      'Content-Disposition': `attachment; filename="${filename}.xls"`,
    },
  })
}

// ── PDF (Puppeteer with HTML fallback) ──────────────────────────────────

export async function generatePDFResponse(
  rows: any[],
  columns: ReportColumn[],
  filename: string,
  meta?: ReportMeta,
  options?: { landscape?: boolean; accentColor?: string }
): Promise<NextResponse> {
  const accent = options?.accentColor || '#4F46E5'
  const landscape = options?.landscape ?? (columns.length > 8)

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(meta?.title || 'Report')}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #333; font-size: 11px; }
    .header { text-align: center; margin-bottom: 20px; border-bottom: 3px solid ${accent}; padding-bottom: 12px; }
    .header h1 { font-size: 20px; color: ${accent}; margin-bottom: 4px; }
    .header p { font-size: 11px; color: #666; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 16px; background: #F9FAFB; padding: 10px; border-radius: 6px; flex-wrap: wrap; gap: 8px; }
    .meta-item { text-align: center; flex: 1; min-width: 100px; }
    .meta-item .label { font-size: 9px; color: #888; text-transform: uppercase; }
    .meta-item .value { font-size: 14px; font-weight: bold; color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: ${accent}; color: white; padding: 6px 5px; text-align: left; font-size: 9px; font-weight: 600; }
    td { padding: 5px; border-bottom: 1px solid #E5E7EB; font-size: 9px; }
    tr:nth-child(even) { background: #F9FAFB; }
    .amount { font-family: monospace; text-align: right; }
    .status-success { color: #059669; font-weight: 600; }
    .status-failed { color: #DC2626; font-weight: 600; }
    .status-pending { color: #D97706; font-weight: 600; }
    .footer { margin-top: 16px; text-align: center; font-size: 9px; color: #888; border-top: 1px solid #E5E7EB; padding-top: 8px; }
    @media print { body { padding: 12px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(meta?.title || 'Report')}</h1>
    <p>Generated on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}${meta?.generatedBy ? ` | ${escapeHtml(meta.generatedBy)}` : ''}${meta?.dateRange ? ` | ${meta.dateRange.from || 'Start'} → ${meta.dateRange.to || 'Now'}` : ''}</p>
  </div>

  ${meta?.summaryCards?.length ? `
  <div class="meta">
    ${meta.summaryCards.map(c => `
    <div class="meta-item">
      <div class="label">${escapeHtml(c.label)}</div>
      <div class="value">${escapeHtml(c.value)}</div>
    </div>`).join('')}
  </div>` : ''}

  <table>
    <thead>
      <tr>
        <th>#</th>
        ${columns.map(c => `<th>${escapeHtml(c.header)}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows.map((row, i) => `
      <tr>
        <td>${i + 1}</td>
        ${columns.map(col => {
          const val = cellValue(row, col)
          const cls = col.type === 'currency' || col.type === 'number' ? 'amount' : ''
          const statusCls = col.key === 'status'
            ? ['success', 'captured', 'completed'].includes(val.toLowerCase()) ? 'status-success'
              : ['failed'].includes(val.toLowerCase()) ? 'status-failed'
              : ['pending', 'processing', 'initiated'].includes(val.toLowerCase()) ? 'status-pending'
              : ''
            : ''
          return `<td class="${cls} ${statusCls}">${col.type === 'currency' ? '₹' : ''}${escapeHtml(val)}</td>`
        }).join('')}
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="footer">
    <p>Total records: ${rows.length} &bull; This is a system-generated report. &copy; ${new Date().getFullYear()} Same Day Solution</p>
  </div>
</body>
</html>`

  const pdf = await htmlToPdf(html, { landscape })
  if (pdf) {
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}.pdf"`,
      },
    })
  }

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.html"`,
    },
  })
}
