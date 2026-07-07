import { createClient } from '@supabase/supabase-js'

const CALLBACK_TIMEOUT_MS = 10_000
const MAX_RETRIES = 3

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export interface SettlementCallbackPayload {
  event: 'settlement.success' | 'settlement.failed' | 'settlement.status_update'
  data: {
    txnId: string
    reference_id: string
    order_id: string | null
    status: string
    utr: string | null
    amount: number
    charges: number
    total_debited: number
    mode: string
    account_number: string
    ifsc_code: string
    account_holder_name: string
    status_message: string | null
    timestamp: string | null
  }
}

/**
 * Build the callback payload from a shadval_settlement row.
 */
function buildPayload(tx: any): SettlementCallbackPayload {
  const event = tx.status === 'SUCCESS'
    ? 'settlement.success'
    : tx.status === 'FAILED'
      ? 'settlement.failed'
      : 'settlement.status_update'

  return {
    event,
    data: {
      txnId: tx.reference_id,
      reference_id: tx.reference_id,
      order_id: tx.order_id || null,
      status: tx.status,
      utr: tx.utr || null,
      amount: tx.amount,
      charges: tx.charges || 0,
      total_debited: tx.total_debit || tx.amount,
      mode: tx.mode,
      account_number: tx.account_number,
      ifsc_code: tx.ifsc_code,
      account_holder_name: tx.account_holder_name,
      status_message: tx.status_message || null,
      timestamp: tx.provider_timestamp || tx.updated_at || null,
    },
  }
}

/**
 * Look up a partner's webhook_url.
 */
async function getPartnerWebhookUrl(partnerId: string): Promise<string | null> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('partners')
    .select('webhook_url')
    .eq('id', partnerId)
    .eq('status', 'active')
    .maybeSingle()
  return data?.webhook_url || null
}

/**
 * Send callback payload to a URL with timeout.
 * Returns { ok, httpStatus, error }.
 */
async function postCallback(
  url: string,
  payload: SettlementCallbackPayload
): Promise<{ ok: boolean; httpStatus?: number; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    return { ok: res.ok, httpStatus: res.status }
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'Timeout' : err.message
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Log a callback attempt to `settlement_callback_logs`.
 * Best-effort — never throws.
 */
async function logAttempt(
  txId: string,
  partnerId: string,
  webhookUrl: string,
  payload: SettlementCallbackPayload,
  result: { ok: boolean; httpStatus?: number; error?: string },
  attempt: number
) {
  try {
    const supabase = getSupabase()
    await supabase.from('settlement_callback_logs').insert({
      settlement_id: txId,
      partner_id: partnerId,
      webhook_url: webhookUrl,
      event: payload.event,
      reference_id: payload.data.reference_id,
      status: payload.data.status,
      http_status: result.httpStatus || null,
      success: result.ok,
      error_message: result.error || null,
      attempt,
      payload,
    })
  } catch {
    console.error('[SettlementCallback] Failed to log attempt', { txId, attempt })
  }
}

/**
 * Fire-and-forget: send settlement callback to partner's webhook_url.
 * Called after transfer completes or status changes from PENDING.
 */
export async function sendSettlementCallback(
  partnerId: string,
  transaction: any
): Promise<{ sent: boolean; httpStatus?: number; error?: string }> {
  if (!partnerId || !transaction) return { sent: false, error: 'Missing data' }

  // Only callback for terminal states (or any non-PENDING if you prefer)
  if (transaction.status === 'PENDING') return { sent: false, error: 'Still pending' }

  try {
    const webhookUrl = await getPartnerWebhookUrl(partnerId)
    if (!webhookUrl) return { sent: false, error: 'No webhook_url configured' }

    const payload = buildPayload(transaction)

    let lastResult: { ok: boolean; httpStatus?: number; error?: string } = { ok: false }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      lastResult = await postCallback(webhookUrl, payload)

      await logAttempt(transaction.id, partnerId, webhookUrl, payload, lastResult, attempt)

      if (lastResult.ok) {
        console.log('[SettlementCallback] Delivered', {
          partnerId,
          ref: transaction.reference_id,
          status: transaction.status,
          attempt,
          httpStatus: lastResult.httpStatus,
        })
        return { sent: true, httpStatus: lastResult.httpStatus }
      }

      // Brief backoff before retry (1s, 2s, 3s)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, attempt * 1000))
      }
    }

    console.error('[SettlementCallback] All retries exhausted', {
      partnerId,
      ref: transaction.reference_id,
      error: lastResult.error,
    })
    return { sent: false, httpStatus: lastResult.httpStatus, error: lastResult.error || 'All retries failed' }
  } catch (err: any) {
    console.error('[SettlementCallback] Unexpected error', { partnerId, error: err.message })
    return { sent: false, error: err.message }
  }
}

/**
 * Admin helper: re-send callback for a specific reference_id.
 * Looks up the transaction and partner, then sends.
 */
export async function retrySettlementCallback(referenceId: string): Promise<{
  sent: boolean
  httpStatus?: number
  error?: string
  transaction?: any
}> {
  const supabase = getSupabase()

  const { data: tx, error: txErr } = await supabase
    .from('shadval_settlement')
    .select('*')
    .eq('reference_id', referenceId)
    .maybeSingle()

  if (txErr || !tx) return { sent: false, error: 'Transaction not found' }

  const result = await sendSettlementCallback(tx.retailer_id, tx)
  return { ...result, transaction: { reference_id: tx.reference_id, status: tx.status, utr: tx.utr } }
}
