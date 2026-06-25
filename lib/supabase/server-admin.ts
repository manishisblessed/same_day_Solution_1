import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseUrl, getSupabaseServiceKey, getEnv } from '@/lib/env'

const isBuildPhase =
  getEnv('NEXT_PHASE') === 'phase-production-build' ||
  getEnv('NEXT_PHASE') === 'phase-export'

let _supabaseAdmin: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (_supabaseAdmin) {
    return _supabaseAdmin
  }

  if (isBuildPhase) {
    _supabaseAdmin = createClient(
      'https://placeholder.supabase.co',
      'placeholder-key-for-build-phase-only'
    )
    return _supabaseAdmin
  }

  _supabaseAdmin = createClient(getSupabaseUrl(), getSupabaseServiceKey())
  return _supabaseAdmin
}

// For backward compatibility - exports a getter that initializes on first use
// WARNING: Direct access to supabaseAdmin may cause issues if env vars are not yet available
// Prefer using getSupabaseAdmin() function instead
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(target, prop) {
    const client = getSupabaseAdmin()
    return (client as any)[prop]
  }
})

