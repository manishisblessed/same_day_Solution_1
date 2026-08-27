import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !user.partner_id) {
      const response = NextResponse.json(
        {
          error: 'Unauthorized',
          message:
            'Please log in to access this feature. If you are already logged in, try refreshing the page.',
        },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    const access = authorizeSubPartner(user)
    if (!access.ok) return addCorsHeaders(request, access.response)

    if (!['retailer', 'distributor', 'master_distributor', 'partner', 'master_partner'].includes(user.role)) {
      const response = NextResponse.json(
        { error: 'Forbidden: Invalid user role' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const supabase = getSupabaseAdmin()
    const walletType = request.nextUrl.searchParams.get('wallet_type') || 'primary'
    const validWalletTypes = ['primary', 'aeps', 'commission', 'settlement']

    if (!validWalletTypes.includes(walletType)) {
      const response = NextResponse.json(
        { error: 'Invalid wallet_type. Valid types: primary, aeps, commission, settlement' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    if ((user.role === 'partner' || user.role === 'master_partner') && walletType === 'primary') {
      const { data: partnerBal, error: partnerErr } = await supabase.rpc('get_partner_wallet_balance', {
        p_partner_id: user.partner_id,
      })
      if (partnerErr) {
        return addCorsHeaders(
          request,
          NextResponse.json({ success: true, balance: 0, warning: partnerErr.message })
        )
      }
      return addCorsHeaders(
        request,
        NextResponse.json({
          success: true,
          balance: partnerBal || 0,
          user_id: user.partner_id,
          user_role: user.role,
          wallet_type: walletType,
        })
      )
    }

    let balance = 0
    let error: any = null

    const { data: newBalance, error: newError } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user.partner_id,
      p_wallet_type: walletType,
    })

    if (newError) {
      if (user.role === 'retailer') {
        const { data: oldBalance, error: oldError } = await supabase.rpc('get_wallet_balance', {
          p_retailer_id: user.partner_id,
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
        wallet_type: walletType,
        warning: 'Wallet function not available, returning 0',
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
      wallet_type: walletType,
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
