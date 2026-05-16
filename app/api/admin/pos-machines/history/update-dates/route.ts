import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/pos-machines/history/update-dates
 * Update transit_date and/or delivered_date on a pos_assignment_history record.
 * Body: { history_id, transit_date?, delivered_date? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { user } = await getCurrentUserWithFallback(request)

    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized. Admin only.' }, { status: 403 })
    }

    const body = await request.json()
    const { history_id, transit_date, delivered_date } = body

    if (!history_id) {
      return NextResponse.json({ error: 'history_id is required' }, { status: 400 })
    }

    const { data: record, error: fetchErr } = await supabase
      .from('pos_assignment_history')
      .select('id, assigned_date')
      .eq('id', history_id)
      .single()

    if (fetchErr || !record) {
      return NextResponse.json({ error: 'History record not found' }, { status: 404 })
    }

    if (transit_date && record.assigned_date && new Date(transit_date) < new Date(record.assigned_date)) {
      return NextResponse.json({ error: 'Transit date cannot be before assigned date' }, { status: 400 })
    }
    if (delivered_date && transit_date && new Date(delivered_date) < new Date(transit_date)) {
      return NextResponse.json({ error: 'Delivered date cannot be before transit date' }, { status: 400 })
    }

    const updateData: Record<string, any> = {}
    if (transit_date !== undefined) updateData.transit_date = transit_date || null
    if (delivered_date !== undefined) updateData.delivered_date = delivered_date || null

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No dates to update' }, { status: 400 })
    }

    const { error: updateErr } = await supabase
      .from('pos_assignment_history')
      .update(updateData)
      .eq('id', history_id)

    if (updateErr) {
      console.error('[Update Dates] Error:', updateErr)
      return NextResponse.json({ error: 'Failed to update dates' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[Update Dates] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
