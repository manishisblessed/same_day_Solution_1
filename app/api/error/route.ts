import { NextRequest, NextResponse } from 'next/server'

/**
 * Global API error handler
 * This route should never be called directly, but serves as a reference
 * for proper error handling in all API routes
 */
export async function GET(request: NextRequest) {
  return NextResponse.json(
    { 
      error: 'Internal server error',
      message: 'An unexpected error occurred'
    },
    { status: 500 }
  )
}

export async function POST(request: NextRequest) {
  return NextResponse.json(
    { 
      error: 'Internal server error',
      message: 'An unexpected error occurred'
    },
    { status: 500 }
  )
}

