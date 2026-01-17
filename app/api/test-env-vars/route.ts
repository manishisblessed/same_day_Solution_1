import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-wrapper'

export const dynamic = 'force-dynamic'

async function handleTest(request: NextRequest) {
  // Test environment variables
  const envVars = {
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasSupabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrlLength: process.env.NEXT_PUBLIC_SUPABASE_URL?.length || 0,
    anonKeyLength: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.length || 0,
    serviceRoleKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0,
    serviceRoleKeyPrefix: process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 10) || 'NOT_SET',
    nodeEnv: process.env.NODE_ENV,
  }

  return NextResponse.json({
    success: true,
    message: 'Environment variables check',
    envVars,
    allPresent: envVars.hasSupabaseUrl && envVars.hasSupabaseAnonKey && envVars.hasServiceRoleKey
  })
}

export const GET = apiHandler(handleTest)

