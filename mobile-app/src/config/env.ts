import Constants from 'expo-constants';

type Extra = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
  updateManifestUrl?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const ENV = {
  SUPABASE_URL: extra.supabaseUrl ?? '',
  SUPABASE_ANON_KEY: extra.supabaseAnonKey ?? '',
  API_BASE_URL: (extra.apiBaseUrl ?? 'https://api.samedaysolution.in').replace(/\/$/, ''),
  UPDATE_MANIFEST_URL: extra.updateManifestUrl ?? '',
};

export function assertEnv() {
  const missing: string[] = [];
  if (!ENV.SUPABASE_URL) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!ENV.SUPABASE_ANON_KEY) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  return missing;
}
