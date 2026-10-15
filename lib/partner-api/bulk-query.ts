/**
 * Shared input parsing + validation for partner BULK status / reconciliation
 * endpoints (Pay2New bill payments, Settlement-2 account transfers, summary).
 *
 * All bulk endpoints accept the same date-range + pagination contract so the
 * partner integrates one consistent shape across services.
 */

/** Max span a single bulk query may cover (keeps result sets bounded). */
export const BULK_MAX_RANGE_DAYS = 92
/** Hard cap on page size. */
export const BULK_MAX_PAGE_SIZE = 200
/** Default page size when the caller omits it. */
export const BULK_DEFAULT_PAGE_SIZE = 50

export interface BulkRangeParams {
  /** Inclusive start of range, ISO timestamp (UTC). */
  fromISO: string
  /** Inclusive end of range, ISO timestamp (UTC). */
  toISO: string
  page: number
  pageSize: number
  /** Zero-based offset derived from page/pageSize. */
  offset: number
}

export interface BulkRangeError {
  code: string
  message: string
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse { from_date, to_date, page, page_size } from a request body.
 *
 * Accepts either a date-only string (YYYY-MM-DD) or a full ISO timestamp.
 * A date-only `from_date` snaps to 00:00:00.000Z and `to_date` to
 * 23:59:59.999Z so a single calendar day is fully inclusive.
 */
export function parseBulkRange(body: Record<string, unknown>): {
  params?: BulkRangeParams
  error?: BulkRangeError
} {
  const fromRaw = body.from_date
  const toRaw = body.to_date

  if (!fromRaw || !toRaw) {
    return { error: { code: 'BAD_REQUEST', message: 'from_date and to_date are required (YYYY-MM-DD or ISO timestamp)' } }
  }

  const fromStr = String(fromRaw).trim()
  const toStr = String(toRaw).trim()

  const fromDate = DATE_ONLY_RE.test(fromStr) ? new Date(`${fromStr}T00:00:00.000Z`) : new Date(fromStr)
  const toDate = DATE_ONLY_RE.test(toStr) ? new Date(`${toStr}T23:59:59.999Z`) : new Date(toStr)

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return { error: { code: 'BAD_REQUEST', message: 'Invalid from_date or to_date. Use YYYY-MM-DD or ISO 8601.' } }
  }

  if (fromDate.getTime() > toDate.getTime()) {
    return { error: { code: 'BAD_REQUEST', message: 'from_date must be on or before to_date' } }
  }

  const spanDays = (toDate.getTime() - fromDate.getTime()) / 86_400_000
  if (spanDays > BULK_MAX_RANGE_DAYS) {
    return { error: { code: 'RANGE_TOO_LARGE', message: `Date range cannot exceed ${BULK_MAX_RANGE_DAYS} days. Split into smaller windows.` } }
  }

  let page = Number(body.page)
  if (!Number.isFinite(page) || page < 1) page = 1
  page = Math.floor(page)

  let pageSize = Number(body.page_size)
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = BULK_DEFAULT_PAGE_SIZE
  pageSize = Math.min(Math.floor(pageSize), BULK_MAX_PAGE_SIZE)

  return {
    params: {
      fromISO: fromDate.toISOString(),
      toISO: toDate.toISOString(),
      page,
      pageSize,
      offset: (page - 1) * pageSize,
    },
  }
}

/** Build the standard pagination block returned by every bulk endpoint. */
export function buildPagination(page: number, pageSize: number, total: number) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)
  return {
    page,
    page_size: pageSize,
    total_records: total,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_prev: page > 1,
  }
}
