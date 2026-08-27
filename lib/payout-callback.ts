import { createClient } from '@supabase/supabase-js'
import * as crypto from 'crypto'
import { signPartnerPayload, resolvePartnerEndpoints } from '@/lib/partner-webhook/deliver'

const CALLBACK_TIMEOUT_MS = 10_000
const MAX_RETRIES = 3

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export interface PayoutCallbackPayload {
  event: 'payout.success' | 'payout.failed' | 'payout.refunded' | 'payout.status_update'
  data: {
    transaction_id: string
    client_ref_id: string
    provider_txn_id: string | null
    status: string
    amount: number
    charges: number
    total_debited: number
    transfer_mode: string
    account_number: string
    account_holder_name: string
    bank_name: string
    failure_reason: string | null
    refunded: boolean
    timestamp: string | null
  }
}

function buildPayload(tx: any): PayoutCallbackPayload {
  const status = (tx.status || '').toLowerCase()
  const event: PayoutCallbackPayload['event'] =
    status === 'success' ? 'payout.success'
    : status === 'refunded' ? 'payout.refunded'
    : status === 'failed' ? 'payout.failed'
    : 'payout.status_update'

  return {
    event,
    data: {
      transaction_id: tx.id,
      client_ref_id: tx.client_ref_id || '',
      provider_txn_id: tx.transaction_id || null,
      status: (tx.status || 'unknown').toUpperCase(),
      amount: tx.amount,
      charges: tx.charges || 0,
      total_debited: (tx.amount || 0) + (tx.charges || 0),
      transfer_mode: tx.transfer_mode || tx.mode || '',
      account_number: tx.account_number || '',
      account_holder_name: tx.account_holder_name || '',
      bank_name: tx.bank_name || '',
      failure_reason: tx.failure_reason || null,
      refunded: status === 'refunded',
      timestamp: tx.updated_at || tx.completed_at || null,
    },
  }
}

async function postCallback(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<{ ok: boolean; httpStatus?: number; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    return { ok: res.ok, httpStatus: res.status }
  } catch (err: any) {
    return { ok: false, error: err.name === 'AbortError' ? 'Timeout' : err.message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Send payout status callback to partner's webhook_url.
 * Only for partner-initiated payout transactions (partner_id is set).
 */
export async function sendPayoutCallback(
  partnerId: string,
  transaction: any
): Promise<{ sent: boolean; httpStatus?: number; error?: string }> {
  if (!partnerId || !transaction) return { sent: false, error: 'Missing data' }

  const status = (transaction.status || '').toLowerCase()
  if (['pending', 'processing'].includes(status)) return { sent: false, error: 'Still processing' }

  try {
    const endpoints = await resolvePartnerEndpoints(getSupabase(), partnerId, 'payout')
    if (endpoints.length === 0) return { sent: false, error: 'No webhook endpoint configured' }

    const payload = buildPayload(transaction)

    // Sign once — stable across retries (idempotency via X-Sameday-Delivery).
    // All endpoints share the partner's single secret; each gets its own id.
    const body = JSON.stringify(payload)
    const timestamp = Math.floor(Date.now() / 1000).toString()

    let anyOk = false
    let lastResult: { ok: boolean; httpStatus?: number; error?: string } = { ok: false }

    for (const endpoint of endpoints) {
      const deliveryId = crypto.randomUUID()
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Sameday-Event': payload.event,
        'X-Sameday-Timestamp': timestamp,
        'X-Sameday-Delivery': deliveryId,
      }
      if (endpoint.secret) {
        headers['X-Sameday-Signature'] = signPartnerPayload(endpoint.secret, timestamp, body)
      }

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        lastResult = await postCallback(endpoint.url, body, headers)

        if (lastResult.ok) {
          anyOk = true
          console.log('[PayoutCallback] Delivered', { partnerId, txId: transaction.id, status: transaction.status, url: endpoint.url, attempt, delivery: deliveryId, signed: !!endpoint.secret })
          break
        }

        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, attempt * 1000))
        }
      }

      if (!lastResult.ok) {
        console.error('[PayoutCallback] All retries exhausted', { partnerId, txId: transaction.id, url: endpoint.url, error: lastResult.error })
      }
    }

    return anyOk
      ? { sent: true, httpStatus: lastResult.httpStatus }
      : { sent: false, httpStatus: lastResult.httpStatus, error: lastResult.error || 'All deliveries failed' }
  } catch (err: any) {
    console.error('[PayoutCallback] Unexpected error', { partnerId, error: err.message })
    return { sent: false, error: err.message }
  }
}
