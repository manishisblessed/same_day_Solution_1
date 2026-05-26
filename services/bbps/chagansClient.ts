/**
 * HTTP client for Chagans BBPS API (https://chagans.com)
 * Headers: client-id, client-secret, authorization Bearer, apiType: bbps, Content-Type: application/json
 */

import {
  getAPITimeout,
  getBBPSProvider,
  getChagansAuthToken,
  getChagansBaseUrl,
  getChagansClientId,
  getChagansClientSecret,
  isMockMode,
  validateChagansCredentials,
} from './config'

export interface ChagansRequestResult<T = unknown> {
  ok: boolean
  status: number
  data?: T
  error?: string
  raw?: string
  routeNotFound?: boolean
}

function normalizeChagansError(text: string, status: number): {
  message: string
  routeNotFound: boolean
} {
  const trimmed = text.trim()
  const cannotPost = trimmed.match(/Cannot POST \/([^\s<]+)/i)
  const cannotGet = trimmed.match(/Cannot GET \/([^\s<]+)/i)
  if (cannotPost || cannotGet) {
    const route = cannotPost?.[1] || cannotGet?.[1] || 'unknown'
    return {
      message: `Chagans API route not found: /${route}`,
      routeNotFound: true,
    }
  }
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    return {
      message:
        status === 404
          ? 'Chagans API route not found'
          : `Chagans returned HTML error (HTTP ${status})`,
      routeNotFound: status === 404,
    }
  }
  return { message: trimmed.slice(0, 300) || `HTTP ${status}`, routeNotFound: false }
}

export async function chagansRequest<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
    apiType?: string
  } = {}
): Promise<ChagansRequestResult<T>> {
  const method = options.method || 'POST'
  const body = options.body || {}
  const apiType = options.apiType || 'bbps'
  if (isMockMode()) {
    return { ok: false, status: 503, error: 'Chagans API not called in BBPS mock mode' }
  }
  if (getBBPSProvider() !== 'chagans') {
    return { ok: false, status: 500, error: 'chagansPost called while BBPS_PROVIDER is not chagans' }
  }

  validateChagansCredentials()

  const base = getChagansBaseUrl().replace(/\/$/, '')
  const url = `${base}/${path.replace(/^\//, '')}`

  const controller = new AbortController()
  const timeoutMs = getAPITimeout()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'client-id': getChagansClientId(),
        'client-secret': getChagansClientSecret(),
        authorization: `Bearer ${getChagansAuthToken()}`,
        apiType,
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })

    const text = await res.text()
    let parsed: any
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      const normalized = normalizeChagansError(text, res.status)
      return {
        ok: false,
        status: res.status,
        error: normalized.message,
        raw: text,
        routeNotFound: normalized.routeNotFound,
      }
    }

    if (!res.ok || parsed.success === false) {
      const errField = parsed.error
      const msg =
        parsed.message ||
        (typeof errField === 'object' && errField?.message ? String(errField.message) : null) ||
        (typeof errField === 'string' ? errField : null) ||
        (Array.isArray(parsed.details) ? parsed.details.map((d: any) => d.message).join('; ') : null) ||
        `HTTP ${res.status}`
      return { ok: false, status: res.status, error: msg, data: parsed }
    }

    return { ok: true, status: res.status, data: parsed as T }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { ok: false, status: 408, error: `Chagans request timeout after ${timeoutMs}ms` }
    }
    return { ok: false, status: 0, error: e?.message || 'Chagans network error' }
  } finally {
    clearTimeout(timer)
  }
}

export async function chagansPost<T = unknown>(
  path: string,
  body: Record<string, unknown> = {}
): Promise<ChagansRequestResult<T>> {
  return chagansRequest<T>(path, { method: 'POST', body })
}
