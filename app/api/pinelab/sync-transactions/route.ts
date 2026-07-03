import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PINELAB_TEST_BASE = 'https://api-ct.pinelabs.com'
const PINELAB_PROD_BASE = 'https://api-c.pinelabs.com'

interface PinelabMerchantConfig {
  merchantName: string
  clientId: string
  clientSecret: string
  env: 'test' | 'production'
  storeIds?: string[]
  tids?: string[]
}

function getPinelabConfig(): Record<string, PinelabMerchantConfig> {
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

interface PinelabTransaction {
  transactionId: string
  txnStatus: string
  authTransactionAmount?: string
  transactionDate: string
  posId?: string
  batchStatus?: string
  storeName?: string
  city?: string
  hardwareModel?: string
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
    discountAmount2?: string
  }
}

interface SyncResult {
  merchant: string
  fetched: number
  created: number
  updated: number
  skipped: number
  errors: string[]
}

async function fetchTransactions(
  baseUrl: string,
  authHeader: string,
  fromDate: string,
  toDate: string,
  paymentMode?: string,
  page = 0,
  size = 500
): Promise<{ transactions: PinelabTransaction[]; totalPages: number; totalCount: number }> {
  const url = `${baseUrl}/transactions/summary?page=${page}&size=${size}`

  const body: any = {
    fromDate,
    toDate,
    txnStatus: ['SUCCESS', 'FAILED'],
  }
  if (paymentMode) body.paymentMode = paymentMode

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Pinelab API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  return {
    transactions: data.transactions || [],
    totalPages: parseInt(data.totalPages || '0', 10),
    totalCount: data.totalCount || 0,
  }
}

function mapStatus(txnStatus: string): { status: string; displayStatus: string } {
  const s = (txnStatus || '').toUpperCase()
  if (s === 'SUCCESS') return { status: 'AUTHORIZED', displayStatus: 'SUCCESS' }
  if (s === 'FAILED') return { status: 'FAILED', displayStatus: 'FAILED' }
  if (s === 'CANCELLED') return { status: 'CANCELLED', displayStatus: 'FAILED' }
  if (s === 'PENDING' || s === 'SESSION_EXPIRED') return { status: 'PENDING', displayStatus: 'PENDING' }
  return { status: 'PENDING', displayStatus: 'PENDING' }
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

  return {
    txn_id: `PL_${txn.transactionId}`,
    status,
    display_status: displayStatus,
    amount: amount || 0,
    payment_mode: paymentMode,
    device_serial: txn.tid || txn.posId || null,
    tid: txn.tid || null,
    merchant_name: merchantName,
    merchant_slug: merchantSlug,
    transaction_time: transactionTime.toISOString(),
    raw_data: { ...txn, _source: 'pinelab_sync', _brand: 'PINELAB' },
    customer_name: null,
    payer_name: null,
    username: null,
    txn_type: txn.txnType || 'SALE',
    auth_code: txn.authCode || null,
    card_number: ad.pan || null,
    issuing_bank: ad.cardIssuer || null,
    card_classification: null,
    mid_code: txn.mid || null,
    card_brand: ad.cardNetwork || null,
    card_type: ad.cardType || null,
    currency: txn.currency === 'DCC_INR' ? 'INR' : txn.currency || 'INR',
    rrn: txn.rrn || null,
    external_ref: txn.externalBillingId !== 'null' ? txn.externalBillingId : null,
    settlement_status: displayStatus === 'SUCCESS' ? 'PENDING' : null,
    receipt_url: null,
    posting_date: transactionTime.toISOString(),
    card_txn_type: ad.isContactless === 'Yes' ? 'CONTACTLESS' : null,
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

  const paymentModes = ['CARD', 'UPI']

  for (const mode of paymentModes) {
    let page = 0
    let totalPages = 1

    while (page < totalPages) {
      try {
        const resp = await fetchTransactions(baseUrl, authHeader, fromDate, toDate, mode, page)
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

              // Map device to retailer if successful
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
        result.errors.push(`${mode} page ${page}: ${err.message}`)
        break
      }
    }
  }

  return result
}

/**
 * POST /api/pinelab/sync-transactions
 * Body (optional): { merchants?: string[], fromDate?: string, toDate?: string }
 * Header: x-cron-secret must match CRON_SECRET env var
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const headerSecret = request.headers.get('x-cron-secret')

  if (cronSecret && headerSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const config = getPinelabConfig()
  if (Object.keys(config).length === 0) {
    return NextResponse.json(
      { error: 'PINELAB_MERCHANTS_CONFIG not set or empty' },
      { status: 500 }
    )
  }

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    // empty body is fine
  }

  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const fromDate = body.fromDate || defaultFrom.toISOString().replace('Z', '').split('.')[0]
  const toDate = body.toDate || now.toISOString().replace('Z', '').split('.')[0]

  const merchantFilter: string[] | undefined = body.merchants
  const results: SyncResult[] = []

  for (const [slug, merchantConfig] of Object.entries(config)) {
    if (merchantFilter && !merchantFilter.includes(slug)) continue

    console.log(`[PinelabSync] Syncing ${slug} (${merchantConfig.merchantName}) from ${fromDate} to ${toDate}`)

    try {
      const syncResult = await syncMerchant(slug, merchantConfig, fromDate, toDate)
      results.push(syncResult)
      console.log(
        `[PinelabSync] ${slug}: fetched=${syncResult.fetched} created=${syncResult.created} updated=${syncResult.updated} skipped=${syncResult.skipped} errors=${syncResult.errors.length}`
      )
    } catch (err: any) {
      results.push({
        merchant: slug,
        fetched: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [err.message],
      })
    }
  }

  return NextResponse.json({
    success: true,
    syncedAt: now.toISOString(),
    fromDate,
    toDate,
    results,
  })
}

export async function GET(request: NextRequest) {
  const config = getPinelabConfig()
  return NextResponse.json({
    message: 'Pinelab Transaction Sync endpoint',
    configuredMerchants: Object.keys(config),
    status: Object.keys(config).length > 0 ? 'configured' : 'not_configured',
    usage: 'POST with x-cron-secret header. Optional body: { merchants?, fromDate?, toDate? }',
  })
}
