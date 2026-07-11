import type { Browser, PDFOptions } from 'puppeteer-core'

/**
 * HTML → PDF rendering via Puppeteer (headless Chrome).
 *
 * Usage:
 *   const pdf = await htmlToPdf('<html>…</html>', { landscape: true })
 *   if (pdf) return new NextResponse(pdf, { headers: { 'Content-Type': 'application/pdf' } })
 *
 * Environment support:
 * - EC2 / local / Docker: full `puppeteer` with the Chrome downloaded at `npm install`.
 * - AWS Lambda / Amplify SSR / Vercel: `puppeteer-core` + `@sparticuz/chromium`
 *   (Lambda-compatible Chromium build), detected automatically.
 *
 * Returns null when no browser can be launched, so callers can fall back to
 * another format instead of failing the request.
 *
 * To force a specific binary set PUPPETEER_EXECUTABLE_PATH.
 */

const isServerless = Boolean(
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.AWS_EXECUTION_ENV ||
  process.env.LAMBDA_TASK_ROOT ||
  process.env.VERCEL
)

let browserPromise: Promise<Browser> | null = null

async function launchBrowser(): Promise<Browser> {
  if (isServerless) {
    // Lambda / Amplify SSR: use the slim Chromium build shipped as an npm package
    const chromium = (await import('@sparticuz/chromium')).default
    const puppeteerCore = (await import('puppeteer-core')).default
    return puppeteerCore.launch({
      headless: true,
      args: chromium.args,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (await chromium.executablePath()),
      defaultViewport: { width: 1280, height: 800 },
    }) as unknown as Browser
  }

  // EC2 / local / Docker: full puppeteer with its managed Chrome
  // Dynamic require avoids webpack bundling this dev-only dependency (Amplify SSR uses puppeteer-core)
  const puppeteer = (await import(/* webpackIgnore: true */ 'puppeteer')).default
  return puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const browser = await launchBrowser()
      // If Chrome crashes or is closed, allow a fresh launch next time
      browser.on('disconnected', () => {
        browserPromise = null
      })
      return browser
    })()
    browserPromise.catch(() => {
      browserPromise = null
    })
  }
  return browserPromise
}

export interface HtmlToPdfOptions {
  landscape?: boolean
  format?: PDFOptions['format']
  /** margin on all sides, e.g. '10mm' (default) */
  margin?: string
}

export async function htmlToPdf(html: string, options: HtmlToPdfOptions = {}): Promise<Buffer | null> {
  const { landscape = false, format = 'A4', margin = '10mm' } = options
  try {
    const browser = await getBrowser()
    const page = await browser.newPage()
    try {
      // Report HTML is self-contained (inline styles, no external assets), 'load' is sufficient
      await page.setContent(html, { waitUntil: 'load', timeout: 30000 })
      const pdf = await page.pdf({
        format,
        landscape,
        printBackground: true,
        margin: { top: margin, right: margin, bottom: margin, left: margin },
      })
      return Buffer.from(pdf)
    } finally {
      await page.close().catch(() => {})
    }
  } catch (err) {
    console.error('[htmlToPdf] PDF generation failed, caller should fall back:', err)
    return null
  }
}
