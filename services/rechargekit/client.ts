/**
 * HTTP client for Rechargekit API
 * Auth: Authorization: Bearer {api_token}
 */

import {
  getRechargekitBaseUrl,
  getRechargekitApiToken,
  getRechargekitTimeout,
  isRechargekitMockMode,
  validateRechargekitCredentials,
} from './config'
import { RECHARGEKIT_STATUS } from './types'

export interface RechargekitRequestResult<T = unknown> {
  ok: boolean
  status: number
  data?: T
  error?: string
  raw?: string
  /** Provider business status: 1 success, 2 pending, 3 failed */
  providerStatus?: number
}

export async function rechargekitRequest<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
    query?: Record<string, string>
  } = {}
): Promise<RechargekitRequestResult<T>> {
  const method = options.method || 'GET'

  if (isRechargekitMockMode()) {
    return { ok: false, status: 503, error: 'Rechargekit not called in mock mode' }
  }

  validateRechargekitCredentials()

  const base = getRechargekitBaseUrl().replace(/\/$/, '')
  let url = `${base}/${path.replace(/^\//, '')}`

  if (options.query && Object.keys(options.query).length > 0) {
    const qs = new URLSearchParams(options.query).toString()
    url += (url.includes('?') ? '&' : '?') + qs
  }

  const controller = new AbortController()
  const timeoutMs = getRechargekitTimeout()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${getRechargekitApiToken()}`,
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    }

    if (method === 'POST' && options.body) {
      headers['Content-Type'] = 'application/json'
      fetchOptions.body = JSON.stringify(options.body)
    }

    const res = await fetch(url, fetchOptions)
    const text = await res.text()

    let parsed: any
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      return {
        ok: false,
        status: res.status,
        error: text.startsWith('<')
          ? `Rechargekit returned HTML error (HTTP ${res.status})`
          : text.slice(0, 300),
        raw: text,
      }
    }

    // Payment APIs use status 1/2/3. List APIs may omit status or use HTTP success only.
    const hasStatusField = parsed?.status !== undefined && parsed?.status !== null && parsed?.status !== ''
    const providerStatus = hasStatusField ? Number(parsed.status) : undefined

    if (hasStatusField) {
      const isSuccessOrPending =
        providerStatus === RECHARGEKIT_STATUS.SUCCESS ||
        providerStatus === RECHARGEKIT_STATUS.PENDING

      if (!isSuccessOrPending) {
        return {
          ok: false,
          status: res.status,
          error: parsed.message || `Rechargekit error (status=${parsed.status})`,
          data: parsed as T,
          providerStatus,
        }
      }
    } else if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: parsed.message || `Rechargekit HTTP error ${res.status}`,
        data: parsed as T,
      }
    }

    return {
      ok: true,
      status: res.status,
      data: parsed as T,
      providerStatus,
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { ok: false, status: 408, error: `Rechargekit request timeout after ${timeoutMs}ms` }
    }
    return { ok: false, status: 0, error: e?.message || 'Rechargekit network error' }
  } finally {
    clearTimeout(timer)
  }
}

export async function rechargekitPost<T = unknown>(
  path: string,
  body: Record<string, unknown> = {}
): Promise<RechargekitRequestResult<T>> {
  return rechargekitRequest<T>(path, { method: 'POST', body })
}

export async function rechargekitGet<T = unknown>(
  path: string,
  query?: Record<string, string>
): Promise<RechargekitRequestResult<T>> {
  return rechargekitRequest<T>(path, { method: 'GET', query })
}
