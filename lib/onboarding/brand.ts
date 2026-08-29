import fs from 'fs'
import path from 'path'

let cachedLogo: string | null = null

/**
 * Read the company logo once and return it as a base64 data URL so it can be
 * embedded directly in self-contained PDF/HTML (Puppeteer loads no external
 * assets). Returns null if the file can't be read.
 */
export function getLogoDataUrl(): string | null {
  if (cachedLogo !== null) return cachedLogo || null
  try {
    const p = path.join(process.cwd(), 'public', 'LOGO_Same_Day copy.jpeg')
    const buf = fs.readFileSync(p)
    cachedLogo = `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    cachedLogo = ''
  }
  return cachedLogo || null
}
