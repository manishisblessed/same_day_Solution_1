import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { ENV } from '@/config/env';

export interface UpdateInfo {
  required: boolean;
  available: boolean;
  latestVersion?: string;
  message?: string;
  storeUrl?: string;
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Checks a remote manifest (EXPO_PUBLIC_UPDATE_MANIFEST_URL) for the minimum and
 * latest app versions. Host a small JSON like:
 *   { "minVersion": "1.0.0", "latestVersion": "1.2.0",
 *     "android": "https://play.google.com/...", "ios": "https://apps.apple.com/...",
 *     "message": "Please update to continue." }
 * If no URL is configured, this is a no-op.
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const none: UpdateInfo = { required: false, available: false };
  if (!ENV.UPDATE_MANIFEST_URL) return none;
  try {
    const res = await fetch(ENV.UPDATE_MANIFEST_URL, { cache: 'no-store' as any });
    if (!res.ok) return none;
    const m = await res.json();
    const current = Constants.expoConfig?.version ?? '1.0.0';
    const min = m.minVersion as string | undefined;
    const latest = m.latestVersion as string | undefined;
    const storeUrl = Platform.OS === 'ios' ? m.ios : m.android;
    return {
      required: !!min && cmpVersion(current, min) < 0,
      available: !!latest && cmpVersion(current, latest) < 0,
      latestVersion: latest,
      message: m.message,
      storeUrl,
    };
  } catch {
    return none;
  }
}
