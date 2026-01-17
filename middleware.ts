import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // For API routes, ensure we always return JSON responses
  // This prevents HTML error pages from being returned
  if (request.nextUrl.pathname.startsWith('/api/')) {
    try {
      let response = NextResponse.next({
        request: {
          headers: request.headers,
        },
      })

      // Set JSON content type for API routes
      response.headers.set('Content-Type', 'application/json')
      
      // Only handle Supabase auth for non-API routes or specific API routes that need it
      // Most API routes handle their own authentication
      return response
    } catch (error: any) {
      // If middleware fails, return JSON error instead of HTML
      return NextResponse.json(
        { 
          error: 'Middleware error',
          message: error.message || 'An error occurred in middleware'
        },
        { status: 500 }
      )
    }
  }

  // For non-API routes, handle Supabase session refresh
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value)
              response.cookies.set(name, value, options)
            })
          },
        },
      }
    )

    // Refresh session if expired - required for Server Components
    const {
      data: { user },
    } = await supabase.auth.getUser()

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

