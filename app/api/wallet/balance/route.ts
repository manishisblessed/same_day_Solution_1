import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function GET(request: NextRequest) {
  try {
    // Get cookies from request headers (for API routes)
    const cookieStore = await cookies()
    const cookieHeader = request.headers.get('cookie')
    
    // Log for debugging (remove in production if needed)
    if (!cookieHeader) {
      console.error('Wallet Balance API: No cookies in request')
    }
    
    // Get current user (server-side)
    const user = await getCurrentUserServer(cookieStore)
    if (!user || !user.partner_id) {
      console.error('Wallet Balance API: User not authenticated', {
        hasUser: !!user,
        hasPartnerId: !!user?.partner_id,
        cookiesPresent: !!cookieHeader,
      })
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Please log in to access this feature' },
        { status: 401 }
      )
    }

    // All roles (retailer, distributor, master_distributor) have wallets
    if (!['retailer', 'distributor', 'master_distributor'].includes(user.role)) {
      return NextResponse.json(
        { error: 'Forbidden: Invalid user role' },
        { status: 403 }
      )
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
      return NextResponse.json({
        success: true,
        balance: 0,
        user_id: user.partner_id,
        user_role: user.role,
        wallet_type: 'primary',
        warning: 'Wallet function not available, returning 0'
      })
    }

    return NextResponse.json({
      success: true,
      balance: balance || 0,
      user_id: user.partner_id,
      user_role: user.role,
      wallet_type: 'primary'
    })
  } catch (error: any) {
    console.error('Error in wallet balance API:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

