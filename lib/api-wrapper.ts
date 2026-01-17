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
      // Don't check environment variables here - let individual routes handle their own checks
      // This allows routes that don't need Supabase to work, and routes that do need it
      // will check and fail gracefully with proper error messages

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

