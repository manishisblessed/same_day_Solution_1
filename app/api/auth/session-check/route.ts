import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'

/**
 * Lightweight, same-origin session probe used right after login.
 *
 * It mirrors EXACTLY what middleware.ts does to gate protected routes
 * (createServerClient + auth.getUser() over the request cookies). The client
 * polls this before navigating to a protected route so the navigation only
 * happens once the sb-* cookies written by /api/auth/sync-session are actually
 * committed and visible server-side. This removes the cookie-propagation race
 * that made admin/retailer/distributor/partner logins need a 2nd attempt.
 *
 * MUST be called with a relative URL (same Amplify origin as middleware) so it
 * reads the same cookies the middleware sees.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          // Read-only probe — never mutate cookies here.
          setAll() {},
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
    return NextResponse.json({ authenticated: !!user })
  } catch {
    return NextResponse.json({ authenticated: false })
  }
}
