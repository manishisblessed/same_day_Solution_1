import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Check if we're in build phase
// Next.js sets NEXT_PHASE during build
const isBuildPhase = 
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.NEXT_PHASE === 'phase-export'

// Lazy initialization for Supabase admin client
// This ensures environment variables are read at runtime, not at module load time
let _supabaseAdmin: SupabaseClient | null = null

/**
 * Get Supabase admin client with service role key
 * Uses lazy initialization to ensure env vars are available at runtime
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_supabaseAdmin) {
    return _supabaseAdmin
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // During build phase, return a placeholder client that will throw if used
  if (isBuildPhase) {
    console.log('[Supabase Admin] Build phase detected, using placeholder client')
    _supabaseAdmin = createClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseServiceKey || 'placeholder-key-for-build-phase-only'
    )
    return _supabaseAdmin
  }

  // Runtime validation
  if (!supabaseUrl) {
    console.error('[Supabase Admin] NEXT_PUBLIC_SUPABASE_URL is missing')
    console.error('[Supabase Admin] Available env vars:', Object.keys(process.env).filter(k => k.includes('SUPABASE')))
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')
  }

  if (!supabaseServiceKey) {
    console.error('[Supabase Admin] SUPABASE_SERVICE_ROLE_KEY is missing')
    console.error('[Supabase Admin] Available env vars:', Object.keys(process.env).filter(k => k.includes('SUPABASE')))
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured. Please add it to your environment variables.')
  }

  _supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
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

