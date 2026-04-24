import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { fetchBillerInfo } from '@/services/bbps/fetchBillerInfo'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const dynamic = 'force-dynamic'

function getSupabaseAnon() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null
  return createClient(supabaseUrl, supabaseAnonKey)
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { biller_id, user_id } = body

    let { user, method } = await getCurrentUserWithFallback(request)
    console.log('[BBPS Biller Info] Auth:', method, '|', user?.email || 'none')

    if (!user && user_id) {
      const supabase = getSupabaseAnon()
      if (supabase) {
        const { data: retailer } = await supabase
          .from('retailers')
          .select('partner_id, name, email')
          .eq('partner_id', user_id)
          .maybeSingle()
        if (retailer) {
          user = {
            id: user_id,
            email: retailer.email,
            role: 'retailer',
            partner_id: retailer.partner_id,
            name: retailer.name,
          } as any
        }
      }
    }

    if (!user) {
      const response = NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    // Only retailers can fetch biller info
    if (user.role !== 'retailer') {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    if (!biller_id) {
      const response = NextResponse.json(
        { error: 'biller_id is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const billerInfo = await fetchBillerInfo({ billerId: biller_id })

    const response = NextResponse.json({
      success: true,
      biller_info: billerInfo,
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error fetching biller info:', error)
    const response = NextResponse.json(
      { error: 'Failed to fetch biller info' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}






