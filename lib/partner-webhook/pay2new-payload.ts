/**
 * Canonical payload for the `pay2new.cc.status` partner webhook.
 *
 * Emitted on a terminal Pay2New (BBPS-2 Credit Card) pay state so partners can
 * self-heal a lost `bill/pay` response: the event carries BOTH the bill-fetch
 * reference the partner always holds (`bill_fetch_ref`) and the pay-step
 * references (`request_id` / `order_id`) they may have lost.
 *
 * Signed with the partner's shared webhook_secret (HMAC-SHA256) by the delivery
 * layer; see lib/partner-webhook/deliver.ts.
 */

export type Pay2NewTerminalStatus = 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'PENDING'

export interface Pay2NewStatusPayloadInput {
  billFetchRef: string | null
  requestId: string
  /** Pay-step order_id (P2N_PAY…). Null when never attempted / failed. */
  orderId: string | null
  status: Pay2NewTerminalStatus
  /** Bill amount in rupees (excludes charge). */
  amount: number | null
  charge: number | null
  operatorReference: string | null
  message?: string | null
}

export interface Pay2NewStatusPayload {
  event: 'pay2new.cc.status'
  bill_fetch_ref: string | null
  request_id: string
  order_id: string | null
  status: Pay2NewTerminalStatus
  amount: number | null
  charge: number | null
  operator_reference: string | null
  message: string | null
  timestamp: string
}

export function buildPay2NewStatusPayload(input: Pay2NewStatusPayloadInput): Pay2NewStatusPayload {
  return {
    event: 'pay2new.cc.status',
    bill_fetch_ref: input.billFetchRef ?? null,
    request_id: input.requestId,
    order_id: input.orderId ?? null,
    status: input.status,
    amount: input.amount ?? null,
    charge: input.charge ?? null,
    operator_reference: input.operatorReference ?? null,
    message: input.message ?? null,
    timestamp: new Date().toISOString(),
  }
}
