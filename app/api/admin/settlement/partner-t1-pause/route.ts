import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 })
  }

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
    const { partner_id, paused, settlement_mode } = body

    if (!partner_id) {
      return NextResponse.json(
        { error: 'Missing required field: partner_id' },
        { status: 400 }
      )
    }

    const updates: Record<string, any> = {}
    const messages: string[] = []

    if (typeof paused === 'boolean') {
      updates.t1_settlement_paused = paused
      messages.push(`T+1 settlement ${paused ? 'paused' : 'resumed'}`)
    }

    if (settlement_mode && ['T1', 'T0_T1', 'INSTANT'].includes(settlement_mode)) {
      updates.settlement_mode_allowed = settlement_mode
      const modeLabel = settlement_mode === 'INSTANT'
        ? 'Instant (auto credit per transaction)'
        : settlement_mode === 'T0_T1'
          ? 'T+0 + T+1 (Pulse Pay enabled)'
          : 'T+1 only'
      messages.push(`Settlement mode set to ${modeLabel}`)
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'Nothing to update. Provide paused or settlement_mode.' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('partners')
      .update(updates)
      .eq('id', partner_id)
      .select('id, t1_settlement_paused, settlement_mode_allowed')
      .single()

    if (error) {
      console.error('Error updating partner settlement settings:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    console.log(`[Admin] Partner ${partner_id}: ${messages.join(', ')}`)

    return NextResponse.json({
      success: true,
      data,
      message: `Partner: ${messages.join('. ')}`,
    })
  } catch (error: any) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
