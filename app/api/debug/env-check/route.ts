import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Debug endpoint to check if environment variables are available at runtime
 * This helps diagnose AWS Amplify SSR issues
 * 
 * NOTE: Remove this endpoint before production deployment or add authentication
 */
export async function GET(request: NextRequest) {
  // Only allow in development or with debug header
  const debugHeader = request.headers.get('x-debug-key')
  const allowDebug = process.env.NODE_ENV === 'development' || debugHeader === 'same-day-solution-debug-2024'
  
  if (!allowDebug) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const envCheck = {
    timestamp: new Date().toISOString(),
    runtime: process.env.AWS_EXECUTION_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
    node_env: process.env.NODE_ENV,
    
    // Check Supabase variables (show only existence, not values)
    supabase: {
      NEXT_PUBLIC_SUPABASE_URL: {
        exists: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        length: process.env.NEXT_PUBLIC_SUPABASE_URL?.length || 0,
        startsWithHttps: process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('https://') || false,
      },
      NEXT_PUBLIC_SUPABASE_ANON_KEY: {
        exists: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        length: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.length || 0,
        startsWithEyJ: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.startsWith('eyJ') || false,
      },
      SUPABASE_SERVICE_ROLE_KEY: {
        exists: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        length: process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0,
        startsWithEyJ: process.env.SUPABASE_SERVICE_ROLE_KEY?.startsWith('eyJ') || false,
        isUndefined: process.env.SUPABASE_SERVICE_ROLE_KEY === undefined,
        isNull: process.env.SUPABASE_SERVICE_ROLE_KEY === null,
        isEmpty: process.env.SUPABASE_SERVICE_ROLE_KEY === '',
        type: typeof process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
    },
    
    // Check BBPS variables
    bbps: {
      BBPS_API_BASE_URL: {
        exists: !!process.env.BBPS_API_BASE_URL,
        value: process.env.BBPS_API_BASE_URL || 'not set',
      },
      BBPS_PARTNER_ID: {
        exists: !!process.env.BBPS_PARTNER_ID,
        length: process.env.BBPS_PARTNER_ID?.length || 0,
      },
      BBPS_CONSUMER_KEY: {
        exists: !!process.env.BBPS_CONSUMER_KEY,
        length: process.env.BBPS_CONSUMER_KEY?.length || 0,
      },
      BBPS_CONSUMER_SECRET: {
        exists: !!process.env.BBPS_CONSUMER_SECRET,
        length: process.env.BBPS_CONSUMER_SECRET?.length || 0,
      },
      USE_BBPS_MOCK: {
        exists: !!process.env.USE_BBPS_MOCK,
        value: process.env.USE_BBPS_MOCK || 'not set',
      },
    },
    
    // List all environment variable names (not values) for debugging
    allEnvVarNames: Object.keys(process.env).filter(key => 
      key.includes('SUPABASE') || 
      key.includes('BBPS') || 
      key.includes('NEXT_PUBLIC') ||
      key.includes('NODE_ENV') ||
      key.includes('AWS')
    ).sort(),
  }

  return NextResponse.json(envCheck, { status: 200 })
}

