import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Supabase configuration missing' },
      { status: 500 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const body = await request.json()
    const { partner_id, paused } = body

    if (!partner_id || paused === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: partner_id, paused' },
        { status: 400 }
      )
    }

    // Update partner's T+1 settlement paused flag
    const { data, error } = await supabase
      .from('partners')
      .update({ t1_settlement_paused: paused })
      .eq('id', partner_id)
      .select('id, t1_settlement_paused')
      .single()

    if (error) {
      console.error('Error updating partner pause status:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    const action = paused ? 'paused' : 'resumed'
    console.log(`[Admin] Partner ${partner_id} T+1 settlement ${action}`)

    return NextResponse.json({
      data,
      message: `Partner T+1 settlement ${action}`,
    })
  } catch (error: any) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
