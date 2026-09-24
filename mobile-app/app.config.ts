import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Runtime config. Secrets are NOT hardcoded — they come from env vars at build
 * time (EAS) or from a local `.env`-style shell. The Supabase URL + anon key are
 * public by design (safe to ship in a client). Fill these via EAS secrets or an
 * `.env` loaded by your shell before `expo start`.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Where the Next.js /api/* routes live. Prod = EC2 backend.
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.samedaysolution.in';

// Optional: URL to a JSON manifest that drives the force-update gate.
const UPDATE_MANIFEST_URL = process.env.EXPO_PUBLIC_UPDATE_MANIFEST_URL ?? '';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Same Day Solution',
  slug: 'sameday-retailer',
  owner: 'sameday-solutions-private-limited',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'samedayretailer',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  backgroundColor: '#F4F6FB',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'in.samedaysolution.retailer',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'in.samedaysolution.retailer',
    permissions: [
      'USE_BIOMETRIC',
      'USE_FINGERPRINT',
      'INTERNET',
      'ACCESS_NETWORK_STATE',
    ],
    // Mantra RD service intents must be visible under Android 11+ package visibility.
    // (Declared in a config plugin below via queries if needed.)
  },
  plugins: [
    'expo-secure-store',
    'expo-local-authentication',
    'expo-notifications',
    [
      'expo-build-properties',
      {
        android: { compileSdkVersion: 35, targetSdkVersion: 35, minSdkVersion: 24 },
      },
    ],
  ],
  extra: {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    apiBaseUrl: API_BASE_URL,
    updateManifestUrl: UPDATE_MANIFEST_URL,
    eas: { projectId: process.env.EAS_PROJECT_ID ?? 'fea6b170-3ee9-4811-b417-3a0bfd5b6398' },
  },
});
