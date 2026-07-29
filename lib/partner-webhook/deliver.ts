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
 * POST a payload to a partner URL with signing + bounded retries.
 * Best-effort: never throws. Logs the final outcome.
 */
export async function sendSignedCallback(opts: {
  url: string
  secret: string | null
  payload: unknown
  txnId: string
  logPrefix?: string
}): Promise<void> {
  const { url, secret, payload, txnId, logPrefix = 'Partner Callback' } = opts

  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const deliveryId = crypto.randomUUID()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Sameday-Event': 'pos.transaction',
    'X-Sameday-Timestamp': timestamp,
    'X-Sameday-Delivery': deliveryId,
  }
  if (secret) {
    headers['X-Sameday-Signature'] = signPartnerPayload(secret, timestamp, body)
  }

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) await sleep(RETRY_DELAYS_MS[attempt])
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
      })
      if (res.ok) {
        console.log(`[${logPrefix}] delivered txnId=${txnId} delivery=${deliveryId} attempt=${attempt + 1} signed=${!!secret} → HTTP ${res.status}`)
        return
      }
      console.warn(`[${logPrefix}] non-2xx txnId=${txnId} delivery=${deliveryId} attempt=${attempt + 1} → HTTP ${res.status}`)
    } catch (err: any) {
      console.warn(`[${logPrefix}] attempt failed txnId=${txnId} delivery=${deliveryId} attempt=${attempt + 1}: ${err?.message || err}`)
    }
  }
  console.error(`[${logPrefix}] giving up txnId=${txnId} delivery=${deliveryId} after ${RETRY_DELAYS_MS.length} attempts`)
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
  logPrefix?: string
}): Promise<void> {
  const { supabase, tid, txnId, payload, logPrefix = 'Partner Callback' } = opts

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
      logPrefix,
    })
  } catch (err: any) {
    console.error(`[${logPrefix}] Lookup error txnId=${txnId}: ${err?.message || err}`)
  }
}
