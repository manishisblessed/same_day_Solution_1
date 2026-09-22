import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { secureStorage } from '@/lib/secureStore';

const LOCK_PREF_KEY = 'app_lock_enabled';
const LOCK_TIMEOUT_MS = 30_000; // re-lock after 30s in background

interface AppLockState {
  enabled: boolean;
  locked: boolean;
  supported: boolean;
  enrolled: boolean;
  toggle: (next: boolean) => Promise<boolean>;
  unlock: () => Promise<boolean>;
}

const AppLockContext = createContext<AppLockState>({} as AppLockState);
export const useAppLock = () => useContext(AppLockContext);

async function authenticate(reason: string): Promise<boolean> {
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    fallbackLabel: 'Use device passcode',
    disableDeviceFallback: false,
  });
  return res.success;
}

export const AppLockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [supported, setSupported] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      setSupported(hasHardware);
      setEnrolled(isEnrolled);
      const pref = (await secureStorage.getItem(LOCK_PREF_KEY)) === '1';
      if (pref && hasHardware && isEnrolled) {
        setEnabled(true);
        setLocked(true);
      }
    })();
  }, []);

  const unlock = useCallback(async () => {
    const ok = await authenticate('Unlock Sameday Retailer');
    if (ok) setLocked(false);
    return ok;
  }, []);

  const toggle = useCallback(async (next: boolean) => {
    if (next) {
      const ok = await authenticate('Confirm to enable App Lock');
      if (!ok) return false;
      await secureStorage.setItem(LOCK_PREF_KEY, '1');
      setEnabled(true);
      return true;
    }
    const ok = await authenticate('Confirm to disable App Lock');
    if (!ok) return false;
    await secureStorage.removeItem(LOCK_PREF_KEY);
    setEnabled(false);
    setLocked(false);
    return true;
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (!enabled) return;
      if (state === 'background' || state === 'inactive') {
        if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
      } else if (state === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (since != null && Date.now() - since > LOCK_TIMEOUT_MS) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [enabled]);

  return (
    <AppLockContext.Provider value={{ enabled, locked, supported, enrolled, toggle, unlock }}>
      {children}
    </AppLockContext.Provider>
  );
};
