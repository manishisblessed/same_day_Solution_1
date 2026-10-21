import { ExpoConfig, ConfigContext } from 'expo/config';
import { withAndroidManifest, AndroidConfig } from '@expo/config-plugins';

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

/**
 * Android 11+ (API 30+) package visibility: apps must declare every intent they
 * query in a <queries> block or the OS will return no results for that intent.
 * Without this, expo-intent-launcher cannot see the Mantra RD Service and the
 * AEPS fingerprint capture silently fails on any device running Android 11+.
 */
function withMantraRDQueries(config: ExpoConfig): ExpoConfig {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest as any;
    if (!manifest.queries) manifest.queries = [];
    manifest.queries.push({
      intent: [
        { action: [{ $: { 'android:name': 'in.gov.uidai.rdservice.fp.CAPTURE' } }] },
        { action: [{ $: { 'android:name': 'in.gov.uidai.rdservice.fp.INFO' } }] },
      ],
    });
    return c;
  });
}

export default ({ config }: ConfigContext): ExpoConfig =>
  withMantraRDQueries({
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

    // ─── App icon & splash ──────────────────────────────────────────────────
    icon: './assets/icon.png',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#111111',
    },

    ios: {
      supportsTablet: false,
      bundleIdentifier: 'in.samedaysolution.retailer',
      icon: './assets/icon.png',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'in.samedaysolution.retailer',
      // Adaptive icon shown on Android 8.0+ launchers (required for Play Store).
      // Replace with a proper foreground PNG (1024×1024, centered subject on transparent bg).
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#111111',
      },
      permissions: [
        'USE_BIOMETRIC',
        'USE_FINGERPRINT',
        'INTERNET',
        'ACCESS_NETWORK_STATE',
      ],
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
