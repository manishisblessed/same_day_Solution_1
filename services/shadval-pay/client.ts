/**
 * SHADVAL PAY PRIVATE LIMITED - API Client
 * HMAC-SHA256 signature generation + HTTP client
 */

import { createHmac } from 'crypto'
import { maskProviderBalanceError, SERVICE_DOWN_MESSAGE } from '@/lib/provider-error'
import {
  getShadvalKey,
  getShadvalVerificationKey,
  getShadvalBaseUrl,
  getShadvalBalanceEndpoint,
  getShadvalVerificationBalanceEndpoint,
  getShadvalAccountVerificationEndpoint,
  getShadvalPayoutEndpoint,
  getShadvalStatusEndpoint,
  getShadvalTimeout,
  isShadvalMockMode,
  validateShadvalCredentials,
} from './config'
import type {
  ShadvalBalanceResponse,
  ShadvalAccountVerificationRequest,
  ShadvalAccountVerificationResponse,
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

function getVerificationAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': getShadvalVerificationKey(),
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
      data: { balance: 10000.00 },
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

// ── Verification Wallet Balance Check ─────────────────────────────

export async function getVerificationBalance(): Promise<ShadvalBalanceResponse> {
  const reqId = `SVVBAL_${Date.now()}`

  if (isShadvalMockMode()) {
    log('verification_balance', reqId, { mode: 'MOCK' })
    return {
      status: 'SUCCESS',
      code: 'SP100',
      message: 'Verification Wallet Balance Fetched Successfully.',
      data: { balance: 500.00 },
    }
  }

  validateShadvalCredentials()
  log('verification_balance', reqId)

  const url = `${getShadvalBaseUrl()}/${getShadvalVerificationBalanceEndpoint()}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), getShadvalTimeout())

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getVerificationAuthHeaders(),
      body: JSON.stringify({}),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const data: ShadvalBalanceResponse = await response.json()
    log('verification_balance', reqId, { status: data.status, code: data.code, url })
    return data
  } catch (error: any) {
    clearTimeout(timeoutId)
    const msg = error.name === 'AbortError'
      ? `Request timeout after ${getShadvalTimeout()}ms`
      : error.message || 'Network error'
    logError('verification_balance', reqId, msg)
    return { status: 'FAILED', code: 'NETWORK_ERROR', message: msg }
  }
}

// ── Account Verification ──────────────────────────────────────────

/**
 * Signature: ShadvalKey + " payload " + account_number + " " + ifsc_code + " " + ref_num
 * Uses verification key. Passed in header as "Payload"
 */
function generateVerificationSignature(accountNumber: string, ifscCode: string, refNum: string): string {
  const key = getShadvalVerificationKey()
  const plainText = `${key} payload ${accountNumber} ${ifscCode} ${refNum}`
  return createHmac('sha256', key).update(plainText).digest('hex')
}

export async function verifyAccount(
  request: ShadvalAccountVerificationRequest
): Promise<ShadvalAccountVerificationResponse> {
  const reqId = `SVAV_${Date.now()}`

  if (isShadvalMockMode()) {
    log('account_verification', reqId, { mode: 'MOCK', ref: request.ref_num })
    const acct = request.account_number
    if (acct === '1122334477') {
      return {
        status: 'PENDING',
        code: 'SP301',
        message: 'Transaction Under Process',
        data: {
          ref_num: request.ref_num,
          order_id: `MOCK_AV_${Date.now()}`,
          account_number: request.account_number,
          ifsc_code: request.ifsc_code,
          name_at_bank: '',
          verification_status: false,
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        },
      }
    }
    if (acct === '1122334466') {
      return {
        status: 'FAILED',
        code: 'SP402',
        message: 'Invalid Account Number',
        data: {
          ref_num: request.ref_num,
          order_id: `MOCK_AV_${Date.now()}`,
          account_number: request.account_number,
          ifsc_code: request.ifsc_code,
          name_at_bank: '',
          verification_status: false,
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        },
      }
    }
    return {
      status: 'SUCCESS',
      code: 'SP100',
      message: 'Transaction Successful',
      data: {
        ref_num: request.ref_num,
        order_id: `MOCK_AV_${Date.now()}`,
        account_number: request.account_number,
        ifsc_code: request.ifsc_code,
        name_at_bank: 'MOCK TEST USER',
        verification_status: true,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      },
    }
  }

  validateShadvalCredentials()
  const signature = generateVerificationSignature(request.account_number, request.ifsc_code, request.ref_num)
  log('account_verification', reqId, { ref: request.ref_num, account: request.account_number })

  const url = `${getShadvalBaseUrl()}/${getShadvalAccountVerificationEndpoint()}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), getShadvalTimeout())

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...getVerificationAuthHeaders(),
        'Signature': signature,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const data: ShadvalAccountVerificationResponse = await response.json()
    log('account_verification', reqId, {
      status: data.status,
      code: data.code,
      verification_status: data.data?.verification_status,
      name_at_bank: data.data?.name_at_bank,
      providerMessage: data.message,
    })

    if (data.status !== 'SUCCESS' && data.message) {
      data.message = maskProviderBalanceError(data.message)
    }
    return data
  } catch (error: any) {
    clearTimeout(timeoutId)
    const msg = error.name === 'AbortError'
      ? `Request timeout after ${getShadvalTimeout()}ms`
      : error.message || 'Network error'
    logError('account_verification', reqId, msg)
    return { status: 'FAILED', code: 'NETWORK_ERROR', message: maskProviderBalanceError(msg) }
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/** Strip characters that payout APIs reject (periods, digits, symbols). Keep letters, spaces, hyphens. */
function sanitizeName(raw: string): string {
  return raw
    .replace(/[^A-Za-z\s\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'NA'
}

// ── Initiate Bank Transfer ───────────────────────────────────────

export async function initiateBankTransfer(
  request: ShadvalTransferRequest
): Promise<ShadvalTransferResponse> {
  request = {
    ...request,
    fund_account: { ...request.fund_account, name: sanitizeName(request.fund_account.name) },
    contact_details: { ...request.contact_details, name: sanitizeName(request.contact_details.name) },
  }

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
      return { status: 'FAILED', code: 'PROVIDER_ERROR', message: SERVICE_DOWN_MESSAGE }
    }

    log('transfer', reqId, { status: data.status, code: data.code, order_id: data.data?.order_id, providerMessage: data.message })

    // Provider low-balance errors (Shadval float exhausted) must not leak to
    // retailers as "insufficient wallet balance" — mask as service outage.
    if (data.status !== 'SUCCESS' && data.message) {
      data.message = maskProviderBalanceError(data.message)
    }
    return data
  } catch (error: any) {
    clearTimeout(timeoutId)
    const msg = error.name === 'AbortError'
      ? `Request timeout after ${getShadvalTimeout()}ms`
      : error.message || 'Network error'
    logError('transfer', reqId, msg)
    return { status: 'FAILED', code: 'NETWORK_ERROR', message: maskProviderBalanceError(msg) }
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
    log('status', reqId, { status: data.status, code: data.code, txn_status: data.data?.txn_status, status_message: data.data?.status_message })

    if (data.data?.status_message) {
      data.data.status_message = maskProviderBalanceError(data.data.status_message)
    }
    if (data.status !== 'SUCCESS' && data.message) {
      data.message = maskProviderBalanceError(data.message)
    }
    return data
  } catch (error: any) {
    clearTimeout(timeoutId)
    const msg = error.name === 'AbortError'
      ? `Request timeout after ${getShadvalTimeout()}ms`
      : error.message || 'Network error'
    logError('status', reqId, msg)
    return { status: 'FAILED', code: 'NETWORK_ERROR', message: maskProviderBalanceError(msg) }
  }
}
