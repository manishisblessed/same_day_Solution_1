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
}

export async function chagansPost<T = unknown>(
  path: string,
  body: Record<string, unknown> = {}
): Promise<ChagansRequestResult<T>> {
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-id': getChagansClientId(),
        'client-secret': getChagansClientSecret(),
        authorization: `Bearer ${getChagansAuthToken()}`,
        apiType: 'bbps',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const text = await res.text()
    let parsed: any
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      return {
        ok: false,
        status: res.status,
        error: text?.slice(0, 300) || 'Non-JSON response',
        raw: text,
      }
    }

    if (!res.ok || parsed.success === false) {
      const msg =
        parsed.message ||
        parsed.error ||
        (Array.isArray(parsed.details) ? parsed.details.map((d: any) => d.message).join('; ') : null) ||
        `HTTP ${res.status}`
      return { ok: false, status: res.status, error: String(msg), data: parsed }
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
