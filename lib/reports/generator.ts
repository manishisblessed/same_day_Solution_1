/**
 * Report Generation Utilities
 * Supports CSV, PDF, and ZIP formats
 */

export interface ReportData {
  headers: string[]
  rows: any[][]
  title?: string
  metadata?: Record<string, any>
}

/**
 * Generate CSV content
 */
export function generateCSV(data: ReportData): string {
  const csvRows = [
    data.headers.join(','),
    ...data.rows.map(row => 
      row.map(cell => {
        // Escape commas and quotes in CSV
        const cellStr = String(cell || '')
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`
        }
        return cellStr
      }).join(',')
    )
  ]
  return csvRows.join('\n')
}

/**
 * Generate PDF content (simple text-based PDF)
 * Note: This is a basic implementation. For production, use a proper PDF library like pdfkit or puppeteer
 */
export function generatePDF(data: ReportData): string {
  // Simple PDF structure (text-based)
  const pdfContent = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>',
    'endobj',
    '4 0 obj',
    '<< /Length 1000 >>',
    'stream',
    'BT',
    '/F1 12 Tf',
    '50 750 Td',
    `(${data.title || 'Report'}) Tj`,
    '0 -20 Td',
    ...data.headers.map((header, i) => 
      `(${header}) Tj 0 -15 Td`
    ),
    ...data.rows.flatMap(row => 
      row.map((cell, i) => 
        `(${String(cell || '')}) Tj 0 -15 Td`
      )
    ),
    'ET',
    'endstream',
    'endobj',
    'xref',
    '0 5',
    '0000000000 65535 f',
    'trailer',
    '<< /Size 5 /Root 1 0 R >>',
    'startxref',
    '%%EOF'
  ].join('\n')
  
  return pdfContent
}

/**
 * Generate ZIP file content (using JSZip-like structure)
 * Note: For production, use JSZip library
 */
export async function generateZIP(files: { name: string; content: string; type: 'csv' | 'pdf' }[]): Promise<Blob> {
  // This is a placeholder. In production, use JSZip:
  // import JSZip from 'jszip'
  // const zip = new JSZip()
  // files.forEach(file => {
  //   zip.file(`${file.name}.${file.type}`, file.content)
  // })
  // return await zip.generateAsync({ type: 'blob' })
  
  // For now, return a simple text file listing
  const fileList = files.map(f => `${f.name}.${f.type}`).join('\n')
  return new Blob([fileList], { type: 'text/plain' })
}

/**
 * Generate simple HTML-based PDF (better approach for basic PDFs)
 */
export function generateHTMLPDF(data: ReportData): string {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${data.title || 'Report'}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; font-weight: bold; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    .metadata { margin-top: 20px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <h1>${data.title || 'Report'}</h1>
  ${data.metadata ? `<div class="metadata">${Object.entries(data.metadata).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join('<br>')}</div>` : ''}
  <table>
    <thead>
      <tr>
        ${data.headers.map(h => `<th>${h}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${data.rows.map(row => 
        `<tr>${row.map(cell => `<td>${String(cell || '')}</td>`).join('')}</tr>`
      ).join('')}
    </tbody>
  </table>
</body>
</html>
  `.trim()
  
  return html
}

