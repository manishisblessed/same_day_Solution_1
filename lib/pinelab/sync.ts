import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

const PINELAB_TEST_BASE = 'https://api-ct.pinelabs.com'
const PINELAB_PROD_BASE = 'https://api-c.pinelabs.com'

export interface PinelabMerchantConfig {
  merchantName: string
  clientId: string
  clientSecret: string
  env: 'test' | 'production'
  storeIds?: string[]
  tids?: string[]
}

export interface SyncResult {
  merchant: string
  fetched: number
  created: number
  updated: number
  skipped: number
  reversed: number
  errors: string[]
}

interface PinelabTransaction {
  transactionId: string
  txnStatus: string
  authTransactionAmount?: string
  transactionDate: string
  posId?: string
  batchStatus?: string
  settlementDate?: string
  storeName?: string
  city?: string
  hardwareModel?: string
  hardwareId?: string
  acquirer?: string
  tid?: string
  mid?: string
  batchNo?: string
  paymentMode?: string
  txnType?: string
  amount?: string
  currency?: string
  authCode?: string
  rrn?: string
  externalBillingId?: string
  storeId?: string
  cloudRefId?: number
  zone?: string
  name?: string
  upiPayerName?: string
  upiPayerVpa?: string
  cardColour?: string
  contactlessMode?: string
  additionalDetails?: {
    cardType?: string
    cardNetwork?: string
    cardIssuer?: string
    isEmiTxn?: string
    isContactless?: string
    discountAmount?: number
    pan?: string
    merchantVpa?: string
    payMode?: string
    externalTransactionId?: string
    isPartiallyRefunded?: string
    grossAmount?: string
    netAmount?: string
  }
}

export function getPinelabConfig(): Record<string, PinelabMerchantConfig> {
  const raw = process.env.PINELAB_MERCHANTS_CONFIG
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    console.error('[PinelabSync] Invalid PINELAB_MERCHANTS_CONFIG JSON')
    return {}
  }
}

function getBaseUrl(env: 'test' | 'production'): string {
  return env === 'production' ? PINELAB_PROD_BASE : PINELAB_TEST_BASE
}

function buildAuthHeader(clientId: string, clientSecret: string): string {
  const token = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  return `Basic ${token}`
}

async function fetchTransactions(
  baseUrl: string,
  authHeader: string,
  fromDate: string,
  toDate: string,
  page = 0,
  size = 500,
  paymentMode?: string
): Promise<{ transactions: PinelabTransaction[]; totalPages: number; totalCount: number }> {
  const url = `${baseUrl}/transactions/summary?page=${page}&size=${size}`
  // Pinelab omits `additionalDetails` (cardType/cardNetwork/cardIssuer) unless
  // paymentMode is set on the request — verified vs their support reply Jul 2026.
  // Note: txnStatus is NOT a valid request filter (API returns 500); we filter
  // SUCCESS-only in syncMerchant after fetch.
  const body: Record<string, string> = { fromDate, toDate }
  if (paymentMode) body.paymentMode = paymentMode
  const bodyStr = JSON.stringify(body)

  let lastError: Error | null = null

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt))

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(30000),
        cache: 'no-store',
      } as any)

      if (res.ok) {
        const data = await res.json()
        return {
          transactions: data.transactions || [],
          totalPages: parseInt(data.totalPages || '0', 10),
          totalCount: data.totalCount || 0,
        }
      }

      const errText = await res.text().catch(() => '')
      lastError = new Error(`Pinelab API error ${res.status}: ${errText}`)

      if (res.status !== 500) break
    } catch (err: any) {
      lastError = err
    }
  }

  throw lastError || new Error('Pinelab API fetch failed')
}

/**
 * Fetch every Pinelab transaction in a window for one merchant, deduped across
 * the CARD/UPI/catch-all passes. Exposed for the reversal backfill script.
 */
export async function fetchPinelabTransactionsForMerchant(
  config: PinelabMerchantConfig,
  fromDate: string,
  toDate: string
): Promise<PinelabTransaction[]> {
  const baseUrl = getBaseUrl(config.env)
  const authHeader = buildAuthHeader(config.clientId, config.clientSecret)
  const modes: Array<string | undefined> = ['CARD', 'UPI', undefined]
  const seen = new Set<string>()
  const out: PinelabTransaction[] = []
  for (const paymentMode of modes) {
    let page = 0
    let totalPages = 1
    while (page < totalPages) {
      const resp = await fetchTransactions(baseUrl, authHeader, fromDate, toDate, page, 500, paymentMode)
      totalPages = resp.totalPages
      for (const t of resp.transactions) {
        if (!t.transactionId || seen.has(t.transactionId)) continue
        seen.add(t.transactionId)
        out.push(t)
      }
      page++
    }
  }
  return out
}

export function mapStatus(txnStatus: string, txnType?: string): { status: string; displayStatus: string } {
  const s = (txnStatus || '').toUpperCase()
  const t = (txnType || '').toUpperCase()

  // Refunds/voids/reversals can arrive either as a txnStatus or a txnType.
  if (t.includes('REFUND') || s.includes('REFUND')) return { status: 'REFUNDED', displayStatus: 'REFUNDED' }
  if (t.includes('VOID') || t.includes('REVERS') || s.includes('VOID') || s.includes('REVERS')) {
    return { status: 'VOIDED', displayStatus: 'VOIDED' }
  }

  if (s === 'SUCCESS') return { status: 'AUTHORIZED', displayStatus: 'SUCCESS' }
  if (s === 'FAILED') return { status: 'FAILED', displayStatus: 'FAILED' }
  if (s === 'CANCELLED') return { status: 'CANCELLED', displayStatus: 'CANCELLED' }
  return { status: 'PENDING', displayStatus: 'PENDING' }
}

/** display_status values that represent a terminal reversal of a captured txn. */
export const REVERSAL_DISPLAY_STATUSES = ['VOIDED', 'REFUNDED']

function cleanNull(val: string | undefined | null): string | null {
  if (!val || val === 'null' || val === 'INVALID') return null
  return val
}

// Pinelab returns datetimes as IST (Asia/Kolkata) wall-clock strings with no
// timezone, e.g. "2026-07-04 23:46:17.313". Parsing them with `new Date()`
// uses the server's local timezone (UTC on EC2), which shifts the stored
// instant by 5h30m. Explicitly interpret them as IST (+05:30) so the true
// UTC instant is stored regardless of server timezone.
function parseIstDate(raw: string): Date | null {
  const normalized = raw.trim().replace(' ', 'T')
  const parsed = new Date(`${normalized}+05:30`)
  return isNaN(parsed.getTime()) ? null : parsed
}

export function mapToDbRecord(txn: PinelabTransaction, merchantSlug: string, merchantName: string) {
  const { status, displayStatus } = mapStatus(txn.txnStatus, txn.txnType)
  const isReversal = REVERSAL_DISPLAY_STATUSES.includes(displayStatus)
  const amount = parseFloat(txn.amount || txn.authTransactionAmount || '0')
  const ad = txn.additionalDetails || {}

  let transactionTime = new Date()
  if (txn.transactionDate) {
    const parsed = parseIstDate(txn.transactionDate)
    if (parsed) transactionTime = parsed
  }

  const paymentMode = (txn.paymentMode || 'CARD').toUpperCase()
  const customerName = txn.name || txn.upiPayerName || ad.cardIssuer || null
  const cardNumber = txn.upiPayerVpa || ad.pan || null

  // Prefer additionalDetails; fall back to cardColour (e.g. "Visa Rewards" → VISA)
  // when Pinelab omits additionalDetails (unfiltered summary responses).
  let cardBrand = ad.cardNetwork ? String(ad.cardNetwork).trim() : null
  if (!cardBrand && txn.cardColour) {
    const colour = String(txn.cardColour).toUpperCase()
    if (colour.includes('VISA')) cardBrand = 'VISA'
    else if (colour.includes('MASTER') || colour.includes('MAESTRO')) cardBrand = 'MASTERCARD'
    else if (colour.includes('RUPAY') || colour.includes('RU PAY')) cardBrand = 'RUPAY'
    else if (colour.includes('AMEX') || colour.includes('AMERICAN')) cardBrand = 'AMEX'
    else if (colour.includes('DINERS')) cardBrand = 'DINERS'
  }

  return {
    txn_id: `PL_${txn.transactionId}`,
    status,
    display_status: displayStatus,
    amount: amount || 0,
    payment_mode: paymentMode,
    device_serial: txn.hardwareId || txn.tid || txn.posId || null,
    tid: txn.tid || null,
    merchant_name: merchantName,
    merchant_slug: merchantSlug,
    transaction_time: transactionTime.toISOString(),
    raw_data: { ...txn, _source: 'pinelab_sync', _brand: 'PINELAB' },
    customer_name: customerName,
    payer_name: txn.upiPayerName || txn.name || null,
    username: null,
    txn_type: txn.txnType || 'SALE',
    auth_code: cleanNull(txn.authCode),
    card_number: cleanNull(cardNumber),
    issuing_bank: ad.cardIssuer || null,
    card_classification: cleanNull(txn.cardColour),
    mid_code: txn.mid || null,
    card_brand: cardBrand,
    card_type: ad.cardType ? String(ad.cardType).trim() : null,
    currency: (txn.currency === 'DCC_INR' || txn.currency === 'Rs.') ? 'INR' : txn.currency || 'INR',
    rrn: txn.rrn || null,
    external_ref: cleanNull(txn.externalBillingId),
    settlement_status: displayStatus === 'SUCCESS' ? 'PENDING' : null,
    receipt_url: null,
    posting_date: transactionTime.toISOString(),
    card_txn_type: cleanNull(txn.contactlessMode) || (ad.isContactless === 'Yes' ? 'CONTACTLESS' : null),
    acquiring_bank: txn.acquirer || null,
    settlement_type: 'T1',
    partner_id: null,
    reversed_at: isReversal ? transactionTime.toISOString() : null,
    reversal_reason: isReversal ? `pinelab:${txn.txnStatus || ''}${txn.txnType ? `/${txn.txnType}` : ''}` : null,
  }
}

/**
 * Propagate a captured→reversed transition to the owning partner via a signed
 * `pos.transaction.reversed` webhook. Best-effort; never throws.
 */
async function emitReversal(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  prefixedId: string,
  dbRecord: ReturnType<typeof mapToDbRecord>,
  existing: { partner_wallet_credited?: boolean | null; wallet_credited?: boolean | null },
  result: SyncResult
): Promise<void> {
  const wasSettled = !!(existing.partner_wallet_credited || existing.wallet_credited)
  if (wasSettled) {
    // Money already moved to a wallet — reversal requires a manual clawback.
    // We surface it loudly; automated debit is intentionally out of scope.
    console.warn(`[PinelabSync] REVERSAL AFTER SETTLEMENT — clawback needed txn=${prefixedId} amount=${dbRecord.amount}`)
    result.errors.push(`reversal-after-settlement:${prefixedId}`)
  }

  const reversalPayload = {
    event: 'pos.transaction.reversed',
    action: 'remove',
    txn_id: prefixedId,
    rrn: dbRecord.rrn,
    terminal_id: dbRecord.tid,
    tid: dbRecord.tid,
    device_serial: dbRecord.device_serial,
    mid: dbRecord.mid_code,
    amount: dbRecord.amount,
    previous_status: 'CAPTURED',
    status: dbRecord.display_status === 'REFUNDED' ? 'REFUNDED' : 'VOIDED',
    reversed_at: dbRecord.reversed_at,
    reason: dbRecord.reversal_reason,
    was_settled: wasSettled,
    _brand: 'PINELAB',
  }

  try {
    const { deliverPartnerReversal } = await import('@/lib/partner-webhook/deliver')
    await deliverPartnerReversal({
      supabase,
      tid: dbRecord.tid,
      deviceSerial: dbRecord.device_serial,
      txnId: prefixedId,
      payload: reversalPayload,
      logPrefix: 'Partner Reversal/pinelab',
    })
  } catch (err: any) {
    result.errors.push(`Reversal notify ${prefixedId}: ${err?.message || err}`)
  }
}

async function syncMerchant(
  merchantSlug: string,
  config: PinelabMerchantConfig,
  fromDate: string,
  toDate: string
): Promise<SyncResult> {
  const result: SyncResult = { merchant: merchantSlug, fetched: 0, created: 0, updated: 0, skipped: 0, reversed: 0, errors: [] }
  const supabase = getSupabaseAdmin()
  const baseUrl = getBaseUrl(config.env)
  const authHeader = buildAuthHeader(config.clientId, config.clientSecret)

  // Fetch CARD and UPI with paymentMode set so Pinelab returns additionalDetails.
  // Final catch-all (no paymentMode) picks up any other modes without double-counting.
  const modes: Array<string | undefined> = ['CARD', 'UPI', undefined]
  const seenTxnIds = new Set<string>()
  // Per-device partner resolution cache (avoids repeated lookups for devices
  // that have no partner across the whole sync window)
  const partnerDeviceCache = new Map<string, string | null>()

  // NOTE: We intentionally do NOT delete non-SUCCESS rows anymore. Voided/
  // reversed/refunded transactions are retained with a terminal status and
  // propagated to partners (see reversal handling below), so the Partner API
  // and dashboard stay consistent and reconciliation partners get a signal.

  for (const paymentMode of modes) {
    let page = 0
    let totalPages = 1

    while (page < totalPages) {
      try {
        const resp = await fetchTransactions(baseUrl, authHeader, fromDate, toDate, page, 500, paymentMode)
        totalPages = resp.totalPages
        result.fetched += resp.transactions.length

        for (const txn of resp.transactions) {
          if (!txn.transactionId) {
            result.skipped++
            continue
          }

          const prefixedId = `PL_${txn.transactionId}`

          // Catch-all pass: skip rows already processed via CARD/UPI filtered calls
          if (!paymentMode && seenTxnIds.has(prefixedId)) {
            result.skipped++
            continue
          }
          seenTxnIds.add(prefixedId)

          const dbRecord = mapToDbRecord(txn, merchantSlug, config.merchantName)
          const isReversal = REVERSAL_DISPLAY_STATUSES.includes(dbRecord.display_status)
          const isSuccess = dbRecord.display_status === 'SUCCESS'

          const { data: existing } = await supabase
            .from('razorpay_pos_transactions')
            .select('id, status, display_status, transaction_time, card_type, card_brand, issuing_bank, partner_id, partner_wallet_credited, wallet_credited, tid, device_serial, amount')
            .eq('txn_id', prefixedId)
            .maybeSingle()

          // ── Reversal / void / refund handling ──────────────────────────────
          // Previously these rows were hard-deleted (silent gap for partners).
          // Now we retain them with a terminal status and, when a transaction we
          // had recorded as SUCCESS transitions to reversed, notify the partner.
          if (isReversal) {
            if (existing) {
              const wasSuccess = existing.display_status === 'SUCCESS'
              const alreadyReversed = REVERSAL_DISPLAY_STATUSES.includes(existing.display_status)
              const { partner_id: _omitPartnerId, ...reversalUpdate } = dbRecord
              const { error: updErr } = await supabase
                .from('razorpay_pos_transactions')
                .update({ ...reversalUpdate, updated_at: new Date().toISOString() })
                .eq('txn_id', prefixedId)
              if (updErr) {
                result.errors.push(`Reverse ${prefixedId}: ${updErr.message}`)
              } else if (wasSuccess) {
                // True transition CAPTURED → reversed: propagate to the partner.
                result.reversed++
                await emitReversal(supabase, prefixedId, dbRecord, existing, result)
              } else if (!alreadyReversed) {
                result.updated++
              } else {
                result.skipped++
              }
            } else {
              // Never seen before and already reversed: store it as a terminal
              // record (visible as VOIDED/REFUNDED) but do not emit a reversal
              // event — the partner never received a capture for it.
              const { error: insErr } = await supabase
                .from('razorpay_pos_transactions')
                .insert(dbRecord)
              if (insErr) result.errors.push(`Insert reversed ${prefixedId}: ${insErr.message}`)
              else result.created++
            }
            continue
          }

          // Non-SUCCESS, non-reversal (FAILED / PENDING / CANCELLED): retain as-is.
          if (!isSuccess) {
            if (existing) {
              if (existing.display_status !== dbRecord.display_status) {
                const { partner_id: _omit, ...upd } = dbRecord
                const { error: e } = await supabase
                  .from('razorpay_pos_transactions')
                  .update({ ...upd, updated_at: new Date().toISOString() })
                  .eq('txn_id', prefixedId)
                if (e) result.errors.push(`Update ${prefixedId}: ${e.message}`)
                else result.updated++
              } else {
                result.skipped++
              }
            } else {
              const { error: e } = await supabase
                .from('razorpay_pos_transactions')
                .insert(dbRecord)
              if (e) result.errors.push(`Insert ${prefixedId}: ${e.message}`)
              else result.created++
            }
            continue
          }

          // Row id for partner attach/instant settlement below
          let rowId: string | null = existing?.id || null

          if (existing) {
            const statusChanged =
              existing.status !== dbRecord.status ||
              existing.display_status !== dbRecord.display_status

            const existingMs = existing.transaction_time ? new Date(existing.transaction_time).getTime() : 0
            const newMs = new Date(dbRecord.transaction_time).getTime()
            const timeChanged = Math.abs(existingMs - newMs) > 1000

            // Heal rows synced before we started requesting paymentMode (missing card fields)
            const cardEnriched =
              (!!dbRecord.card_type && dbRecord.card_type !== existing.card_type) ||
              (!!dbRecord.card_brand && dbRecord.card_brand !== existing.card_brand) ||
              (!!dbRecord.issuing_bank && dbRecord.issuing_bank !== existing.issuing_bank)

            if (statusChanged || timeChanged || cardEnriched) {
              // Never reset partner_id on updates (attached separately)
              const { partner_id: _omitPartnerId, ...updateRecord } = dbRecord
              const { error } = await supabase
                .from('razorpay_pos_transactions')
                .update({ ...updateRecord, updated_at: new Date().toISOString() })
                .eq('txn_id', prefixedId)

              if (error) {
                result.errors.push(`Update ${prefixedId}: ${error.message}`)
              } else {
                result.updated++
              }
            } else {
              result.skipped++
            }
          } else {
            const { data: inserted, error } = await supabase
              .from('razorpay_pos_transactions')
              .insert(dbRecord)
              .select('id')
              .single()

            if (error) {
              result.errors.push(`Insert ${prefixedId}: ${error.message}`)
            } else {
              result.created++
              rowId = inserted?.id || null

              if (dbRecord.display_status === 'SUCCESS' && dbRecord.device_serial && dbRecord.amount > 0) {
                const { data: deviceMapping } = await supabase
                  .from('pos_device_mapping')
                  .select('retailer_id, distributor_id, master_distributor_id')
                  .eq('device_serial', dbRecord.device_serial)
                  .eq('status', 'ACTIVE')
                  .maybeSingle()

                if (deviceMapping?.retailer_id) {
                  await supabase
                    .from('razorpay_pos_transactions')
                    .update({
                      retailer_id: deviceMapping.retailer_id,
                      distributor_id: deviceMapping.distributor_id,
                      master_distributor_id: deviceMapping.master_distributor_id,
                      gross_amount: dbRecord.amount,
                    })
                    .eq('txn_id', prefixedId)
                }
              }
            }
          }

          // Attach owning partner + instant settle if partner mode is INSTANT.
          // Runs for new rows and heals existing rows without a partner_id.
          if (
            rowId &&
            dbRecord.display_status === 'SUCCESS' &&
            dbRecord.amount > 0 &&
            !existing?.partner_id
          ) {
            try {
              const { attachPartnerAndMaybeInstantSettle } = await import('@/lib/partner-settlement')
              await attachPartnerAndMaybeInstantSettle(
                {
                  id: rowId,
                  txn_id: prefixedId,
                  amount: dbRecord.amount,
                  gross_amount: dbRecord.amount,
                  payment_mode: dbRecord.payment_mode,
                  card_type: dbRecord.card_type,
                  card_brand: dbRecord.card_brand,
                  merchant_slug: merchantSlug,
                  partner_id: null,
                },
                dbRecord.device_serial,
                dbRecord.tid,
                partnerDeviceCache
              )
            } catch (partnerErr: any) {
              result.errors.push(`Partner settle ${prefixedId}: ${partnerErr.message}`)
            }
          }
        }

        page++
      } catch (err: any) {
        result.errors.push(`${paymentMode || 'ALL'} page ${page}: ${err.message}`)
        break
      }
    }
  }

  return result
}

export async function runPinelabSync(opts?: {
  merchants?: string[]
  fromDate?: string
  toDate?: string
}): Promise<{ success: boolean; fromDate: string; toDate: string; results: SyncResult[] }> {
  const config = getPinelabConfig()
  if (Object.keys(config).length === 0) {
    throw new Error('PINELAB_MERCHANTS_CONFIG not set or empty')
  }

  // Pinelab interprets datetimes as IST (Asia/Kolkata, UTC+5:30), not UTC.
  // Build the window in IST and add a forward buffer so just-completed
  // transactions are never excluded by clock skew / TZ interpretation.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
  const toIstString = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().replace('Z', '').split('.')[0]

  const lookbackHours = parseInt(process.env.PINELAB_SYNC_LOOKBACK_HOURS || '48', 10)
  const now = new Date()
  const fromDate = opts?.fromDate || toIstString(new Date(now.getTime() - lookbackHours * 60 * 60 * 1000))
  const toDate = opts?.toDate || toIstString(new Date(now.getTime() + 6 * 60 * 60 * 1000))

  const results: SyncResult[] = []

  for (const [slug, merchantConfig] of Object.entries(config)) {
    if (opts?.merchants && !opts.merchants.includes(slug)) continue

    try {
      const syncResult = await syncMerchant(slug, merchantConfig, fromDate, toDate)
      results.push(syncResult)
    } catch (err: any) {
      results.push({
        merchant: slug,
        fetched: 0, created: 0, updated: 0, skipped: 0, reversed: 0,
        errors: [err.message],
      })
    }
  }

  return { success: true, fromDate, toDate, results }
}
