import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Check if we're in build phase
// Next.js sets NEXT_PHASE during build, or we can infer from missing env vars
// and absence of runtime environment indicators
const isBuildPhase = 
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.NEXT_PHASE === 'phase-export' ||
  // If env vars are missing and we're not in a known runtime environment, assume build phase
  (typeof process !== 'undefined' && 
   !process.env.AWS_LAMBDA_FUNCTION_NAME &&
   !process.env.VERCEL &&
   (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL))

// Get environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Determine URL and key to use
let url: string
let key: string

if (isBuildPhase) {
  // During build phase, use placeholders to avoid errors
  // The client won't actually be used during build since API routes aren't executed
  url = supabaseUrl || 'https://placeholder.supabase.co'
  key = supabaseServiceKey || 'placeholder-key-for-build-phase-only'
} else {
  // Runtime: validate and use real values
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables. Please configure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }
  url = supabaseUrl
  key = supabaseServiceKey
}

// Create the client - during build this uses placeholders, at runtime it uses real values
export const supabaseAdmin: SupabaseClient = createClient(url, key)

