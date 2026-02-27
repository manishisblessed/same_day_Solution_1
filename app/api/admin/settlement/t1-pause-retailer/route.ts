import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { partner_id, paused, settlement_mode, entity_type = 'retailer' } = body

    if (!partner_id) {
      return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
    }

    const table = entity_type === 'distributor' ? 'distributors' : 'retailers'
    const supabase = getSupabaseAdmin()

    const { data: entity, error: fetchError } = await supabase
      .from(table)
      .select('partner_id, name')
      .eq('partner_id', partner_id)
      .maybeSingle()

    if (fetchError || !entity) {
      return NextResponse.json(
        { error: `${entity_type} not found with partner_id: ${partner_id}` },
        { status: 404 }
      )
    }

    const updates: Record<string, any> = {}

    // Handle T+1 pause/resume
    if (typeof paused === 'boolean') {
      updates.t1_settlement_paused = paused
      updates.t1_settlement_paused_at = paused ? new Date().toISOString() : null
      updates.t1_settlement_paused_by = paused ? (admin.partner_id || admin.id) : null
    }

    // Handle settlement mode assignment (T1 = only T+1, T0_T1 = Pulse Pay + T+1)
    if (settlement_mode && ['T1', 'T0_T1'].includes(settlement_mode)) {
      updates.settlement_mode_allowed = settlement_mode
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update. Provide paused or settlement_mode.' }, { status: 400 })
    }

    const { error: updateError } = await supabase
      .from(table)
      .update(updates)
      .eq('partner_id', partner_id)

    if (updateError) {
      console.error('[T1 Pause] Update error:', updateError)
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }

    const messages: string[] = []
    if (typeof paused === 'boolean') {
      messages.push(`T+1 settlement ${paused ? 'paused' : 'resumed'}`)
    }
    if (settlement_mode) {
      messages.push(`Settlement mode set to ${settlement_mode === 'T0_T1' ? 'T+0 + T+1 (Pulse Pay enabled)' : 'T+1 only'}`)
    }

    console.log(`[Settlement] ${entity_type} ${entity.name} (${partner_id}) ${messages.join(', ')} by admin ${admin.email}`)

    return NextResponse.json({
      success: true,
      message: `${messages.join('. ')} for ${entity.name}`,
      partner_id,
    })
  } catch (err: any) {
    console.error('[T1 Pause] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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

    const { data: retailers } = await supabase
      .from('retailers')
      .select('partner_id, name, email, phone, t1_settlement_paused, t1_settlement_paused_at, t1_settlement_paused_by, settlement_mode_allowed, status')
      .order('name')

    const { data: distributors } = await supabase
      .from('distributors')
      .select('partner_id, name, email, phone, t1_settlement_paused, t1_settlement_paused_at, t1_settlement_paused_by, settlement_mode_allowed, status')
      .order('name')

    return NextResponse.json({
      success: true,
      retailers: retailers || [],
      distributors: distributors || [],
    })
  } catch (err: any) {
    console.error('[T1 Pause] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
