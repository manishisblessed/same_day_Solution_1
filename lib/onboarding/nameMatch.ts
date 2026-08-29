/**
 * Fuzzy person/business name matching for cross-verifying KYC steps.
 *
 * eKYC providers return names in inconsistent shapes (initials, joined middle
 * names, reordered tokens, titles, punctuation). We normalise aggressively and
 * accept a match when either the token sets overlap strongly OR the compacted
 * strings are near-identical. Pure TS — usable on server and client.
 */

const TITLES = new Set([
  'MR', 'MRS', 'MS', 'MISS', 'DR', 'SHRI', 'SMT', 'SRI', 'KUMARI', 'M/S', 'MS.', 'MESSRS',
])

export function normalizeName(input?: string | null): string {
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameTokens(input?: string | null): string[] {
  return normalizeName(input)
    .split(' ')
    .filter((t) => t.length > 1 && !TITLES.has(t))
}

function compact(input?: string | null): string {
  return normalizeName(input).replace(/\s+/g, '')
}

/** Levenshtein ratio (0..1) — 1 means identical. */
function similarity(a: string, b: string): number {
  if (!a && !b) return 1
  if (!a || !b) return 0
  if (a === b) return 1
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => i)
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i]
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      prev = tmp
    }
  }
  const dist = dp[m]
  return 1 - dist / Math.max(m, n)
}

export interface NameMatchResult {
  match: boolean
  score: number
}

/**
 * Returns whether two names plausibly belong to the same entity.
 * Handles reordering (token overlap) and joined/misspelled variants
 * (compacted Levenshtein similarity).
 */
export function namesMatch(a?: string | null, b?: string | null): NameMatchResult {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return { match: false, score: 0 }
  if (na === nb) return { match: true, score: 1 }

  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (!ta.length || !tb.length) return { match: false, score: 0 }

  const setA = new Set(ta)
  const setB = new Set(tb)
  let common = 0
  for (const t of setA) if (setB.has(t)) common++
  const minSize = Math.min(setA.size, setB.size)
  const tokenScore = common / minSize

  // Compacted whole-string similarity catches "MANISH KUMAR" vs "MANISHKUMAR"
  // and small spelling differences.
  const compactScore = similarity(compact(a), compact(b))

  const score = Math.max(tokenScore, compactScore)

  const match =
    (common >= 2 && tokenScore >= 0.6) || // multiple shared name parts
    (common === minSize && minSize >= 2) || // all parts of the shorter name present
    compactScore >= 0.86 // near-identical joined strings

  return { match, score }
}
