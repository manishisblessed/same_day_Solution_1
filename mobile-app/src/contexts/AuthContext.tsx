import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase } from '@/lib/supabase';
import { secureStorage } from '@/lib/secureStore';
import { setUnauthorizedHandler, setReauthGate, ApiError } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { newSessionToken } from '@/lib/device';
import {
  fetchMe, mobileLogin, resolveMe, registerSession, validateSession, endSession,
  verifyTpin, fetchTpinStatusSafe,
} from '@/api/auth';
import { AuthUser } from '@/api/types';

const SESSION_TOKEN_KEY = 'sd_session_token';
const LAST_FULL_LOGIN_KEY = 'sd_last_full_login';
const HAS_TPIN_KEY = 'sd_has_tpin';
const ALLOWED_ROLES = new Set(['retailer', 'partner', 'master_partner', 'sub_partner']);

// ── Soft re-auth (bank-style session resume) ──────────────────────────────────
// When another device (e.g. web) logs in, this device's single-session row is
// marked "replaced". Instead of forcing a full credential sign-in, we drop into
// a soft locked state and let the user resume with biometric / TPIN — the
// Supabase refresh token is preserved, so no password is needed.
// Flag-gated for a one-line kill switch; fully reversible.
const SOFT_REAUTH_ENABLED = true;
// Force a full credential sign-in if the last password login is older than this.
const MAX_SOFT_RESUME_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ResumeResult { ok: boolean; error?: string }

interface AuthState {
  user: AuthUser | null;
  initializing: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: (reason?: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  kickedReason: string | null;
  clearKicked: () => void;
  // Soft re-auth
  reauthRequired: boolean;
  hasTpin: boolean;
  resumeWithBiometric: () => Promise<ResumeResult>;
  resumeWithTpin: (tpin: string) => Promise<ResumeResult>;
  cancelReauth: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({} as AuthState);
export const useAuth = () => useContext(AuthContext);

async function readHasTpin(): Promise<boolean> {
  try { return (await secureStorage.getItem(HAS_TPIN_KEY)) === '1'; } catch { return false; }
}

async function biometricAvailable(): Promise<boolean> {
  try {
    const [hw, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hw && enrolled;
  } catch { return false; }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kickedReason, setKickedReason] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [hasTpin, setHasTpin] = useState(false);
  const sessionTokenRef = useRef<string | null>(null);
  // Mirror of reauthRequired for use inside the 401 handler / AppState closures.
  const reauthRef = useRef(false);

  const setReauth = useCallback((on: boolean) => {
    reauthRef.current = on;
    setReauthRequired(on);
    setReauthGate(on); // block non-resume API calls while paused
  }, []);

  const doSignOut = useCallback(async (reason?: string) => {
    try {
      const token = sessionTokenRef.current || (await secureStorage.getItem(SESSION_TOKEN_KEY));
      if (token) await endSession(token);
    } catch {}
    await secureStorage.removeItem(SESSION_TOKEN_KEY);
    await secureStorage.removeItem(LAST_FULL_LOGIN_KEY);
    await secureStorage.removeItem(HAS_TPIN_KEY);
    sessionTokenRef.current = null;
    setReauth(false);
    await supabase.auth.signOut().catch(() => {});
    setUser(null);
    if (reason) setKickedReason(reason);
  }, [setReauth]);

  // Enter the SOFT locked state: keep the Supabase session + user context alive,
  // just require a biometric / TPIN to reclaim the single-session slot.
  const enterReauth = useCallback(async () => {
    setHasTpin(await readHasTpin());
    setReauth(true);
  }, [setReauth]);

  // Can this device offer a credential-free resume right now?
  const canSoftResume = useCallback(async () => {
    if (!SOFT_REAUTH_ENABLED) return false;
    if (await readHasTpin()) return true;
    return biometricAvailable();
  }, []);

  // Shared reclaim: re-register the single-session row + re-fetch profile.
  // Assumes the caller already proved identity (biometric or TPIN).
  const reclaimSession = useCallback(async (): Promise<ResumeResult> => {
    try {
      // Mitigation: cap the age of credential-free resumes. Fail CLOSED when the
      // baseline is missing (e.g. tampered storage) — require a password login.
      const last = Number(await secureStorage.getItem(LAST_FULL_LOGIN_KEY)) || 0;
      if (!last || Date.now() - last > MAX_SOFT_RESUME_AGE_MS) {
        await doSignOut('For your security, please sign in with your password again.');
        return { ok: false, error: 'max_age' };
      }
      // Fail closed if the Supabase session is actually gone.
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        await doSignOut('Your session has expired. Please sign in again.');
        return { ok: false, error: 'no_session' };
      }
      // Reclaim the single-session slot (ends other devices — explicit user action).
      const token = newSessionToken();
      await registerSession({ session_token: token });
      await secureStorage.setItem(SESSION_TOKEN_KEY, token);
      sessionTokenRef.current = token;

      const me = await fetchMe();
      if (!me || !ALLOWED_ROLES.has(me.role)) {
        await doSignOut('Your session has expired. Please sign in again.');
        return { ok: false, error: 'profile' };
      }
      setUser(me);
      setReauth(false);
      queryClient.invalidateQueries();
      return { ok: true };
    } catch (e: any) {
      // Token truly dead / network-auth failure → fall through to hard sign-in.
      await doSignOut('Your session has expired. Please sign in again.');
      return { ok: false, error: e?.message || 'resume_failed' };
    }
  }, [doSignOut, setReauth]);

  const resumeWithBiometric = useCallback(async (): Promise<ResumeResult> => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Verify your identity to resume your session',
      fallbackLabel: 'Use device passcode',
      disableDeviceFallback: false,
    });
    if (!res.success) return { ok: false, error: 'biometric_failed' };
    return reclaimSession();
  }, [reclaimSession]);

  const resumeWithTpin = useCallback(async (tpin: string): Promise<ResumeResult> => {
    try {
      const v = await verifyTpin(tpin);
      if (!v.success) {
        const extra = v.attempts_remaining != null ? ` (${v.attempts_remaining} attempts left)` : '';
        return { ok: false, error: (v.error || 'Incorrect TPIN') + extra };
      }
    } catch (e: any) {
      return { ok: false, error: e instanceof ApiError ? e.message : 'Could not verify TPIN' };
    }
    return reclaimSession();
  }, [reclaimSession]);

  const cancelReauth = useCallback(async () => {
    await doSignOut();
  }, [doSignOut]);

  // Wire 401s from the API client to a forced sign-out — EXCEPT while we're
  // already in the soft re-auth state (expected inactive-session 401s from
  // screens still mounted under the overlay; the resume flow handles auth).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (reauthRef.current) return;
      doSignOut('Your session has expired. Please sign in again.');
    });
  }, [doSignOut]);

  const bootstrapFromSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setUser(null);
      return;
    }
    const me = await fetchMe();
    if (!me) {
      await doSignOut();
      return;
    }
    if (!ALLOWED_ROLES.has(me.role)) {
      await doSignOut('This app supports retailer and partner accounts only.');
      return;
    }
    sessionTokenRef.current = await secureStorage.getItem(SESSION_TOKEN_KEY);
    setHasTpin(await readHasTpin());
    // Establish a resume-age baseline for sessions that predate this feature so
    // the 7-day cap is enforced from first launch rather than bypassed.
    if (!(await secureStorage.getItem(LAST_FULL_LOGIN_KEY))) {
      await secureStorage.setItem(LAST_FULL_LOGIN_KEY, String(Date.now()));
    }
    // Backfill the cached TPIN flag for sessions that predate this feature, so
    // the first web-takeover can offer TPIN resume without a wasted hard login.
    fetchTpinStatusSafe().then(async (s) => {
      if (s) { await secureStorage.setItem(HAS_TPIN_KEY, s.tpin_enabled ? '1' : '0'); setHasTpin(!!s.tpin_enabled); }
    }).catch(() => {});

    // Cold-start: if our own session row was replaced while the app was closed,
    // resume softly instead of silently running with a stolen single-session.
    if (sessionTokenRef.current) {
      try {
        const v = await validateSession(sessionTokenRef.current);
        if (!v.valid) {
          if (v.reason === 'replaced' && (await canSoftResume())) {
            setUser(me);
            await enterReauth();
            return;
          }
          await doSignOut(
            v.reason === 'replaced'
              ? 'You were signed out because your account logged in elsewhere.'
              : 'Your session has ended. Please sign in again.'
          );
          return;
        }
      } catch { /* network — proceed; AppState validator re-checks on foreground */ }
    }
    setUser(me);
  }, [doSignOut, canSoftResume, enterReauth]);

  useEffect(() => {
    (async () => {
      try {
        await bootstrapFromSession();
      } finally {
        setInitializing(false);
      }
    })();
  }, [bootstrapFromSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    setSigningIn(true);
    setError(null);
    try {
      // Authenticate through the backend (service-role bypasses the CAPTCHA
      // that a native app can't render), then hydrate the Supabase client.
      const { access_token, refresh_token } = await mobileLogin(email, password);
      const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
      if (setErr) throw new Error(setErr.message);

      const me = await resolveMe(email);
      if (!me) throw new Error('Could not load your account. Please try again.');
      if (!ALLOWED_ROLES.has(me.role)) {
        await doSignOut();
        throw new Error('This app supports retailer and partner accounts only.');
      }

      // Register a single-session row (this ends any other active session).
      const token = newSessionToken();
      await registerSession({ session_token: token });
      await secureStorage.setItem(SESSION_TOKEN_KEY, token);
      sessionTokenRef.current = token;
      setReauth(false);

      // Record the full-login timestamp (age cap) + cache the TPIN-enabled flag
      // so the re-auth screen can decide which factors to offer without a call.
      await secureStorage.setItem(LAST_FULL_LOGIN_KEY, String(Date.now()));
      fetchTpinStatusSafe().then(async (s) => {
        const on = !!s?.tpin_enabled;
        await secureStorage.setItem(HAS_TPIN_KEY, on ? '1' : '0');
        setHasTpin(on);
      }).catch(() => {});

      setUser(me);
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Sign in failed';
      setError(msg);
      throw new Error(msg);
    } finally {
      setSigningIn(false);
    }
  }, [doSignOut, setReauth]);

  const refreshUser = useCallback(async () => {
    const me = await fetchMe();
    if (me && ALLOWED_ROLES.has(me.role)) setUser(me);
    // Keep the cached TPIN flag fresh (e.g. after the user sets a TPIN).
    fetchTpinStatusSafe().then(async (s) => {
      const on = !!s?.tpin_enabled;
      await secureStorage.setItem(HAS_TPIN_KEY, on ? '1' : '0');
      setHasTpin(on);
    }).catch(() => {});
  }, []);

  // Detect being kicked (single-session enforcement) when app returns to foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || reauthRef.current || !sessionTokenRef.current) return;
      try {
        const res = await validateSession(sessionTokenRef.current);
        if (res.valid) return;
        if (res.reason === 'replaced' && (await canSoftResume())) {
          await enterReauth();
          return;
        }
        await doSignOut(
          res.reason === 'replaced'
            ? 'You were signed out because your account logged in elsewhere.'
            : 'Your session has ended. Please sign in again.'
        );
      } catch {}
    });
    return () => sub.remove();
  }, [doSignOut, canSoftResume, enterReauth]);

  return (
    <AuthContext.Provider
      value={{
        user,
        initializing,
        signingIn,
        error,
        signIn,
        signOut: doSignOut,
        refreshUser,
        kickedReason,
        clearKicked: () => setKickedReason(null),
        reauthRequired,
        hasTpin,
        resumeWithBiometric,
        resumeWithTpin,
        cancelReauth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
