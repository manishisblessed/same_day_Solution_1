/**
 * Knteer Solution — Do Transaction
 * POST /payout/v1/do-transaction
 *
 * Response code mapping:
 *   235 + StatusId 4  → SUCCESS
 *   238 + StatusId 3  → PENDING
 *   241 + StatusId 6  → FAILED (Knteer already refunded their side)
 *   314               → INDETERMINATE (same txn cooldown — do NOT auto-refund)
 *   347               → FAILED (duplicate partnerTransId — our bug)
 *   any 5xx/network   → INDETERMINATE
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { knteerClient } from './client'
import { getOrCreateBeneCode } from './beneficiary'
import { KnteerDoTransactionRequest, KnteerDoTransactionResponse, KnteerTransferResult } from './types'
import { getKnteerLatitude, getKnteerLongitude, isKnteerMockMode } from './config'

export interface InitiateKnteerTransferOptions {
  supabase: SupabaseClient
  retailerId: string
  partnerTransId: string    // our unique reference (= refId used in JWT)
  beneDetails: {
    email: string
    mobile: string
    beneName: string
    accountNumber: string
    bankName: string
    ifsc: string
  }
  amount: number
  paymentMode: 'IMPS' | 'NEFT'
  remark?: string
}

export async function initiateKnteerTransfer(
  opts: InitiateKnteerTransferOptions
): Promise<KnteerTransferResult> {
  const { supabase, retailerId, partnerTransId, beneDetails, amount, paymentMode, remark } = opts

  // Step 1 — Get or create beneCode
  const beneResult = await getOrCreateBeneCode(supabase, retailerId, beneDetails)
  if (!beneResult.success || !beneResult.beneCode) {
    return { success: false, error: beneResult.error || 'Failed to register beneficiary' }
  }
  const { beneCode } = beneResult

  // Step 2 — Do transaction
  const body: KnteerDoTransactionRequest = {
    beneCode,
    email: beneDetails.email,
    mobile: beneDetails.mobile,
    beneName: beneDetails.beneName,
    accountNumber: beneDetails.accountNumber,
    bankName: beneDetails.bankName,
    ifsc: beneDetails.ifsc,
    paymentMode,
    amount: String(amount),
    latitude: getKnteerLatitude(),
    longitude: getKnteerLongitude(),
    partnerTransId,
    remark: remark || `Payout ${partnerTransId}`,
  }

  if (isKnteerMockMode()) {
    return {
      success: true,
      status: 'pending',
      status_id: 3,
      partner_trans_id: partnerTransId,
      knteer_trans_id: `KSPH_MOCK_${Date.now()}`,
      utr: '',
      amount,
    }
  }

  const res = await knteerClient.request<KnteerDoTransactionResponse>({
    method: 'POST',
    endpoint: '/payout/v1/do-transaction',
    body: body as unknown as Record<string, unknown>,
    refId: partnerTransId,   // JWT refId = partnerTransId for traceability
  })

  // Network / timeout — indeterminate
  if (!res.success) {
    const isTimeout = res.error?.includes('timeout') || res.error?.includes('Timeout')
    console.warn('[Knteer] do-transaction network error:', { partnerTransId, error: res.error, isTimeout })
    return {
      success: false,
      is_indeterminate: true,
      error: res.error,
      partner_trans_id: partnerTransId,
    }
  }

  const d = res.data!
  const list = d.List?.[0]

  console.log('[Knteer] do-transaction response:', {
    code: d.code, status: d.status, message: d.message,
    statusId: list?.StatusId, transId: list?.transId, utr: list?.utr,
  })

  // ── SUCCESS ──────────────────────────────────────────────────────────────
  if (d.code === 235 && list?.StatusId === 4) {
    return {
      success: true,
      status: 'success',
      status_id: 4,
      partner_trans_id: partnerTransId,
      knteer_trans_id: list.transId,
      utr: list.utr || undefined,
      amount: list.amount ?? amount,
    }
  }

  // ── PENDING ───────────────────────────────────────────────────────────────
  if (d.code === 238 && list?.StatusId === 3) {
    return {
      success: true,
      status: 'pending',
      status_id: 3,
      partner_trans_id: partnerTransId,
      knteer_trans_id: list.transId,
      utr: '',
      amount: list.amount ?? amount,
    }
  }

  // ── FAILED + PROVIDER REFUNDED ────────────────────────────────────────────
  if (d.code === 241 && list?.StatusId === 6) {
    return {
      success: false,
      status: 'failed',
      status_id: 6,
      partner_trans_id: partnerTransId,
      knteer_trans_id: list.transId,
      provider_refunded: true,
      error: d.message || 'Transaction failed, provider refunded',
    }
  }

  // ── INDETERMINATE — same-txn cooldown (9 min) ─────────────────────────────
  // Code 314 means Knteer is still processing a previous identical txn.
  // Money may already be in-flight. DO NOT auto-refund.
  if (d.code === 314) {
    return {
      success: false,
      is_indeterminate: true,
      status_id: list?.StatusId,
      partner_trans_id: partnerTransId,
      knteer_trans_id: list?.transId,
      error: d.message || 'Same transaction cooldown — awaiting provider resolution',
    }
  }

  // ── DEFINITIVE FAILURE — duplicate partnerTransId ─────────────────────────
  // Code 347 means we reused a partnerTransId — programming error on our side.
  if (d.code === 347) {
    return {
      success: false,
      status: 'failed',
      error: 'Duplicate partnerTransId — check internal ref generation',
      partner_trans_id: partnerTransId,
    }
  }

  // ── Unknown non-success response ──────────────────────────────────────────
  // Treat as indeterminate to avoid refunding money that may be in-flight.
  console.warn('[Knteer] Unknown do-transaction response — treating as indeterminate:', { code: d.code, message: d.message })
  return {
    success: false,
    is_indeterminate: true,
    status_id: list?.StatusId,
    partner_trans_id: partnerTransId,
    knteer_trans_id: list?.transId,
    error: d.message || 'Unknown provider response',
  }
}
