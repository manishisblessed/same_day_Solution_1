import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { secureStorage } from './secureStore';

const DF_KEY = 'device_fingerprint_v1';

/**
 * Stable per-install device fingerprint. The AEPS backend binds the daily 2FA
 * session to this value (DEVICE_CHANGED error if it differs). We derive it once
 * from durable device identifiers, hash it, cache it, and reuse it forever.
 */
export async function getDeviceFingerprint(): Promise<string> {
  const cached = await secureStorage.getItem(DF_KEY);
  if (cached) return cached;

  let seed = '';
  if (Platform.OS === 'android') {
    seed = Application.getAndroidId() ?? '';
  } else {
    seed = (await Application.getIosIdForVendorAsync()) ?? '';
  }
  seed +=
    `|${Device.modelName ?? ''}|${Device.osName ?? ''}|${Device.osVersion ?? ''}` +
    `|${Application.applicationId ?? ''}`;
  if (!seed.trim()) seed = Crypto.randomUUID();

  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, seed);
  const fingerprint = `DF_${hash.slice(0, 24)}`;
  await secureStorage.setItem(DF_KEY, fingerprint);
  return fingerprint;
}

export function newSessionToken(): string {
  return Crypto.randomUUID();
}
