import { NextRequest, NextResponse } from 'next/server'

/**
 * Wrapper for API route handlers that ensures ALL errors return JSON
 * This catches errors that occur even before the route handler executes
 */
export function apiHandler(
  handler: (request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    // Set JSON content type immediately
    const jsonHeaders = {
      'Content-Type': 'application/json',
    }

    try {
      // Log all environment variables for debugging (in production too, but masked)
      const allEnvKeys = Object.keys(process.env).filter(key => 
        key.includes('SUPABASE') || key.includes('AMPLIFY')
      )
      console.log('[API Handler] Environment check:', {
        supabaseUrlExists: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        serviceRoleKeyExists: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        serviceRoleKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0,
        allSupabaseKeys: allEnvKeys,
        nodeEnv: process.env.NODE_ENV,
        amplifyEnv: process.env.AMPLIFY_ENV
      })

      // Check critical environment variables first
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        console.error('[API Handler] NEXT_PUBLIC_SUPABASE_URL is missing')
        return NextResponse.json(
          { error: 'Server configuration error: NEXT_PUBLIC_SUPABASE_URL is missing' },
          { status: 500, headers: jsonHeaders }
        )
      }

      // Check SUPABASE_SERVICE_ROLE_KEY - be more lenient to catch edge cases
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!serviceRoleKey || serviceRoleKey.trim() === '' || serviceRoleKey === 'your_supabase_service_role_key') {
        console.error('[API Handler] SUPABASE_SERVICE_ROLE_KEY check failed:', {
          isSet: !!serviceRoleKey,
          isEmpty: serviceRoleKey?.trim() === '',
          isPlaceholder: serviceRoleKey === 'your_supabase_service_role_key',
          length: serviceRoleKey?.length || 0,
          type: typeof serviceRoleKey,
          allEnvKeys: allEnvKeys
        })
        return NextResponse.json(
          { 
            error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY is missing or invalid',
            details: {
              isSet: !!serviceRoleKey,
              isEmpty: serviceRoleKey?.trim() === '',
              isPlaceholder: serviceRoleKey === 'your_supabase_service_role_key',
              length: serviceRoleKey?.length || 0,
              prefix: serviceRoleKey?.substring(0, 10) || 'NOT_SET',
              allSupabaseEnvVars: allEnvKeys
            }
          },
          { status: 500, headers: jsonHeaders }
        )
      }

      // Execute the handler
      const response = await handler(request)
      
      // Ensure response has JSON content type
      if (response) {
        const contentType = response.headers.get('Content-Type')
        if (!contentType || !contentType.includes('application/json')) {
          response.headers.set('Content-Type', 'application/json')
        }
      }
      
      return response || NextResponse.json(
        { error: 'No response from handler' },
        { status: 500, headers: jsonHeaders }
      )
    } catch (error: any) {
      // Log the error for debugging
      console.error('[API Handler] Unhandled error:', error)
      console.error('[API Handler] Error stack:', error?.stack)
      console.error('[API Handler] Request path:', request.nextUrl.pathname)
      
      // ALWAYS return JSON, never HTML
      return NextResponse.json(
        {
          error: 'Internal server error',
          message: error?.message || 'An unexpected error occurred',
          path: request.nextUrl.pathname,
          ...(process.env.NODE_ENV === 'development' && {
            stack: error?.stack,
            details: error
          })
        },
        { 
          status: 500,
          headers: jsonHeaders
        }
      )
    }
  }
}

