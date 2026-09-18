/**
 * KYC identity name-matching — shared by the client KYC form and server-side
 * enforcement so both use identical logic.
 */

/** Uppercase, strip honorifics & non-letters, collapse whitespace. */
export function normalizeName(name: string): string {
  return (name || '')
    .toUpperCase()
    .replace(/\b(MR|MRS|MS|MISS|SHRI|SHREE|SMT|DR|KUMARI|KM|LATE)\b\.?/g, '')
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy name equality for KYC. Matches when normalized strings are equal, when
 * the token multiset is equal (word-order agnostic), or when every token of the
 * shorter name is present in the longer one (handles missing/extra middle name).
 */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(' ').filter(Boolean).sort();
  const tb = nb.split(' ').filter(Boolean).sort();
  if (ta.length === tb.length && ta.every((t, i) => t === tb[i])) return true;
  const [small, bigSet] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return small.every((t) => bigSet.has(t));
}
