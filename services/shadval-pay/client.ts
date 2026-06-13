/**
 * SHADVAL PAY PRIVATE LIMITED - API Client
 * HMAC-SHA256 signature generation + HTTP client
 */

import { createHmac } from 'crypto'
import {
  getShadvalKey,
  getShadvalBaseUrl,
  getShadvalBalanceEndpoint,
  getShadvalPayoutEndpoint,
  getShadvalStatusEndpoint,
  getShadvalTimeout,
  isShadvalMockMode,
  validateShadvalCredentials,
} from './config'
import type {
  ShadvalBalanceResponse,
  ShadvalTransferRequest,
  ShadvalTransferResponse,
  ShadvalStatusRequest,
  ShadvalStatusResponse,
} from './types'

/**
 * Generate HMAC-SHA256 signature for bank transfer requests.
 *
 * Plain Text formula (from SHADVAL docs):
 *   ShadvalKey + " payload " + ShadvalKey + ref_no + amount
 * Key: ShadvalKey
 */
export function generateSignature(referenceId: string, amount: number): string {
  const key = getShadvalKey()
  const plainText = `${key} payload ${key}${referenceId}${amount}`
  return createHmac('sha256', key).update(plainText).digest('hex')
}

function getAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': getShadvalKey(),
  }
}

function log(api: string, reqId: string, extra?: Record<string, any>): void {
  console.log('[ShadvalPay]', JSON.stringify({
    api, reqId, timestamp: new Date().toISOString(), ...extra,
  }))
}

function logError(api: string, reqId: string, error: string): void {
  console.error('[ShadvalPay ERROR]', JSON.stringify({
    api, reqId, error, timestamp: new Date().toISOString(),
  }))
}

// ── Balance Check ────────────────────────────────────────────────

export async function getBalance(): Promise<ShadvalBalanceResponse> {
  const reqId = `SVBAL_${Date.now()}`

  if (isShadvalMockMode()) {
    log('balance', reqId, { mode: 'MOCK' })
    return {
      status: 'SUCCESS',
      code: 'SP100',
      message: 'Payout Wallet Balance Fetched Successfully.',
      data: { balance: '10000.00' },
    }
  }

  validateShadvalCredentials()
  log('balance', reqId)

  const url = `${getShadvalBaseUrl()}/${getShadvalBalanceEndpoint()}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), getShadvalTimeout())

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({}),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const data: ShadvalBalanceResponse = await response.json()
    log('balance', reqId, { status: data.status, code: data.code, url })
    return data
  } catch (error: any) {
    clearTimeout(timeoutId)
    const msg = error.name === 'AbortError'
      ? `Request timeout after ${getShadvalTimeout()}ms`
      : error.message || 'Network error'
    logError('balance', reqId, msg)
    return { status: 'FAILED', code: 'NETWORK_ERROR', message: msg }
  }
}

// ── Initiate Bank Transfer ───────────────────────────────────────

export async function initiateBankTransfer(
  request: ShadvalTransferRequest
): Promise<ShadvalTransferResponse> {
  const reqId = `SVTXN_${Date.now()}`

  if (isShadvalMockMode()) {
    log('transfer', reqId, { mode: 'MOCK', ref: request.reference_id })

    const acct = request.fund_account.account_number
    let mockStatus: 'SUCCESS' | 'FAILED' = 'SUCCESS'
    let mockMessage = 'Transfer Successful.'

    if (acct === '1234569870') {
      mockStatus = 'FAILED'
      mockMessage = 'Transfer Failed.'
    }

    if (mockStatus === 'SUCCESS') {
      return {
        status: 'SUCCESS',
        code: 'SP100',
        message: mockMessage,
        data: {
          reference_id: request.reference_id,
          order_id: `MOCK_${Date.now()}`,
          trans_amount: request.amount,
          utr: `MOCK_UTR_${Date.now()}`,
          mode: request.mode,
          internal_ref_id: `MOCK_INT_${Date.now()}`,
          wallet: {
            trans_amount: request.amount,
            charges: 5.90,
            total_value: request.amount + 5.90,
            trans_mode: 'DR',
          },
          fund_account: request.fund_account,
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        },
      }
    }

    return { status: 'FAILED', code: 'SP999', message: mockMessage }
  }

  validateShadvalCredentials()

  const signature = generateSignature(request.reference_id, request.amount)
  log('transfer', reqId, { ref: request.reference_id, amount: request.amount })

  const url = `${getShadvalBaseUrl()}/${getShadvalPayoutEndpoint()}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), getShadvalTimeout())

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Signature': signature,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const data: ShadvalTransferResponse = await response.json()

    // Handle malformed response from provider (e.g. .NET exceptions)
    if (!data.status && !data.code) {
      const errorMsg = (data as any).Message || (data as any).ExceptionMessage || 'Unknown provider error'
      logError('transfer', reqId, `Malformed response: ${errorMsg}`)
      return { status: 'FAILED', code: 'SP105', message: 'Payout service is currently unavailable.Payout service will be up and running very soon. Thank you for your patience !!' }
    }

    log('transfer', reqId, { status: data.status, code: data.code, order_id: data.data?.order_id })
    return data
  } catch (error: any) {
    clearTimeout(timeoutId)
    const msg = error.name === 'AbortError'
      ? `Request timeout after ${getShadvalTimeout()}ms`
      : error.message || 'Network error'
    logError('transfer', reqId, msg)
    return { status: 'FAILED', code: 'NETWORK_ERROR', message: msg }
  }
}

// ── Check Transaction Status ─────────────────────────────────────

export async function checkTransactionStatus(
  request: ShadvalStatusRequest
): Promise<ShadvalStatusResponse> {
  const reqId = `SVSTS_${Date.now()}`

  if (isShadvalMockMode()) {
    log('status', reqId, { mode: 'MOCK', ref: request.reference_id })
    return {
      status: 'SUCCESS',
      code: 'SP100',
      message: 'Status API Executed Successfully.',
      data: {
        txn_datetime: new Date().toISOString().replace('T', ' ').substring(0, 19),
        txn_status: 'Transaction Successful',
        reference_id: request.reference_id,
        status_message: 'Transaction Successful',
        order_id: `MOCK_${Date.now()}`,
        trans_amount: 1.00,
        utr: `MOCK_UTR_${Date.now()}`,
        mode: 'IMPS',
        internal_ref_id: `MOCK_INT_${Date.now()}`,
        wallet: {
          transaction: {
            trans_amount: 1.00,
            charges: 5.90,
            total_value: 6.90,
            trans_mode: 'DR',
            debit_datetime: new Date().toISOString().replace('T', ' ').substring(0, 19),
          },
        },
        fund_account: {
          name: 'TEST USER',
          ifsc: 'SBIN0001234',
          account_number: '9632587410',
        },
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      },
    }
  }

  validateShadvalCredentials()
  log('status', reqId, { ref: request.reference_id })

  const url = `${getShadvalBaseUrl()}/${getShadvalStatusEndpoint()}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), getShadvalTimeout())

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const data: ShadvalStatusResponse = await response.json()
    log('status', reqId, { status: data.status, code: data.code, txn_status: data.data?.txn_status })
    return data
  } catch (error: any) {
    clearTimeout(timeoutId)
    const msg = error.name === 'AbortError'
      ? `Request timeout after ${getShadvalTimeout()}ms`
      : error.message || 'Network error'
    logError('status', reqId, msg)
    return { status: 'FAILED', code: 'NETWORK_ERROR', message: msg }
  }
}
