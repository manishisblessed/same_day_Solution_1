// Browser-side PDF generation for CA invoices.
//
// Server-side headless Chromium (Puppeteer) is unreliable on serverless hosting
// (cold-start hangs → gateway timeouts). We render invoices to PDF entirely in
// the browser with html2pdf.js, so downloads never depend on the server runtime.

/**
 * Render one or more invoice HTML bodies into a single multi-page PDF Blob.
 * Each body should carry `page-break-after: always` (the invoice CSS does).
 */
export async function invoiceBodiesToPdfBlob(bodies: string[], css: string): Promise<Blob> {
  const html2pdf = (await import('html2pdf.js')).default as any

  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-99999px'
  container.style.top = '0'
  container.style.width = '794px' // A4 width @ 96dpi
  container.style.background = '#ffffff'
  container.innerHTML = `<style>${css}</style>${bodies.join('\n')}`
  document.body.appendChild(container)

  try {
    const blob: Blob = await html2pdf()
      .set({
        margin: 0,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(container)
      .outputPdf('blob')
    return blob
  } finally {
    document.body.removeChild(container)
  }
}
