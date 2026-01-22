import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // Create response early so we can set cookies
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // For API routes, ensure we always return JSON responses
  // This prevents HTML error pages from being returned
  // EXCEPT for routes that handle file uploads (multipart/form-data)
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  const isFileUploadRoute = request.nextUrl.pathname.includes('/upload-document') ||
                            request.nextUrl.pathname.includes('/bulk-upload')

  try {
    // Get request cookies for later use
    const requestCookies = request.cookies.getAll()
    
    // Note: We removed the aggressive "corrupted cookie" detection that was
    // incorrectly clearing valid Supabase session cookies. Supabase SSR cookies
    // legitimately contain JSON data, so checking for '{' was wrong.

    // Handle Supabase session refresh for ALL routes (including API routes)
    // This ensures session cookies are properly refreshed before API routes try to use them
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
              request.cookies.set(name, value)
              response.cookies.set(name, value, options)
            })
          },
        },
      }
    )

    // Refresh session if expired - required for both Server Components and API routes
    // Use getSession() to refresh the session and update cookies
    // The setAll callback above will update both request.cookies and response.cookies
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()
    
    // Note: We removed aggressive cookie clearing on session errors.
    // The session might just be expired or the user not logged in yet.
    // Let the app handle authentication state, not the middleware.

    // For API routes, set JSON content type and return
    // The refreshed session cookies are set in both request and response
    // API routes should read from request.cookies (via getCurrentUserFromRequest)
    if (isApiRoute) {
      if (!isFileUploadRoute) {
        response.headers.set('Content-Type', 'application/json')
      }
      return response
    }

    // If user is signed in and the current path is /login, redirect to appropriate dashboard based on role
    // Note: We can't determine role from middleware without additional queries, so we'll let the app handle this
    // This prevents hardcoded redirects to retailer dashboard
    // if (user && request.nextUrl.pathname.startsWith('/business-login')) {
    //   const url = request.nextUrl.clone()
    //   url.pathname = '/dashboard/retailer'
    //   return NextResponse.redirect(url)
    // }

    // If user is not signed in and the current path is not /login, redirect to login
    // (This is optional - remove if you want public pages)
    // if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    //   const url = request.nextUrl.clone()
    //   url.pathname = '/business-login'
    //   return NextResponse.redirect(url)
    // }

    return response
  } catch (error: any) {
    // If Supabase auth fails, still return response (don't break the app)
    console.error('Middleware Supabase error:', error)
    return response
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

