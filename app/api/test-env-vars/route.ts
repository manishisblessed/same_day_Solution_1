import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Diagnostic endpoint to check environment variables
 * This bypasses apiHandler to show raw environment variable status
 */
export async function GET(request: NextRequest) {
  // Log to CloudWatch for debugging
  console.log('[Test Env Vars] Starting diagnostic check')
  console.log('[Test Env Vars] All process.env keys:', Object.keys(process.env).length)
  
  // Get all environment variables that start with SUPABASE or NEXT_PUBLIC
  const allEnvKeys = Object.keys(process.env).filter(key => 
    key.includes('SUPABASE') || key.includes('NEXT_PUBLIC') || key.includes('AMPLIFY')
  )
  
  console.log('[Test Env Vars] Filtered env keys:', allEnvKeys)

  // Check specific variables
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Detailed diagnostics
  const diagnostics = {
    // Check if variable exists
    serviceRoleKeyExists: serviceRoleKey !== undefined,
    serviceRoleKeyType: typeof serviceRoleKey,
    serviceRoleKeyValue: serviceRoleKey ? `${serviceRoleKey.substring(0, 20)}...` : 'NOT_SET',
    serviceRoleKeyLength: serviceRoleKey?.length || 0,
    serviceRoleKeyIsEmpty: serviceRoleKey === '',
    serviceRoleKeyIsNull: serviceRoleKey === null,
    
    // Other Supabase vars
    supabaseUrlExists: supabaseUrl !== undefined,
    anonKeyExists: anonKey !== undefined,
    
    // All env vars with SUPABASE in name
    allSupabaseEnvVars: allEnvKeys.map(key => ({
      name: key,
      exists: process.env[key] !== undefined,
      length: process.env[key]?.length || 0,
      prefix: process.env[key]?.substring(0, 10) || 'NOT_SET'
    })),
    
    // Environment info
    nodeEnv: process.env.NODE_ENV,
    amplifyEnv: process.env.AMPLIFY_ENV,
    amplifyAppId: process.env.AMPLIFY_APP_ID,
    
    // Check for common typos
    possibleTypo1: process.env.SUPABASE_SERVICE_KEY !== undefined,
    possibleTypo2: process.env.SERVICE_ROLE_KEY !== undefined,
    possibleTypo3: process.env.SUPABASE_SERVICE_ROLE !== undefined,
  }

  return NextResponse.json({
    success: true,
    message: 'Environment variables diagnostic',
    diagnostics,
    recommendation: !diagnostics.serviceRoleKeyExists 
      ? 'SUPABASE_SERVICE_ROLE_KEY is not set. Please check AWS Amplify Environment Variables.'
      : diagnostics.serviceRoleKeyLength === 0
      ? 'SUPABASE_SERVICE_ROLE_KEY is empty. Please set a valid value in AWS Amplify.'
      : 'Environment variables appear to be set correctly.'
  })
}

