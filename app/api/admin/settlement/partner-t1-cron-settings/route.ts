import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
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
    const { data, error } = await supabase
      .from('partner_t1_cron_settings')
      .select('*')
      .limit(1)
      .single()

    if (error) {
      console.error('Error fetching partner T+1 cron settings:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

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
    const { schedule_hour, schedule_minute, timezone, is_enabled } = body

    // Validate inputs
    if (schedule_hour !== undefined && (schedule_hour < 0 || schedule_hour > 23)) {
      return NextResponse.json(
        { error: 'schedule_hour must be between 0 and 23' },
        { status: 400 }
      )
    }

    if (schedule_minute !== undefined && (schedule_minute < 0 || schedule_minute > 59)) {
      return NextResponse.json(
        { error: 'schedule_minute must be between 0 and 59' },
        { status: 400 }
      )
    }

    const updateData: any = {}
    if (schedule_hour !== undefined) updateData.schedule_hour = schedule_hour
    if (schedule_minute !== undefined) updateData.schedule_minute = schedule_minute
    if (timezone !== undefined) updateData.timezone = timezone
    if (is_enabled !== undefined) updateData.is_enabled = is_enabled

    const { data, error } = await supabase
      .from('partner_t1_cron_settings')
      .update(updateData)
      .not('id', 'is', null)
      .select()
      .single()

    if (error) {
      console.error('Error updating partner T+1 cron settings:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    const action = is_enabled ? 'enabled' : 'disabled'
    console.log(`[Admin] Partner T+1 cron ${action} and configured: ${schedule_hour}:${schedule_minute} ${timezone}`)

    return NextResponse.json({ data, message: `Partner T+1 cron ${action}` })
  } catch (error: any) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
