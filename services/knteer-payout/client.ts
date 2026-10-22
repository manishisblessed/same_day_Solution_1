/**
 * Knteer Solution Payout — HTTP Client
 *
 * Generates a fresh JWT per request (HS256, 4.5-min TTL).
 */

import { getKnteerBaseUrl, getKnteerTimeout, isKnteerMockMode, validateKnteerCredentials } from './config'
import { createKnteerJwt, generateRefId } from './auth'

export interface KnteerRequestOptions {
  method: 'GET' | 'POST'
  endpoint: string
  body?: Record<string, unknown>
  /** If provided this refId is used in the JWT (for do-transaction it equals partnerTransId) */
  refId?: string
}

export interface KnteerClientResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  httpStatus?: number
}

function log(label: string, extra?: Record<string, unknown>): void {
  console.log(`[Knteer] ${label}`, extra ? JSON.stringify(extra) : '')
}

function logError(label: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[Knteer ERROR] ${label}`, msg)
}

class KnteerClient {
  private baseUrl: string
  private timeout: number

  constructor() {
    this.baseUrl = getKnteerBaseUrl()
    this.timeout = getKnteerTimeout()
  }

  async request<T = unknown>(opts: KnteerRequestOptions): Promise<KnteerClientResponse<T>> {
    const { method, endpoint, body } = opts
    const refId = opts.refId || generateRefId()

    if (isKnteerMockMode()) {
      log(`MOCK ${method} ${endpoint}`, { refId })
      return { success: true, data: this.mockResponse(endpoint) as T, httpStatus: 200 }
    }

    try {
      validateKnteerCredentials()
    } catch (err) {
      logError(`credential validation ${endpoint}`, err)
      return { success: false, error: (err as Error).message }
    }

    const jwt = createKnteerJwt(refId)
    const url = `${this.baseUrl}${endpoint}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    log(`${method} ${endpoint}`, { refId })

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      clearTimeout(timer)

      const text = await res.text()
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        data = { raw: text }
      }

      log(`${method} ${endpoint} → ${res.status}`, { refId })

      if (!res.ok) {
        return { success: false, error: (data as any)?.message || res.statusText, httpStatus: res.status, data: data as T }
      }
      return { success: true, data: data as T, httpStatus: res.status }
    } catch (err: any) {
      clearTimeout(timer)
      if (err.name === 'AbortError') {
        logError(`timeout ${endpoint}`, `${this.timeout}ms exceeded`)
        return { success: false, error: `Request timeout after ${this.timeout}ms` }
      }
      logError(`network ${endpoint}`, err)
      return { success: false, error: err.message || 'Network error' }
    }
  }

  private mockResponse(endpoint: string): unknown {
    if (endpoint.includes('wallet/balance')) {
      return { UsableWallet: 50000, CollectionWallet: 0, status: true, code: 273, message: 'Balance Fetch Successfully' }
    }
    if (endpoint.includes('add-bene')) {
      return { data: { beneCode: `BENI_MOCK_${Date.now()}` }, status: true, code: 276, message: 'Successfully Registerd!!' }
    }
    if (endpoint.includes('do-transaction')) {
      return {
        code: 238, status: false, message: 'Transaction Pending',
        List: [{ StatusId: 3, partnerTransId: 'MOCK', transId: `KSPH_MOCK_${Date.now()}`, amount: 100, utr: '', mobile: '9999999999', accountNumber: '****1234', ifsc: 'SBIN0001234', beneficiaryName: 'MOCK USER' }],
      }
    }
    if (endpoint.includes('statusenquiry')) {
      return {
        data: { StatusId: 4, partnerTransId: 'MOCK', transId: `KSPH_MOCK_${Date.now()}`, amount: 100, utr: `UTR${Date.now()}`, mobile: '9999999999', accountNumber: '****1234', ifsc: 'SBIN0001234', beneficiaryName: 'MOCK USER' },
        status: true, code: 204, message: 'Record Found',
      }
    }
    return { status: true, code: 200, message: 'Mock response' }
  }
}

export const knteerClient = new KnteerClient()
