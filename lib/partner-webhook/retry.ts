import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import {
  sendSignedCallback,
  resolvePartnerEndpoints,
  deliverPartnerCallbackByPartnerId,
  eventCategory,
  type CallbackDeliveryResult,
} from '@/lib/partner-webhook/deliver'
import { buildPosTransactionPayload } from '@/lib/partner-webhook/pos-payload'

/** Only re-attempt failures from the recent past — older ones are given up on. */
const RETRY_WINDOW_HOURS = 24
/** Hard cap on re-attempts per (txn, endpoint) so a permanently-rejecting
 * endpoint (e.g. HTTP 422) is not hammered forever. */
const MAX_ATTEMPTS_PER_TARGET = 8
/** Bound work per cron tick. */
const MAX_TARGETS_PER_RUN = 200

interface DeliveryRow {
  txn_id: string
  event: string
  webhook_url: string
  webhook_id: string | null
  partner_id: string | null
  success: boolean
  payload: unknown
  created_at: string
}

/**
 * Re-deliver POS partner callbacks whose most recent attempt failed, off the
 * `partner_webhook_deliveries` audit log. Bounded by a time window, a per-target
 * attempt cap and a per-run batch size. Never throws.
 */
export async function retryFailedPosCallbacks(): Promise<{
  targets: number
  retried: number
  succeeded: number
  errors: string[]
}> {
  const supabase = getSupabaseAdmin()
  const errors: string[] = []
  const sinceIso = new Date(Date.now() - RETRY_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  const { data: rows, error } = await supabase
    .from('partner_webhook_deliveries')
    .select('txn_id, event, webhook_url, webhook_id, partner_id, success, payload, created_at')
    .like('event', 'pos.%')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })

  if (error) {
    return { targets: 0, retried: 0, succeeded: 0, errors: [error.message] }
  }

  // Collapse to one target per (txn_id, webhook_url): keep the latest attempt and
  // count total failures so we can enforce the attempt cap.
  const targets = new Map<
    string,
    { latest: DeliveryRow; failCount: number }
  >()
  for (const r of (rows || []) as DeliveryRow[]) {
    const key = `${r.txn_id}|${r.webhook_url}`
    const entry = targets.get(key)
    if (!entry) {
      targets.set(key, { latest: r, failCount: r.success ? 0 : 1 })
    } else {
      entry.latest = r // rows are ascending, so this ends on the newest
      if (!r.success) entry.failCount++
    }
  }

  const candidates = [...targets.values()]
    .filter((t) => !t.latest.success && t.failCount < MAX_ATTEMPTS_PER_TARGET && !!t.latest.partner_id)
    .slice(0, MAX_TARGETS_PER_RUN)

  let retried = 0
  let succeeded = 0

  for (const { latest } of candidates) {
    try {
      const category = eventCategory(latest.event) ?? 'pos'
      const endpoints = await resolvePartnerEndpoints(supabase, latest.partner_id as string, category)
      const ep = endpoints.find((e) => e.url === latest.webhook_url)
      if (!ep) {
        // Endpoint removed/deactivated/unsubscribed — stop retrying it.
        continue
      }

      retried++
      const res = await sendSignedCallback({
        url: ep.url,
        secret: ep.secret,
        payload: latest.payload,
        txnId: latest.txn_id,
        event: latest.event,
        logPrefix: 'Partner Callback/retry',
        supabase,
        partnerId: latest.partner_id,
        webhookId: ep.id,
      })
      if (res.success) succeeded++
    } catch (err: any) {
      errors.push(`${latest.txn_id}: ${err?.message || err}`)
    }
  }

  return { targets: candidates.length, retried, succeeded, errors }
}

/**
 * Manually (re)send the forward `pos.transaction` callback for a single POS
 * transaction, rebuilding the canonical payload from the stored row. Used by the
 * admin replay endpoint. Returns a concrete outcome. Never throws.
 */
export async function replayPosCallback(txnId: string): Promise<{
  sent: boolean
  partnerId: string | null
  results: CallbackDeliveryResult[]
  error?: string
}> {
  const supabase = getSupabaseAdmin()

  const { data: row, error } = await supabase
    .from('razorpay_pos_transactions')
    .select(
      'id, txn_id, display_status, amount, currency, tid, mid_code, rrn, auth_code, card_brand, card_type, card_number, issuing_bank, payment_mode, merchant_name, merchant_slug, transaction_time, device_serial, partner_id, partner_callback_sent_at'
    )
    .eq('txn_id', txnId)
    .maybeSingle()

  if (error) return { sent: false, partnerId: null, results: [], error: error.message }
  if (!row) return { sent: false, partnerId: null, results: [], error: 'transaction not found' }

  let partnerId = row.partner_id as string | null
  if (!partnerId) {
    const { resolvePartnerIdForDevice } = await import('@/lib/partner-settlement')
    partnerId = await resolvePartnerIdForDevice(row.device_serial as string | null, row.tid as string | null)
  }
  if (!partnerId) {
    return { sent: false, partnerId: null, results: [], error: 'no owning partner resolved for this transaction' }
  }

  const payload = buildPosTransactionPayload({
    txnId: row.txn_id,
    status: row.display_status,
    amount: row.amount,
    currency: row.currency,
    tid: row.tid,
    mid: row.mid_code,
    rrn: row.rrn,
    authCode: row.auth_code,
    cardBrand: row.card_brand,
    cardType: row.card_type,
    cardNumber: row.card_number,
    issuingBank: row.issuing_bank,
    paymentMode: row.payment_mode,
    merchantName: row.merchant_name,
    merchantSlug: row.merchant_slug,
    transactionTime: row.transaction_time,
    brand: 'PINELAB',
    source: 'admin_replay',
  })

  const results = await deliverPartnerCallbackByPartnerId({
    supabase,
    partnerId,
    txnId: row.txn_id,
    payload,
    event: 'pos.transaction',
    logPrefix: 'Partner Callback/replay',
  })

  if (results.length === 0) {
    return { sent: false, partnerId, results, error: 'partner has no active POS webhook endpoint' }
  }

  const sent = results.some((r) => r.success)
  if (sent && !row.partner_callback_sent_at) {
    await supabase
      .from('razorpay_pos_transactions')
      .update({ partner_callback_sent_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('partner_callback_sent_at', null)
  }

  return { sent, partnerId, results }
}
