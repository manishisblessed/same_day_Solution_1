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
  size = 500
): Promise<{ transactions: PinelabTransaction[]; totalPages: number; totalCount: number }> {
  const url = `${baseUrl}/transactions/summary?page=${page}&size=${size}`
  const bodyStr = JSON.stringify({ fromDate, toDate })

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

function mapStatus(txnStatus: string): { status: string; displayStatus: string } {
  const s = (txnStatus || '').toUpperCase()
  if (s === 'SUCCESS') return { status: 'AUTHORIZED', displayStatus: 'SUCCESS' }
  if (s === 'FAILED') return { status: 'FAILED', displayStatus: 'FAILED' }
  if (s === 'CANCELLED') return { status: 'CANCELLED', displayStatus: 'FAILED' }
  return { status: 'PENDING', displayStatus: 'PENDING' }
}

function cleanNull(val: string | undefined | null): string | null {
  if (!val || val === 'null' || val === 'INVALID') return null
  return val
}

function mapToDbRecord(txn: PinelabTransaction, merchantSlug: string, merchantName: string) {
  const { status, displayStatus } = mapStatus(txn.txnStatus)
  const amount = parseFloat(txn.amount || txn.authTransactionAmount || '0')
  const ad = txn.additionalDetails || {}

  let transactionTime = new Date()
  if (txn.transactionDate) {
    const parsed = new Date(txn.transactionDate.replace(' ', 'T'))
    if (!isNaN(parsed.getTime())) transactionTime = parsed
  }

  const paymentMode = (txn.paymentMode || 'CARD').toUpperCase()
  const customerName = txn.name || txn.upiPayerName || ad.cardIssuer || null
  const cardNumber = txn.upiPayerVpa || ad.pan || null

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
    card_brand: ad.cardNetwork || null,
    card_type: ad.cardType || null,
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
  }
}

async function syncMerchant(
  merchantSlug: string,
  config: PinelabMerchantConfig,
  fromDate: string,
  toDate: string
): Promise<SyncResult> {
  const result: SyncResult = { merchant: merchantSlug, fetched: 0, created: 0, updated: 0, skipped: 0, errors: [] }
  const supabase = getSupabaseAdmin()
  const baseUrl = getBaseUrl(config.env)
  const authHeader = buildAuthHeader(config.clientId, config.clientSecret)

  let page = 0
  let totalPages = 1

  while (page < totalPages) {
    try {
      const resp = await fetchTransactions(baseUrl, authHeader, fromDate, toDate, page)
      totalPages = resp.totalPages
      result.fetched += resp.transactions.length

      for (const txn of resp.transactions) {
        if (!txn.transactionId) {
          result.skipped++
          continue
        }

        const prefixedId = `PL_${txn.transactionId}`

        const { data: existing } = await supabase
          .from('razorpay_pos_transactions')
          .select('id, status, display_status')
          .eq('txn_id', prefixedId)
          .maybeSingle()

        const dbRecord = mapToDbRecord(txn, merchantSlug, config.merchantName)

        if (existing) {
          const statusChanged =
            existing.status !== dbRecord.status ||
            existing.display_status !== dbRecord.display_status

          if (statusChanged) {
            const { error } = await supabase
              .from('razorpay_pos_transactions')
              .update({ ...dbRecord, updated_at: new Date().toISOString() })
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
          const { error } = await supabase
            .from('razorpay_pos_transactions')
            .insert(dbRecord)

          if (error) {
            result.errors.push(`Insert ${prefixedId}: ${error.message}`)
          } else {
            result.created++

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
      }

      page++
    } catch (err: any) {
      result.errors.push(`page ${page}: ${err.message}`)
      break
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
        fetched: 0, created: 0, updated: 0, skipped: 0,
        errors: [err.message],
      })
    }
  }

  return { success: true, fromDate, toDate, results }
}
