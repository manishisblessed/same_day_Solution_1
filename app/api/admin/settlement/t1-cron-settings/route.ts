import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('t1_cron_settings')
      .select('*')
      .limit(1)
      .single()

    if (error) {
      console.error('[T1 Settings] Error fetching:', error)
      return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
    }

    return NextResponse.json({ success: true, settings: data })
  } catch (err: any) {
    console.error('[T1 Settings] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { schedule_hour, schedule_minute, is_enabled } = body

    const updates: Record<string, any> = { updated_by: admin.partner_id || admin.id }

    if (typeof schedule_hour === 'number') {
      if (schedule_hour < 0 || schedule_hour > 23) {
        return NextResponse.json({ error: 'schedule_hour must be 0-23' }, { status: 400 })
      }
      updates.schedule_hour = schedule_hour
    }

    if (typeof schedule_minute === 'number') {
      if (schedule_minute < 0 || schedule_minute > 59) {
        return NextResponse.json({ error: 'schedule_minute must be 0-59' }, { status: 400 })
      }
      updates.schedule_minute = schedule_minute
    }

    if (typeof is_enabled === 'boolean') {
      updates.is_enabled = is_enabled
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('t1_cron_settings')
      .update(updates)
      .not('id', 'is', null)
      .select()
      .single()

    if (error) {
      console.error('[T1 Settings] Update error:', error)
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
    }

    console.log(`[T1 Settings] Updated by admin ${admin.email}: hour=${data.schedule_hour}, min=${data.schedule_minute}, enabled=${data.is_enabled}`)

    return NextResponse.json({
      success: true,
      message: 'Settings updated. Cron will pick up changes within 60 seconds.',
      settings: data,
    })
  } catch (err: any) {
    console.error('[T1 Settings] PUT error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
