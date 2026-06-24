import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'

const isBuildPhase = 
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.NEXT_PHASE === 'phase-export'

function loadEnvFromFile(varName: string): string | undefined {
  try {
    const envPath = join(process.cwd(), '.env.local')
    const content = readFileSync(envPath, 'utf-8')
    const match = content.match(new RegExp(`^${varName}=(.+)$`, 'm'))
    return match?.[1]?.trim()
  } catch { return undefined }
}

let _supabaseAdmin: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (_supabaseAdmin) {
    return _supabaseAdmin
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ohmvvtnfdvvatgofrzta.supabase.co'
  let supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseServiceKey) {
    supabaseServiceKey = loadEnvFromFile('SUPABASE_SERVICE_ROLE_KEY')
  }

  if (isBuildPhase) {
    _supabaseAdmin = createClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseServiceKey || 'placeholder-key-for-build-phase-only'
    )
    return _supabaseAdmin
  }

  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not found in process.env or .env.local')
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

