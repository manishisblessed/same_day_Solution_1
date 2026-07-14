/**
 * HTTP client for Pay2New API
 * Auth: secret header
 */

import { maskProviderBalanceError, SERVICE_DOWN_MESSAGE } from '@/lib/provider-error'
import {
  getPay2NewBaseUrl,
  getPay2NewSecret,
  getPay2NewTimeout,
  isPay2NewMockMode,
  validatePay2NewCredentials,
} from './config'

export interface Pay2NewRequestResult<T = unknown> {
  ok: boolean
  status: number
  data?: T
  error?: string
  raw?: string
}

export async function pay2newRequest<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
  } = {}
): Promise<Pay2NewRequestResult<T>> {
  const method = options.method || 'POST'

  if (isPay2NewMockMode()) {
    return { ok: false, status: 503, error: 'Pay2New not called in mock mode' }
  }

  validatePay2NewCredentials()

  const base = getPay2NewBaseUrl().replace(/\/$/, '')
  const url = `${base}/${path.replace(/^\//, '')}`

  const controller = new AbortController()
  const timeoutMs = getPay2NewTimeout()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      secret: getPay2NewSecret(),
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    }

    if (method === 'POST' && options.body) {
      fetchOptions.body = JSON.stringify(options.body)
    }

    const res = await fetch(url, fetchOptions)
    const text = await res.text()

    let parsed: any
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      console.error('[Pay2New] Non-JSON response:', { path, status: res.status, body: text.slice(0, 300) })
      return {
        ok: false,
        status: res.status,
        error: text.startsWith('<') ? SERVICE_DOWN_MESSAGE : maskProviderBalanceError(text.slice(0, 300)),
        raw: text,
      }
    }

    const isSuccess = parsed.status === 1
    if (!isSuccess) {
      const rawError = parsed.message || `Pay2New error (status=${parsed.status})`
      // Provider low-balance errors (Pay2New float exhausted) must not leak to
      // retailers as "insufficient wallet balance" — mask as service outage.
      console.error('[Pay2New] Provider error:', { path, status: res.status, message: rawError })
      return {
        ok: false,
        status: res.status,
        error: maskProviderBalanceError(rawError),
        data: parsed as T,
      }
    }

    return { ok: true, status: res.status, data: parsed as T }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.error('[Pay2New] Request timeout:', { path, timeoutMs })
      return { ok: false, status: 408, error: SERVICE_DOWN_MESSAGE }
    }
    console.error('[Pay2New] Network error:', { path, message: e?.message })
    return { ok: false, status: 0, error: SERVICE_DOWN_MESSAGE }
  } finally {
    clearTimeout(timer)
  }
}

export async function pay2newPost<T = unknown>(
  path: string,
  body: Record<string, unknown> = {}
): Promise<Pay2NewRequestResult<T>> {
  return pay2newRequest<T>(path, { method: 'POST', body })
}

export async function pay2newGet<T = unknown>(
  path: string
): Promise<Pay2NewRequestResult<T>> {
  return pay2newRequest<T>(path, { method: 'GET' })
}
