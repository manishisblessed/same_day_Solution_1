/**
 * Rechargekit status enquiry.
 *
 * IMPORTANT: this endpoint is `POST /recharge/statusCheck` with a JSON body
 * `{ partner_request_id }`. A GET request (query param) is rejected with
 * `{"error":1,"msg":"access denied."}` (HTTP 401) — which previously made every
 * status check / reconcile fail and left successful CC payments stuck as
 * "pending" forever. Do not switch this back to GET.
 *
 * Provider response: { error, msg, status, orderid, optransid, amount, commission }
 * status: 1 = SUCCESS, 2 = PENDING, 3 = FAILED.
 */

import { getRechargekitBaseUrl, getRechargekitApiToken } from './config'

export interface RechargekitStatusResult {
  /** true if we got a parseable provider response */
  ok: boolean
  /** provider business status: 1 success, 2 pending, 3 failed; NaN if unknown */
  status: number
  orderId: string
  operatorRef: string
  amount: number | null
  msg: string
  raw: any
}

export async function rechargekitStatusCheck(requestId: string): Promise<RechargekitStatusResult> {
  const base = getRechargekitBaseUrl().replace(/\/$/, '')
  const token = getRechargekitApiToken()
  const url = `${base}/recharge/statusCheck`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ partner_request_id: requestId }),
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json().catch(() => ({}))

    return {
      ok: true,
      status: Number(data?.status),
      orderId: data?.orderid || '',
      operatorRef: data?.optransid || '',
      amount: data?.amount != null ? Number(data.amount) : null,
      msg: data?.msg || data?.message || '',
      raw: data,
    }
  } catch (e: any) {
    return {
      ok: false,
      status: NaN,
      orderId: '',
      operatorRef: '',
      amount: null,
      msg: e?.message || 'status check failed',
      raw: null,
    }
  }
}
