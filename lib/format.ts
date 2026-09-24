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
