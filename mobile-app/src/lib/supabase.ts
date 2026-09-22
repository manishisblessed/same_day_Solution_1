import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { ENV } from '@/config/env';
import { secureStorage } from './secureStore';

/**
 * Supabase client for the retailer app. Auth session is persisted in the OS
 * keychain/keystore via expo-secure-store. Token auto-refresh is enabled so the
 * Bearer access token we attach to /api/* calls stays valid.
 */
export const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
