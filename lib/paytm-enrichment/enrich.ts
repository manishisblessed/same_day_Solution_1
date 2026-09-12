import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { fetchPaytmStatusBody } from '@/lib/paytm'

/**
 * Paytm ECR card-detail enrichment.
 *
 * The Paytm S2S callback omits card scheme/type/category, which the settlement
 * engine needs to resolve the MDR slab. Paytm confirmed those fields are only
 * available via the Status Enquiry API (/ecr/V2/payment/status), keyed on our
 * merchantTransactionId. This module fetches them for stored Paytm card rows
 * and writes the normalized values back so the T+1 settlement can match a rate.
 *
 * Enrichment ONLY. It never touches settlement/wallet fields — the existing
 * T+1 cron settles the row (and auto-resolves its "MDR missing" alert) on the
 * next pass once card_type/card_brand are present.
 */

export interface EnrichOptions {
  /** Max rows to process in one run. */
  limit?: number
  /** Skip rows enriched-attempted within this many minutes (backoff). */
  cooldownMinutes?: number
  /** Give up after this many failed attempts per row. */
  maxAttempts?: number
  /** Delay between Paytm calls (ms) to avoid rate limits. */
  delayMs?: number
}

export interface EnrichResult {
  scanned: number
  enriched: number
  noData: number
  errors: number
  details: Array<{ txn_id: string; status: 'enriched' | 'no_data' | 'error'; card_type?: string | null; card_brand?: string | null; error?: string }>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Normalize Paytm's card fields to the canonical values the MDR matcher expects.
 * IMPORTANT: normalizeCardType() treats "CREDIT_CARD" as unknown (→ null), so we
 * MUST strip the "_CARD" suffix here and store "CREDIT" / "DEBIT" / "PREPAID".
 */
export function normalizePaytmCardFields(body: Record<string, any>): {
  card_type: string | null
  card_brand: string | null
  card_classification: string | null
  payMethodIsCard: boolean
} {
  const rawType = (body.cardType || body.payMethod || '').toString().toUpperCase()
  let card_type: string | null = null
  if (rawType.includes('CREDIT')) card_type = 'CREDIT'
  else if (rawType.includes('DEBIT')) card_type = 'DEBIT'
  else if (rawType.includes('PREPAID')) card_type = 'PREPAID'

  const rawScheme = (body.cardScheme || body.cardBrand || '').toString().toUpperCase().replace(/[\s_-]+/g, '')
  let card_brand: string | null = rawScheme || null

  // Derive a coarse classification for reporting. Optional for MDR matching
  // (the matcher falls back to rates without a classification).
  let card_classification: string | null = null
  if (body.corporateCard === true) card_classification = 'CORPORATE'
  else if (body.prepaidCard === true) card_classification = 'PREPAID'
  else if (card_type) card_classification = 'CONSUMER'
  if (card_classification && body.isIndian === false) card_classification = `INTERNATIONAL_${card_classification}`

  const payMethodIsCard = rawType.includes('CARD') || card_type != null

  return { card_type, card_brand, card_classification, payMethodIsCard }
}

/**
 * Enrich stored Paytm card transactions that are missing card_type/card_brand.
 */
export async function enrichPaytmCardData(opts: EnrichOptions = {}): Promise<EnrichResult> {
  const limit = opts.limit ?? 50
  const cooldownMinutes = opts.cooldownMinutes ?? 20
  const maxAttempts = opts.maxAttempts ?? 8
  const delayMs = opts.delayMs ?? 300

  const supabase = getSupabaseAdmin()
  const result: EnrichResult = { scanned: 0, enriched: 0, noData: 0, errors: 0, details: [] }

  const cooldownCutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000).toISOString()

  const { data: rows, error } = await supabase
    .from('razorpay_pos_transactions')
    .select('id, txn_id, tid, mid_code, payment_mode, card_type, card_brand, card_enrich_attempts')
    .like('txn_id', 'PTM_%')
    .in('display_status', ['SUCCESS', 'CAPTURED'])
    .ilike('payment_mode', '%CARD%')
    .is('reversed_at', null)
    .or('card_type.is.null,card_brand.is.null')
    .lt('card_enrich_attempts', maxAttempts)
    .or(`card_enrich_last_at.is.null,card_enrich_last_at.lt.${cooldownCutoff}`)
    .order('transaction_time', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[PaytmEnrich] Fetch error:', error.message)
    result.errors++
    return result
  }

  for (const row of rows || []) {
    result.scanned++
    const mtxnId = String(row.txn_id).replace(/^PTM_/, '')
    const attempts = (row.card_enrich_attempts || 0) + 1

    try {
      const body = await fetchPaytmStatusBody(mtxnId, { tid: row.tid || undefined, mid: row.mid_code || undefined })
      const sInfo: any = body?.resultInfo || {}
      const ok = sInfo.resultStatus === 'SUCCESS' || sInfo.resultCodeId === '0000'

      const mapped = ok ? normalizePaytmCardFields(body) : null

      if (mapped && (mapped.card_type || mapped.card_brand)) {
        const update: Record<string, any> = {
          card_enrich_attempts: attempts,
          card_enrich_last_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        if (mapped.card_type) update.card_type = mapped.card_type
        if (mapped.card_brand) update.card_brand = mapped.card_brand
        if (mapped.card_classification) update.card_classification = mapped.card_classification
        // Fix mislabeled mode when Paytm confirms a card payment.
        if (mapped.payMethodIsCard) update.payment_mode = 'CARD'

        const { error: upErr } = await supabase
          .from('razorpay_pos_transactions')
          .update(update)
          .eq('id', row.id)

        if (upErr) {
          result.errors++
          result.details.push({ txn_id: row.txn_id, status: 'error', error: upErr.message })
        } else {
          result.enriched++
          result.details.push({ txn_id: row.txn_id, status: 'enriched', card_type: mapped.card_type, card_brand: mapped.card_brand })
          console.log(`[PaytmEnrich] ${row.txn_id} → ${mapped.card_type}/${mapped.card_brand}`)
        }
      } else {
        result.noData++
        result.details.push({ txn_id: row.txn_id, status: 'no_data' })
        await supabase
          .from('razorpay_pos_transactions')
          .update({ card_enrich_attempts: attempts, card_enrich_last_at: new Date().toISOString() })
          .eq('id', row.id)
      }
    } catch (err: any) {
      result.errors++
      result.details.push({ txn_id: row.txn_id, status: 'error', error: err?.message })
      await supabase
        .from('razorpay_pos_transactions')
        .update({ card_enrich_attempts: attempts, card_enrich_last_at: new Date().toISOString() })
        .eq('id', row.id)
      console.warn(`[PaytmEnrich] ${row.txn_id} error: ${err?.message}`)
    }

    if (delayMs > 0) await sleep(delayMs)
  }

  return result
}
