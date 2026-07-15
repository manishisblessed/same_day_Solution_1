/**
 * Runtime environment variable access that bypasses webpack DefinePlugin.
 * 
 * Next.js/webpack replaces `process.env.VARIABLE_NAME` (dot notation) with
 * literal values at build time. Bracket notation prevents this static analysis.
 */

const _env = process['env'];

export function getEnv(key: string): string | undefined {
  return _env[key] || undefined;
}

export function getRequiredEnv(key: string): string {
  const val = _env[key];
  if (!val) {
    throw new Error(`Required env var ${key} is not set`);
  }
  return val;
}

export function getSupabaseUrl(): string {
  const url = _env['NEXT_PUBLIC_SUPABASE_URL']
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  return url
}

export function getSupabaseServiceKey(): string {
  const key = _env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not available at runtime');
  }
  return key;
}

export function getSupabaseAnonKey(): string {
  return _env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || '';
}
