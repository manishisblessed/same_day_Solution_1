import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'

/**
 * This endpoint syncs the client-side session to server-side cookies
 * Called after login to ensure API routes can access the session
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { access_token, refresh_token } = body

    if (!access_token) {
      return NextResponse.json({ error: 'Missing access_token' }, { status: 400 })
    }

    // Create Supabase client that will set cookies
    const response = NextResponse.json({ success: true })
    
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            cookiesToSet.forEach(({ name, value, options }) => {
              // Set cookies in the response so they're sent to the browser
              response.cookies.set(name, value, {
                ...options,
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production',
                path: '/',
              })
            })
          },
        },
      }
    )

    // Set the session using the tokens
    // This will trigger the setAll callback to set cookies
    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token: refresh_token || '',
    })

    if (error) {
      console.error('Error setting session:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return response
  } catch (error: any) {
    console.error('Error in sync-session:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

