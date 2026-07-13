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

async function postCallback(
  url: string,
  payload: PayoutCallbackPayload
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
    const webhookUrl = await getPartnerWebhookUrl(partnerId)
    if (!webhookUrl) return { sent: false, error: 'No webhook_url configured' }

    const payload = buildPayload(transaction)
    let lastResult: { ok: boolean; httpStatus?: number; error?: string } = { ok: false }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      lastResult = await postCallback(webhookUrl, payload)

      if (lastResult.ok) {
        console.log('[PayoutCallback] Delivered', { partnerId, txId: transaction.id, status: transaction.status, attempt })
        return { sent: true, httpStatus: lastResult.httpStatus }
      }

      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, attempt * 1000))
      }
    }

    console.error('[PayoutCallback] All retries exhausted', { partnerId, txId: transaction.id, error: lastResult.error })
    return { sent: false, httpStatus: lastResult.httpStatus, error: lastResult.error || 'All retries failed' }
  } catch (err: any) {
    console.error('[PayoutCallback] Unexpected error', { partnerId, error: err.message })
    return { sent: false, error: err.message }
  }
}
