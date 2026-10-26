/**
 * Knteer Payout — Partner Webhook Callbacks
 *
 * Fires payout.* events to partner webhook endpoints subscribed to the
 * 'payout' category (visible as "Settlement · Payout" checkbox in admin UI).
 *
 * Events:
 *   payout.account_registered  — new beneficiary registered (₹4.72 fee charged)
 *   payout.success             — transfer completed, UTR available
 *   payout.failed              — transfer failed, wallet refunded
 *   payout.pending             — transfer still processing
 *   payout.refunded            — explicit refund credited
 */

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

export type KnteerPayoutEvent =
  | 'payout.account_registered'
  | 'payout.success'
  | 'payout.failed'
  | 'payout.pending'
  | 'payout.refunded'

export interface KnteerPayoutCallbackPayload {
  event: KnteerPayoutEvent
  data: {
    // Always present
    partner_trans_id: string
    account_number: string         // last-4 masked: ***...2946
    account_holder_name: string
    bank_name: string
    ifsc_code: string
    timestamp: string
    // Transfer events
    transaction_id?: string
    provider_txn_id?: string | null
    utr?: string | null
    status?: string
    amount?: number
    charges?: number
    total_debited?: number
    payment_mode?: string
    failure_reason?: string | null
    // Registration event
    verification_charge?: number
    bene_registered?: boolean
  }
}

function buildTransactionPayload(tx: Record<string, any>): KnteerPayoutCallbackPayload {
  const status = (tx.status || '').toUpperCase()
  const event: KnteerPayoutEvent =
    status === 'SUCCESS'  ? 'payout.success'
    : status === 'FAILED'   ? 'payout.failed'
    : status === 'REFUNDED' ? 'payout.refunded'
    : 'payout.pending'

  return {
    event,
    data: {
      transaction_id:      tx.id,
      partner_trans_id:    tx.partner_trans_id || '',
      provider_txn_id:     tx.knteer_trans_id || null,
      utr:                 tx.utr || null,
      status,
      amount:              Number(tx.amount),
      charges:             Number(tx.charges || 0),
      total_debited:       Number(tx.actual_wallet_debit ?? tx.total_debit ?? (Number(tx.amount) + Number(tx.charges || 0))),
      payment_mode:        tx.payment_mode || 'IMPS',
      account_number:      (tx.account_number || '').replace(/\d(?=\d{4})/g, '*'),
      account_holder_name: tx.account_holder_name || '',
      bank_name:           tx.bank_name || '',
      ifsc_code:           tx.ifsc_code || '',
      failure_reason:      status === 'FAILED' ? (tx.status_message || 'Transfer failed') : null,
      timestamp:           tx.updated_at || tx.completed_at || new Date().toISOString(),
    },
  }
}

function buildRegistrationPayload(bene: {
  partner_trans_id: string
  account_number: string
  account_holder_name: string
  bank_name: string
  ifsc_code: string
  verification_charge: number
}): KnteerPayoutCallbackPayload {
  return {
    event: 'payout.account_registered',
    data: {
      partner_trans_id:    bene.partner_trans_id,
      account_number:      bene.account_number.replace(/\d(?=\d{4})/g, '*'),
      account_holder_name: bene.account_holder_name,
      bank_name:           bene.bank_name,
      ifsc_code:           bene.ifsc_code,
      verification_charge: bene.verification_charge,
      bene_registered:     true,
      timestamp:           new Date().toISOString(),
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
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
    return { ok: res.ok, httpStatus: res.status }
  } catch (err: any) {
    return { ok: false, error: err.name === 'AbortError' ? 'Timeout' : err.message }
  } finally {
    clearTimeout(timer)
  }
}

async function deliver(
  partnerId: string,
  payload: KnteerPayoutCallbackPayload,
  logContext: string
): Promise<{ sent: boolean; error?: string }> {
  try {
    const supabase = getSupabase()
    const endpoints = await resolvePartnerEndpoints(supabase, partnerId, 'payout')
    if (endpoints.length === 0) return { sent: false, error: 'No payout webhook endpoints configured' }

    const body = JSON.stringify(payload)
    const timestamp = Math.floor(Date.now() / 1000).toString()

    let anyOk = false
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
        const result = await postCallback(endpoint.url, body, headers)
        if (result.ok) {
          anyOk = true
          console.log(`[KnteerPayoutCallback] ${logContext} delivered`, {
            partnerId, event: payload.event, url: endpoint.url, attempt, delivery: deliveryId,
          })
          break
        }
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, attempt * 1000))
        else console.error(`[KnteerPayoutCallback] ${logContext} exhausted retries`, {
          partnerId, event: payload.event, url: endpoint.url, error: result.error,
        })
      }
    }

    return anyOk ? { sent: true } : { sent: false, error: 'All endpoints failed' }
  } catch (err: any) {
    console.error(`[KnteerPayoutCallback] ${logContext} unexpected error`, err.message)
    return { sent: false, error: err.message }
  }
}

/** Fire payout.* event for a Knteer transfer transaction (any status). */
export async function sendKnteerTransferCallback(
  partnerId: string,
  tx: Record<string, any>
): Promise<{ sent: boolean; error?: string }> {
  const payload = buildTransactionPayload(tx)
  return deliver(partnerId, payload, `tx=${tx.id} status=${tx.status}`)
}

/** Fire payout.account_registered event after a new beneficiary is registered. */
export async function sendKnteerRegistrationCallback(
  partnerId: string,
  bene: {
    partner_trans_id: string
    account_number: string
    account_holder_name: string
    bank_name: string
    ifsc_code: string
    verification_charge: number
  }
): Promise<{ sent: boolean; error?: string }> {
  const payload = buildRegistrationPayload(bene)
  return deliver(partnerId, payload, `account_registered acc=...${bene.account_number.slice(-4)}`)
}
