import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

// Mark this route as dynamic (uses cookies for authentication)
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  try {
    // Get env vars at runtime, not module load
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseAnonKey) {
      const errorResponse = NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
      return addCorsHeaders(request, errorResponse)
    }
    
    // Get current user from request - reads cookies directly from request object
    // This is more reliable than using cookies() from next/headers in API routes
    const user = await getCurrentUserFromRequest(request)
    if (!user || !user.partner_id) {
      console.error('Wallet Balance API: User not authenticated', {
        hasUser: !!user,
        hasPartnerId: !!user?.partner_id,
      })
      const response = NextResponse.json(
        { 
          error: 'Unauthorized', 
          message: 'Please log in to access this feature. If you are already logged in, try refreshing the page.' 
        },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // All roles (retailer, distributor, master_distributor) have wallets
    if (!['retailer', 'distributor', 'master_distributor'].includes(user.role)) {
      const response = NextResponse.json(
        { error: 'Forbidden: Invalid user role' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // Get wallet balance using new function (supports all roles)
    // Fallback to old function for retailers if new function doesn't exist
    let balance = 0
    let error = null
    
    const { data: newBalance, error: newError } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user.partner_id,
      p_wallet_type: 'primary'
    })

    if (newError) {
      // If new function doesn't exist, try old function for retailers
      if (user.role === 'retailer') {
        const { data: oldBalance, error: oldError } = await supabase.rpc('get_wallet_balance', {
          p_retailer_id: user.partner_id
        })
        if (!oldError) {
          balance = oldBalance || 0
        } else {
          error = oldError
        }
      } else {
        error = newError
      }
    } else {
      balance = newBalance || 0
    }

    if (error) {
      console.error('Error fetching wallet balance:', error)
      // Return 0 instead of error to prevent dashboard blocking
      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, user, {
        activity_type: 'wallet_balance_check',
        activity_category: 'wallet',
        activity_description: `${user.role} checked wallet balance`,
        metadata: { balance: 0 },
      }).catch(() => {})
      return NextResponse.json({
        success: true,
        balance: 0,
        user_id: user.partner_id,
        user_role: user.role,
        wallet_type: 'primary',
        warning: 'Wallet function not available, returning 0'
      })
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'wallet_balance_check',
      activity_category: 'wallet',
      activity_description: `${user.role} checked wallet balance`,
      metadata: { balance: balance || 0 },
    }).catch(() => {})

    const successResponse = NextResponse.json({
      success: true,
      balance: balance || 0,
      user_id: user.partner_id,
      user_role: user.role,
      wallet_type: 'primary'
    })
    return addCorsHeaders(request, successResponse)
  } catch (error: any) {
    console.error('Error in wallet balance API:', error)
    const errorResponse = NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
    return addCorsHeaders(request, errorResponse)
  }
}

