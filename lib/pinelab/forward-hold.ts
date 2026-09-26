/**
 * Forward-callback micro-hold (Phase 1 + Phase 4).
 *
 * Pine Labs' summary API reports `txnStatus=SUCCESS` at *authorization* time.
 * A subset of those auth-time successes auto-reverse seconds-to-minutes later
 * (terminal timeout → the acquirer auto-refunds the customer's card). If we
 * forward SUCCESS to a partner the instant we see it, an instant-settling
 * partner (e.g. ECAPS) pays their end-user before the reversal is known and
 * eats the loss.
 *
 * The fix is a short *confirmation hold*: do not forward a SUCCESS until the
 * transaction has survived `PINELAB_FORWARD_HOLD_SECONDS` (default 120s) still
 * reporting SUCCESS. Because the sync re-fetches the live Pine Labs status
 * every cycle, any txn that flips to FAILED inside the hold is caught by the
 * non-success branch and NEVER forwarded — the partner only ever hears about
 * transactions that held their SUCCESS past the window.
 *
 * Phase 4 (risk-based gating): the hold applies only to transactions at/above
 * `PINELAB_FORWARD_HOLD_MIN_AMOUNT` (default 0 → hold everything). Small-ticket
 * swipes below the threshold flow instantly, capping worst-case exposure while
 * keeping the common path real-time.
 *
 * This adds NO extra latency for already-aged transactions (backfills, retries,
 * the polling sync catching up) — it only defers callbacks for genuinely fresh
 * captures, by at most one hold window.
 */

const DEFAULT_HOLD_SECONDS = 120

/** Resolve the configured hold window in seconds (>= 0). */
export function getForwardHoldSeconds(): number {
  const raw = parseInt(process.env.PINELAB_FORWARD_HOLD_SECONDS || String(DEFAULT_HOLD_SECONDS), 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

/** Amount at/above which the hold applies. Below it, forward instantly. */
export function getForwardHoldMinAmount(): number {
  const raw = parseFloat(process.env.PINELAB_FORWARD_HOLD_MIN_AMOUNT || '0')
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

/**
 * Should we HOLD (defer) forwarding this fresh SUCCESS this cycle?
 *
 * Returns true when the transaction is younger than the hold window AND its
 * amount is in-scope for holding. A held transaction is simply not claimed/sent
 * now; a later sync cycle forwards it once it has aged past the window (still
 * SUCCESS) — or the reversal path fires instead if it flipped.
 *
 * @param transactionTime ISO-8601 capture time of the transaction.
 * @param amount          Transaction amount (for the risk-based threshold).
 * @param now             Millis "now" (injectable for tests).
 */
export function shouldHoldForward(
  transactionTime: string | null | undefined,
  amount: number | null | undefined,
  now: number = Date.now()
): boolean {
  const holdSeconds = getForwardHoldSeconds()
  if (holdSeconds <= 0) return false // hold disabled

  const minAmount = getForwardHoldMinAmount()
  const amt = typeof amount === 'number' ? amount : parseFloat(String(amount ?? 0)) || 0
  if (minAmount > 0 && amt < minAmount) return false // small-ticket → instant

  if (!transactionTime) return false // no timestamp → don't block delivery
  const capturedMs = new Date(transactionTime).getTime()
  if (!Number.isFinite(capturedMs)) return false

  const ageSeconds = (now - capturedMs) / 1000
  return ageSeconds < holdSeconds
}
