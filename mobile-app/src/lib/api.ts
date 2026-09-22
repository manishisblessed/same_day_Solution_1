import * as Crypto from 'expo-crypto';
import { ENV } from '@/config/env';
import { getAccessToken, supabase } from './supabase';

export class ApiError extends Error {
  status: number;
  code?: string;
  payload?: any;
  constructor(message: string, status: number, code?: string, payload?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

/** Called when the backend reports the session is no longer valid (401 / kicked). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Adds an Idempotency-Key header (money-moving POSTs). */
  idempotent?: boolean;
  /** Attach an X-Geo-Location header for activity logging. */
  geo?: { lat: number; lng: number; acc?: number };
  headers?: Record<string, string>;
  /** Skip the automatic onUnauthorized() on 401 (e.g. during login probing). */
  silent401?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: ApiOptions['query']): string {
  const base = path.startsWith('http') ? path : `${ENV.API_BASE_URL}${path}`;
  if (!query) return base;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base;
}

/**
 * Core request against the existing Next.js /api routes. Attaches the Supabase
 * access token as a Bearer header (the routes support token auth via
 * getCurrentUserWithFallback). Refreshes the token once on 401 before giving up.
 */
export async function apiRequest<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const doFetch = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(opts.headers ?? {}),
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (opts.idempotent) headers['Idempotency-Key'] = Crypto.randomUUID();
    if (opts.geo) {
      headers['X-Geo-Location'] = JSON.stringify({
        lat: opts.geo.lat, lng: opts.geo.lng, acc: opts.geo.acc, src: 'gps', ts: Date.now(),
      });
    }
    return fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  };

  let token = await getAccessToken();
  let res = await doFetch(token);

  if (res.status === 401) {
    // Try one forced refresh, then retry.
    const { data } = await supabase.auth.refreshSession();
    const refreshed = data.session?.access_token ?? null;
    if (refreshed && refreshed !== token) {
      token = refreshed;
      res = await doFetch(token);
    }
  }

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    if (res.status === 401 && !opts.silent401) onUnauthorized?.();
    const msg =
      json?.error || json?.message || json?.resultMsg || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, json?.error_code || json?.code, json);
  }

  return json as T;
}

export const api = {
  get: <T = any>(path: string, query?: ApiOptions['query'], opts?: ApiOptions) =>
    apiRequest<T>(path, { ...opts, method: 'GET', query }),
  post: <T = any>(path: string, body?: any, opts?: ApiOptions) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  del: <T = any>(path: string, query?: ApiOptions['query'], opts?: ApiOptions) =>
    apiRequest<T>(path, { ...opts, method: 'DELETE', query }),
};
