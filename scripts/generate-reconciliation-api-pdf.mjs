/* eslint-disable */
// One-off: render the Partner Reconciliation API guide (README.md) to a styled PDF.
//   node scripts/generate-reconciliation-api-pdf.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { marked } = require('marked')
const puppeteer = require('puppeteer')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DOC_DIR = path.join(ROOT, 'docs', 'partner-reconciliation-api')
const MD_PATH = path.join(DOC_DIR, 'README.md')
const PDF_PATH = path.join(DOC_DIR, 'Partner-Reconciliation-API-Guide.pdf')

const md = fs.readFileSync(MD_PATH, 'utf8')
const bodyHtml = marked.parse(md, { mangle: false, headerIds: true })

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root { --brand:#4f46e5; --ink:#1f2937; --muted:#6b7280; --line:#e5e7eb; --code-bg:#f6f8fa; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink); font-size: 12px; line-height: 1.6; margin: 0; padding: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .cover {
    background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
    color: #fff; padding: 60px 48px; margin-bottom: 28px;
  }
  .cover h1 { font-size: 30px; margin: 0 0 8px; font-weight: 700; letter-spacing: -0.5px; }
  .cover p { margin: 0; font-size: 14px; opacity: .9; }
  .cover .brand { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; opacity:.85; margin-bottom: 18px; }
  .content { padding: 0 48px 48px; }
  h1 { font-size: 20px; border-bottom: 2px solid var(--brand); padding-bottom: 6px; margin-top: 30px; color:#111827; }
  h2 { font-size: 16px; margin-top: 26px; color:#111827; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
  h3 { font-size: 13.5px; margin-top: 20px; color: var(--brand); }
  p { margin: 8px 0; }
  a { color: var(--brand); text-decoration: none; }
  code {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    background: var(--code-bg); padding: 1px 5px; border-radius: 4px; font-size: 11px; color:#b91c1c;
  }
  pre {
    background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px;
    padding: 12px 14px; overflow-x: auto; page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; color: #111827; font-size: 10.5px; line-height: 1.5; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 11px; page-break-inside: avoid; }
  th, td { border: 1px solid var(--line); padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 600; }
  tr:nth-child(even) td { background: #fafafa; }
  blockquote {
    margin: 12px 0; padding: 8px 14px; border-left: 4px solid var(--brand);
    background: #eef2ff; color: #3730a3; border-radius: 0 6px 6px 0;
  }
  blockquote p { margin: 0; }
  hr { border: none; border-top: 1px solid var(--line); margin: 24px 0; }
  ul, ol { margin: 8px 0; padding-left: 22px; }
  li { margin: 3px 0; }
  h1, h2, h3 { page-break-after: avoid; }
</style>
</head>
<body>
  <div class="cover">
    <div class="brand">Same Day Solution Pvt. Ltd.</div>
    <h1>Partner Reconciliation API</h1>
    <p>Integration Guide &mdash; Transaction Status &amp; Reconciliation</p>
  </div>
  <div class="content">
    ${bodyHtml}
  </div>
</body>
</html>`

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })
  await page.pdf({
    path: PDF_PATH,
    format: 'A4',
    printBackground: true,
    margin: { top: '14mm', bottom: '16mm', left: '0mm', right: '0mm' },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#9ca3af;padding:0 14mm;display:flex;justify-content:space-between;">' +
      '<span>Partner Reconciliation API — Integration Guide</span>' +
      '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>' +
      '</div>',
  })
  console.log('✅ PDF written →', PDF_PATH)
} finally {
  await browser.close()
}
