/**
 * Canonical, user-facing status for Pay2New / Credit-Card (BBPS-2 & Rechargekit)
 * transactions shown in REPORTS and ledgers.
 *
 * WHY THIS EXISTS: the wallet ledger stores the DEBIT row's bookkeeping status as
 * 'completed' (meaning "the debit entry posted"), which is NOT the payment's real
 * outcome. Showing "completed" to partners is misleading — a failed/refunded or a
 * still-pending bill both read "completed". This resolver maps a row to the EXACT
 * Pay2New lifecycle status (success / failed / pending / refunded) using only
 * local signals (no provider call), and NEVER returns the word "completed".
 *
 * Signals, in order of trust:
 *   1. authoritative  — pay2new_transactions.status (source of truth when present)
 *   2. hasRefund      — a REFUND_<ref> exists (and was not clawed back) => refunded
 *   3. rawStatus==='failed' — recon already flipped the debit => failed
 *   4. hasOrderId     — OrderID:/ReconVerified stamped by pay/recon => success
 *   5. otherwise      — genuinely unconfirmed => pending  (the recon cron will
 *                       stamp an OrderID once it verifies SUCCESS with the vendor,
 *                       at which point the row flips to success automatically)
 */

export type Pay2NewReportStatus = 'success' | 'failed' | 'pending' | 'refunded'

const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase()

export function derivePay2NewReportStatus(input: {
  rawStatus?: string | null
  authoritative?: string | null
  hasOrderId?: boolean
  hasRefund?: boolean
  hasClawback?: boolean
}): Pay2NewReportStatus {
  // 1) Authoritative transaction record wins outright.
  const a = norm(input.authoritative)
  if (a === 'success') return 'success'
  if (a === 'refunded') return 'refunded'
  if (a === 'failed') return 'failed'
  if (a === 'pending' || a === 'initiated' || a === 'processing') return 'pending'

  // 2) A refund that was NOT reversed by a clawback => money returned.
  if (input.hasRefund && !input.hasClawback) return 'refunded'

  // 3) Recon/pay flipped the debit row itself to failed.
  if (norm(input.rawStatus) === 'failed') return 'failed'

  // 4) A recorded order id (or ReconVerified marker) proves a confirmed success.
  if (input.hasOrderId) return 'success'

  // 5) Unconfirmed — never "completed". The recon cron converges this to success
  //    (stamps OrderID) or failed/refunded as it verifies with the vendor.
  return 'pending'
}

/**
 * Convenience: detect the "confirmed success" stamp in a ledger description.
 * The pay route stores `OrderID:<id>` and the recon cron stamps `ReconVerified`.
 */
export function hasPay2NewOrderStamp(description?: string | null): boolean {
  const d = description || ''
  return /OrderID:/i.test(d) || /ReconVerified/i.test(d)
}
