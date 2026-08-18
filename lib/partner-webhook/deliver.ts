import * as crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Outbound POS transaction webhook delivery to partners.
 *
 * Security model (what partners verify):
 *   - X-Sameday-Signature : HMAC-SHA256(webhook_secret, `${timestamp}.${rawBody}`) hex
 *   - X-Sameday-Timestamp : unix seconds when we signed (replay window on partner side)
 *   - X-Sameday-Delivery  : per-delivery UUID, stable across retries (idempotency key)
 *   - X-Sameday-Event     : event type ("pos.transaction")
 *
 * Backward compatible: if a partner has no webhook_secret configured, the
 * callback is still sent, just without the signature header.
 */

const CALLBACK_TIMEOUT_MS = 10_000
// 3 attempts total: immediate, +2s, +5s. Signature/timestamp are computed once
// so they stay valid across retries.
const RETRY_DELAYS_MS = [0, 2_000, 5_000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function signPartnerPayload(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')
}

/**
 * Best-effort audit log of an outbound delivery. Never throws.
 */
async function logDelivery(
  supabase: SupabaseClient | undefined,
  row: {
    delivery_id: string
    partner_id: string | null
    txn_id: string
    event: string
    webhook_url: string
    status_code: number | null
    success: boolean
    attempts: number
    error: string | null
    payload: unknown
  }
): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('partner_webhook_deliveries').insert(row)
  } catch (err: any) {
    console.warn(`[Partner Callback] delivery log failed txnId=${row.txn_id}: ${err?.message || err}`)
  }
}

/**
 * POST a payload to a partner URL with signing + bounded retries.
 * Best-effort: never throws. Logs the final outcome (and persists it to
 * partner_webhook_deliveries when a supabase client + partnerId are provided).
 */
export async function sendSignedCallback(opts: {
  url: string
  secret: string | null
  payload: unknown
  txnId: string
  event?: string
  logPrefix?: string
  supabase?: SupabaseClient
  partnerId?: string | null
}): Promise<void> {
  const { url, secret, payload, txnId, event = 'pos.transaction', logPrefix = 'Partner Callback', supabase, partnerId = null } = opts

  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const deliveryId = crypto.randomUUID()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Sameday-Event': event,
    'X-Sameday-Timestamp': timestamp,
    'X-Sameday-Delivery': deliveryId,
  }
  if (secret) {
    headers['X-Sameday-Signature'] = signPartnerPayload(secret, timestamp, body)
  }

  let lastStatus: number | null = null
  let lastError: string | null = null

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) await sleep(RETRY_DELAYS_MS[attempt])
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
      })
      lastStatus = res.status
      if (res.ok) {
        console.log(`[${logPrefix}] delivered txnId=${txnId} event=${event} delivery=${deliveryId} attempt=${attempt + 1} signed=${!!secret} → HTTP ${res.status}`)
        await logDelivery(supabase, {
          delivery_id: deliveryId, partner_id: partnerId, txn_id: txnId, event, webhook_url: url,
          status_code: res.status, success: true, attempts: attempt + 1, error: null, payload,
        })
        return
      }
      lastError = `HTTP ${res.status}`
      console.warn(`[${logPrefix}] non-2xx txnId=${txnId} event=${event} delivery=${deliveryId} attempt=${attempt + 1} → HTTP ${res.status}`)
    } catch (err: any) {
      lastError = err?.message || String(err)
      console.warn(`[${logPrefix}] attempt failed txnId=${txnId} event=${event} delivery=${deliveryId} attempt=${attempt + 1}: ${lastError}`)
    }
  }
  console.error(`[${logPrefix}] giving up txnId=${txnId} event=${event} delivery=${deliveryId} after ${RETRY_DELAYS_MS.length} attempts`)
  await logDelivery(supabase, {
    delivery_id: deliveryId, partner_id: partnerId, txn_id: txnId, event, webhook_url: url,
    status_code: lastStatus, success: false, attempts: RETRY_DELAYS_MS.length, error: lastError, payload,
  })
}

/**
 * Resolve the owning partner for a terminal id and deliver a signed callback.
 * Fire-and-forget friendly: never throws.
 */
export async function deliverPartnerCallback(opts: {
  supabase: SupabaseClient
  tid: string | null | undefined
  txnId: string
  payload: unknown
  event?: string
  logPrefix?: string
}): Promise<void> {
  const { supabase, tid, txnId, payload, event = 'pos.transaction', logPrefix = 'Partner Callback' } = opts

  if (!tid) {
    console.warn(`[${logPrefix}] Skip txnId=${txnId}: no tid in payload (callback requires terminal_id match)`)
    return
  }

  try {
    const { data: partnerRows, error: pmErr } = await supabase
      .from('partner_pos_machines')
      .select('partner_id')
      .eq('terminal_id', tid)
      .eq('status', 'active')
      .limit(2)

    if (pmErr) {
      console.error(`[${logPrefix}] partner_pos_machines query error tid=${tid}: ${pmErr.message}`)
      return
    }
    if (!partnerRows?.length) {
      console.warn(`[${logPrefix}] Skip txnId=${txnId} tid=${tid}: no active row in partner_pos_machines`)
      return
    }
    if (partnerRows.length > 1) {
      console.error(`[${logPrefix}] Skip txnId=${txnId} tid=${tid}: multiple active partner_pos_machines rows — fix duplicates`)
      return
    }

    const partnerId = partnerRows[0].partner_id
    const { data: partnerRecord, error: pErr } = await supabase
      .from('partners')
      .select('webhook_url, webhook_secret')
      .eq('id', partnerId)
      .eq('status', 'active')
      .maybeSingle()

    if (pErr) {
      console.error(`[${logPrefix}] partners query error partner_id=${partnerId}: ${pErr.message}`)
      return
    }
    if (!partnerRecord?.webhook_url) {
      console.warn(`[${logPrefix}] Skip txnId=${txnId} tid=${tid} partner_id=${partnerId}: webhook_url empty or partner not active`)
      return
    }

    await sendSignedCallback({
      url: partnerRecord.webhook_url,
      secret: (partnerRecord as { webhook_secret?: string | null }).webhook_secret ?? null,
      payload,
      txnId,
      event,
      logPrefix,
      supabase,
      partnerId,
    })
  } catch (err: any) {
    console.error(`[${logPrefix}] Lookup error txnId=${txnId}: ${err?.message || err}`)
  }
}

/**
 * Notify the owning partner that a previously-captured POS transaction has been
 * voided/reversed/refunded upstream, so they can mirror the removal in their
 * books. Emits the `pos.transaction.reversed` event, signed + retried + logged.
 *
 * Partner resolution is the robust path (pos_machines OR partner_pos_machines),
 * matching how the transaction was attached — so reversals reach the partner
 * even when the terminal lives only in pos_machines.
 *
 * Fire-and-forget friendly: never throws.
 */
export async function deliverPartnerReversal(opts: {
  supabase: SupabaseClient
  tid: string | null | undefined
  deviceSerial?: string | null
  txnId: string
  payload: unknown
  logPrefix?: string
}): Promise<void> {
  const { supabase, tid, deviceSerial = null, txnId, payload, logPrefix = 'Partner Reversal' } = opts

  try {
    const { resolvePartnerIdForDevice } = await import('@/lib/partner-settlement')
    const partnerId = await resolvePartnerIdForDevice(deviceSerial, tid ?? null)
    if (!partnerId) {
      console.warn(`[${logPrefix}] Skip txnId=${txnId} tid=${tid} serial=${deviceSerial}: no owning partner resolved`)
      return
    }

    const { data: partnerRecord, error: pErr } = await supabase
      .from('partners')
      .select('webhook_url, webhook_secret')
      .eq('id', partnerId)
      .eq('status', 'active')
      .maybeSingle()

    if (pErr) {
      console.error(`[${logPrefix}] partners query error partner_id=${partnerId}: ${pErr.message}`)
      return
    }
    if (!partnerRecord?.webhook_url) {
      console.warn(`[${logPrefix}] Skip txnId=${txnId} partner_id=${partnerId}: webhook_url empty or partner not active`)
      return
    }

    await sendSignedCallback({
      url: partnerRecord.webhook_url,
      secret: (partnerRecord as { webhook_secret?: string | null }).webhook_secret ?? null,
      payload,
      txnId,
      event: 'pos.transaction.reversed',
      logPrefix,
      supabase,
      partnerId,
    })
  } catch (err: any) {
    console.error(`[${logPrefix}] Lookup error txnId=${txnId}: ${err?.message || err}`)
  }
}
