import { api } from '@/lib/api';
import { AuthUser } from './types';

export async function fetchMe(): Promise<AuthUser | null> {
  const res = await api.get<{ user: AuthUser | null }>('/api/auth/me', undefined, { silent401: true });
  return res.user ?? null;
}

/**
 * Resolve the profile immediately after sign-in, before a session row exists.
 * The GET variant runs an active-session check, which can't pass until
 * registerSession() has run — this POST variant skips it (same path the web uses).
 */
export async function resolveMe(email: string): Promise<AuthUser | null> {
  // The primary path resolves any role; the hint is only used in a race
  // fallback, so try retailer first, then partner (covers master/sub too).
  for (const roleHint of ['retailer', 'partner'] as const) {
    try {
      const res = await api.post<{ user: AuthUser | null }>(
        '/api/auth/me',
        { email: email.trim().toLowerCase(), roleHint },
        { silent401: true }
      );
      if (res.user) return res.user;
    } catch {}
  }
  return null;
}

export interface MobileLoginResult {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
}

/**
 * Password sign-in via the backend (service-role bypasses the project CAPTCHA
 * that native apps can't solve). Returns Supabase session tokens to hydrate the
 * client with supabase.auth.setSession().
 */
export function mobileLogin(email: string, password: string) {
  return api.post<MobileLoginResult>(
    '/api/auth/mobile-login',
    { email: email.trim().toLowerCase(), password },
    { silent401: true }
  );
}

export function registerSession(input: {
  session_token: string;
  geo_latitude?: number;
  geo_longitude?: number;
}) {
  return api.post<{ success: boolean }>('/api/auth/register-session', input, { silent401: true });
}

export function validateSession(session_token: string) {
  return api.post<{ valid: boolean; reason?: string }>('/api/auth/validate-session', { session_token });
}

export function endSession(session_token: string) {
  return api.post('/api/auth/end-session', { session_token }).catch(() => null);
}

// ── TPIN (required by every money-moving transaction) ──
export interface TpinStatus {
  has_tpin: boolean;
  is_locked: boolean;
  attempts_remaining?: number;
  locked_until?: string | null;
}

export function fetchTpinStatus() {
  return api.get<TpinStatus>('/api/tpin');
}

export function setTpin(tpin: string) {
  return api.post<{ success: boolean }>('/api/tpin', { tpin, action: 'set' });
}

export function verifyTpin(tpin: string) {
  return api.post<{ success: boolean }>('/api/tpin', { tpin, action: 'verify' });
}
