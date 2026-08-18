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
  /insufficient/i,
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
