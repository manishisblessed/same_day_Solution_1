import { NextRequest, NextResponse } from 'next/server'

/**
 * Test endpoint to verify environment variables are accessible
 * This helps debug Amplify environment variable issues
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    // Get all env vars that start with NEXT_PUBLIC or SUPABASE
    const allEnvVars = Object.keys(process.env)
      .filter(key => key.includes('SUPABASE') || key.includes('NEXT_PUBLIC'))
      .reduce((acc, key) => {
        acc[key] = process.env[key] ? 'Set' : 'Missing'
        return acc
      }, {} as Record<string, string>)

    return NextResponse.json({
      success: true,
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        NEXT_PHASE: process.env.NEXT_PHASE,
        AMPLIFY_ENV: process.env.AMPLIFY_ENV,
      },
      supabaseVariables: {
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl ? 'Set' : 'Missing',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey ? 'Set' : 'Missing',
        SUPABASE_SERVICE_ROLE_KEY: supabaseServiceKey ? 'Set' : 'Missing',
      },
      variableDetails: {
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl ? `${supabaseUrl.substring(0, 20)}...` : 'NOT SET',
        SUPABASE_SERVICE_ROLE_KEY: supabaseServiceKey ? `${supabaseServiceKey.substring(0, 20)}...` : 'NOT SET',
      },
      allSupabaseEnvVars: allEnvVars,
      message: supabaseUrl && supabaseServiceKey 
        ? 'All required environment variables are set!' 
        : 'Some environment variables are missing. Check Amplify console.',
    })
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    }, { status: 500 })
  }
}

