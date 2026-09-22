import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { secureStorage } from '@/lib/secureStore';
import { setUnauthorizedHandler, ApiError } from '@/lib/api';
import { newSessionToken } from '@/lib/device';
import { fetchMe, mobileLogin, registerSession, validateSession, endSession } from '@/api/auth';
import { AuthUser } from '@/api/types';

const SESSION_TOKEN_KEY = 'sd_session_token';

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
}

const AuthContext = createContext<AuthState>({} as AuthState);
export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kickedReason, setKickedReason] = useState<string | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  const doSignOut = useCallback(async (reason?: string) => {
    try {
      const token = sessionTokenRef.current || (await secureStorage.getItem(SESSION_TOKEN_KEY));
      if (token) await endSession(token);
    } catch {}
    await secureStorage.removeItem(SESSION_TOKEN_KEY);
    sessionTokenRef.current = null;
    await supabase.auth.signOut().catch(() => {});
    setUser(null);
    if (reason) setKickedReason(reason);
  }, []);

  // Wire 401s from the API client to a forced sign-out.
  useEffect(() => {
    setUnauthorizedHandler(() => {
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
    if (me.role !== 'retailer') {
      await doSignOut('This app is for retailers only.');
      return;
    }
    sessionTokenRef.current = await secureStorage.getItem(SESSION_TOKEN_KEY);
    setUser(me);
  }, [doSignOut]);

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

      const me = await fetchMe();
      if (!me) throw new Error('Could not load your account. Please try again.');
      if (me.role !== 'retailer') {
        await doSignOut();
        throw new Error('This app is for retailers only.');
      }

      // Register a single-session row (this ends any other active session).
      const token = newSessionToken();
      await registerSession({ session_token: token });
      await secureStorage.setItem(SESSION_TOKEN_KEY, token);
      sessionTokenRef.current = token;

      setUser(me);
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Sign in failed';
      setError(msg);
      throw new Error(msg);
    } finally {
      setSigningIn(false);
    }
  }, [doSignOut]);

  const refreshUser = useCallback(async () => {
    const me = await fetchMe();
    if (me?.role === 'retailer') setUser(me);
  }, []);

  // Detect being kicked (single-session enforcement) when app returns to foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || !sessionTokenRef.current) return;
      try {
        const res = await validateSession(sessionTokenRef.current);
        if (!res.valid) {
          const reason =
            res.reason === 'replaced'
              ? 'You were signed out because your account logged in elsewhere.'
              : 'Your session has ended. Please sign in again.';
          await doSignOut(reason);
        }
      } catch {}
    });
    return () => sub.remove();
  }, [doSignOut]);

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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
