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

  // Next.js App Router patches global fetch and persists GET responses to
  // `.next/cache/fetch-cache`. supabase-js reads go through fetch, so without
  // this the server would serve a STALE snapshot of every table (e.g. an
  // onboarding invite's verifications frozen at an old state), making freshly
  // written rows invisible. Force no-store on all admin-client requests.
  _supabaseAdmin = createClient(getSupabaseUrl(), getSupabaseServiceKey(), {
    global: {
      fetch: (input: any, init?: any) =>
        fetch(input, { ...(init || {}), cache: 'no-store' }),
    },
  })
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

