/**
 * Provider-side infrastructure failures (Shadval Pay / Pay2New float running
 * low, their portal being down, timeouts, etc.) must never be shown raw to
 * retailers/partners — "insufficient balance" reads as their own wallet problem
 * and damages trust. Mask them as a service outage with our own message.
 *
 * Genuine transaction errors (invalid account number, wrong IFSC, beneficiary
 * bank rejected, etc.) are passed through unchanged.
 */

export const SERVICE_DOWN_MESSAGE =
  'This service is temporarily down. Please drop a message to the support team for an update.'

const PROVIDER_INFRA_PATTERNS: RegExp[] = [
  // Provider float / wallet balance problems
  // (matches "insufficient" and the common provider misspelling "insufficent")
  /insuffic[ie]*nt/i,
  /insufficent/i,
  /low\s*balance/i,
  /update\s+your\s+wallet/i,
  /wallet\s+balance/i,
  /not\s+enough\s+(funds|balance)/i,
  /balance\s+(is\s+)?(too\s+)?low/i,
  // Provider portal / service outages
  /portal\s+(is\s+)?down/i,
  /\b(server|service|system|gateway|api)\b.*\b(down|unavailable|not\s+available|not\s+respond)/i,
  /under\s+maintenance/i,
  /\bmaintenance\b/i,
  /temporarily\s+(down|unavailable|suspended)/i,
  /technical\s+(issue|error|problem|difficult)/i,
  /internal\s+server\s+error/i,
  /\bdowntime\b/i,
  // Network / connectivity failures between us and the provider
  /timeout|timed?\s*out/i,
  /network\s+error/i,
  /connection\s+(refused|reset|failed|error)/i,
  /HTML\s+error/i,
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET/i,
  /bad\s+gateway|service\s+unavailable|502|503/i,
]

/** Replace provider infra/balance error messages with our generic service-down message. */
export function maskProviderBalanceError(message?: string | null): string {
  const msg = (message || '').trim()
  if (!msg) return msg
  return PROVIDER_INFRA_PATTERNS.some((re) => re.test(msg)) ? SERVICE_DOWN_MESSAGE : msg
}

/**
 * Generic fallback for raw code / exception messages so users never see internal
 * technical detail (stack traces, DB errors, JS exceptions, HTML dumps, etc.).
 */
export const GENERIC_ERROR_MESSAGE =
  'Something went wrong while processing your request. Please try again, or contact the support team if it persists.'

// Signatures of raw technical / exception / infra messages that must never reach a user.
const TECHNICAL_PATTERNS: RegExp[] = [
  /\b(TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError)\b/,
  /\bError:\s/,
  /is\s+not\s+(a\s+function|defined)/i,
  /cannot\s+read\s+propert/i,
  /undefined|null\)/i,
  /\bat\s+\S+:\d+:\d+/, // stack-trace frame
  /ECONN\w*|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket\s+hang\s*up|fetch\s+failed/i,
  /\b(postgres|supabase|pg_|sql|sqlstate|constraint|duplicate\s+key|violates|relation\s+".*"\s+does\s+not\s+exist|column\s+.*does\s+not\s+exist)\b/i,
  /\[object\s+Object\]/i,
  /<\/?[a-z!][^>]*>/i, // HTML fragment
  /^\s*[[{]/, // raw JSON payload
  /HTTP\s+error\s+\d{3}|HTTP\s+\d{3}/i,
  /unexpected\s+token|json\s+parse|malformed/i,
]

/**
 * Convert any error string into something safe to show a user.
 *  - Provider infra / low-balance messages → SERVICE_DOWN_MESSAGE
 *  - Raw code / exception / DB / HTML / JSON messages → generic fallback
 *  - Otherwise (genuine business/transaction messages) → passed through unchanged
 * Always log the raw message server-side before calling this.
 */
export function toUserSafeError(message?: string | null, fallback: string = GENERIC_ERROR_MESSAGE): string {
  const msg = (message || '').trim()
  if (!msg) return fallback
  if (PROVIDER_INFRA_PATTERNS.some((re) => re.test(msg))) return SERVICE_DOWN_MESSAGE
  if (TECHNICAL_PATTERNS.some((re) => re.test(msg))) return fallback
  return msg
}

/**
 * Biller-side rate limiting (e.g. Pay2New "Too many requests for that Biller").
 * The bill_fetch_ref itself is valid — the biller has throttled fetch/pay calls.
 * Surface a clear, retryable message instead of the raw provider text.
 */
export const BILLER_RATE_LIMIT_MESSAGE =
  'This biller is temporarily busy and has rate-limited requests. Please wait a minute, fetch the bill again, and retry.'

const BILLER_RATE_LIMIT_PATTERN = /too\s+many\s+requests/i

export function isBillerRateLimitError(message?: string | null): boolean {
  return BILLER_RATE_LIMIT_PATTERN.test((message || '').trim())
}
