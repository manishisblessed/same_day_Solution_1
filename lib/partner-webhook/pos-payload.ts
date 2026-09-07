/**
 * Canonical `pos.transaction` payload shared by every channel that notifies a
 * partner of a POS transaction (real-time provider webhooks + the Pine Labs
 * polling sync). Building it in one place guarantees partners receive an
 * identical, stable schema regardless of how we ingested the transaction.
 *
 * The webhook routes spread this over the raw provider payload (additive, so
 * pre-existing integrations that read raw fields keep working); the sync path
 * sends it as the whole payload.
 */

export interface PosTransactionPayloadInput {
  txnId: string
  /** display_status: SUCCESS | FAILED | PENDING | VOIDED | REFUNDED */
  status: string | null | undefined
  amount: number | null | undefined
  currency?: string | null
  tid?: string | null
  mid?: string | null
  rrn?: string | null
  authCode?: string | null
  cardBrand?: string | null
  cardType?: string | null
  /** Masked card number as received from the provider. */
  cardNumber?: string | null
  issuingBank?: string | null
  paymentMode?: string | null
  merchantName?: string | null
  merchantSlug?: string | null
  /** ISO-8601 timestamp of the transaction. */
  transactionTime?: string | null
  /** Provider brand: PINELAB | RAZORPAY | PAYTM */
  brand?: string | null
  /** Ingestion channel, for partner/debug visibility. */
  source?: string | null
}

export interface PosTransactionPayload {
  event: 'pos.transaction'
  txn_id: string
  status: string
  amount: number
  currency: string
  tid: string | null
  mid: string | null
  rrn: string | null
  auth_code: string | null
  card_brand: string | null
  card_type: string | null
  card_number: string | null
  issuing_bank: string | null
  payment_mode: string | null
  merchant_name: string | null
  merchant_slug: string | null
  transaction_time: string | null
  brand: string | null
  _source: string | null
}

export function buildPosTransactionPayload(input: PosTransactionPayloadInput): PosTransactionPayload {
  const amount =
    typeof input.amount === 'number'
      ? input.amount
      : parseFloat(String(input.amount ?? 0)) || 0

  return {
    event: 'pos.transaction',
    txn_id: input.txnId,
    status: (input.status || 'PENDING').toString().toUpperCase(),
    amount,
    currency: input.currency || 'INR',
    tid: input.tid ?? null,
    mid: input.mid ?? null,
    rrn: input.rrn ?? null,
    auth_code: input.authCode ?? null,
    card_brand: input.cardBrand ?? null,
    card_type: input.cardType ?? null,
    card_number: input.cardNumber ?? null,
    issuing_bank: input.issuingBank ?? null,
    payment_mode: input.paymentMode ?? null,
    merchant_name: input.merchantName ?? null,
    merchant_slug: input.merchantSlug ?? null,
    transaction_time: input.transactionTime ?? null,
    brand: input.brand ?? null,
    _source: input.source ?? null,
  }
}
