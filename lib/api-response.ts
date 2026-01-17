import { NextRequest, NextResponse } from 'next/server'

/**
 * Utility to ensure API routes always return JSON responses
 * Wraps API route handlers to catch errors and return JSON
 */
export function withJsonResponse<T = any>(
  handler: (request: NextRequest) => Promise<NextResponse<T>>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const response = await handler(request)
      
      // Ensure response is JSON
      if (response && !response.headers.get('Content-Type')?.includes('application/json')) {
        // If response is not JSON, wrap it
        const text = await response.text()
        try {
          // Try to parse as JSON first
          const json = JSON.parse(text)
          return NextResponse.json(json, { status: response.status })
        } catch {
          // If not JSON, wrap in error object
          return NextResponse.json(
            { error: 'Invalid response format', message: text },
            { status: response.status || 500 }
          )
        }
      }
      
      return response
    } catch (error: any) {
      // Always return JSON error, never HTML
      console.error('API route error:', error)
      return NextResponse.json(
        {
          error: 'Internal server error',
          message: error.message || 'An unexpected error occurred',
          ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        },
        { status: 500 }
      )
    }
  }
}

/**
 * Helper to create JSON error responses
 */
export function jsonError(
  message: string,
  status: number = 500,
  details?: any
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      ...(details && { details })
    },
    { status }
  )
}

/**
 * Helper to create JSON success responses
 */
export function jsonSuccess<T = any>(
  data: T,
  status: number = 200
): NextResponse<T> {
  return NextResponse.json(data, { status })
}

