/**
 * Remove the internal charge/GST breakdown from a transaction description.
 * e.g. "CC ₹34220 + ₹29.5 GST | INDUSIND CREDIT CARD | Card:4140"
 *   ->  "CC ₹34220 | INDUSIND CREDIT CARD | Card:4140"
 */
export function cleanDescription<T extends string | null | undefined>(desc: T): T {
  if (!desc) return desc
  return desc
    .replace(/\s*\+\s*₹?[\d.,]+\s*(?:GST|charge)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() as T
}

/**
 * Extract bank/card name from a CC bill-payment description.
 * e.g. "CC-2 (RechargeKit) ₹49999 + ₹23.6 charge | SBI Credit Card | Card:****9081"
 *   -> "SBI Credit Card"
 */
export function parseBankName(desc?: string | null): string | null {
  if (!desc) return null
  const segments = desc.split('|').map(s => s.trim())
  if (segments.length >= 2 && !segments[1].includes(':')) {
    return segments[1]
  }
  return null
}

/**
 * Extract the base bill/transfer amount (excluding charges/GST) from a
 * credit-card bill-payment description like "CC ₹49900 + ₹30 charge | ...".
 * Returns null when the description isn't a CC bill-payment entry.
 */
export function parseBillAmount(desc?: string | null): number | null {
  if (!desc) return null
  const m = desc.match(/^\s*CC(?:-2)?\s*₹?\s*([\d,]+(?:\.\d+)?)/i)
  if (!m) return null
  const n = parseFloat(m[1].replace(/,/g, ''))
  return isNaN(n) ? null : n
}
