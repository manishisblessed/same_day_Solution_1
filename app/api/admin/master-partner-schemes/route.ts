import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Admin-only CRUD for Master Channel Partner commission schemes (POS-only).
 * A scheme owns a set of flat-₹ amount slabs used to compute the per-transaction
 * master partner override. Master partners themselves have NO access here.
 */

function validateSlabs(slabs: any): { ok: true; slabs: Array<{ min_amount: number; max_amount: number; charge: number }> } | { ok: false; error: string } {
  if (!Array.isArray(slabs) || slabs.length === 0) {
    return { ok: false, error: 'At least one slab is required' }
  }
  const norm = slabs.map((s: any) => ({
    min_amount: Number(s.min_amount),
    max_amount: Number(s.max_amount),
    charge: Number(s.charge),
  }))
  for (const s of norm) {
    if (!Number.isFinite(s.min_amount) || !Number.isFinite(s.max_amount) || !Number.isFinite(s.charge)) {
      return { ok: false, error: 'Slab amounts and charge must be numbers' }
    }
    if (s.min_amount < 0 || s.max_amount <= s.min_amount || s.charge < 0) {
      return { ok: false, error: 'Each slab needs min >= 0, max > min, charge >= 0' }
    }
  }
  return { ok: true, slabs: norm }
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const supabase = getSupabaseAdmin()

    const { data: schemes, error } = await supabase
      .from('master_partner_schemes')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const schemeIds = (schemes || []).map((s: any) => s.id)
    let slabs: any[] = []
    if (schemeIds.length > 0) {
      const { data: slabRows } = await supabase
        .from('master_partner_scheme_slabs')
        .select('*')
        .in('scheme_id', schemeIds)
        .order('min_amount', { ascending: true })
      slabs = slabRows || []
    }

    const data = (schemes || []).map((s: any) => ({
      ...s,
      slabs: slabs.filter((sl) => sl.scheme_id === s.id),
    }))

    return NextResponse.json({ success: true, data })
  } catch (err: any) {
    console.error('[MCP Schemes] GET error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const { name, description, status, slabs } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const slabCheck = validateSlabs(slabs)
    if (!slabCheck.ok) return NextResponse.json({ error: slabCheck.error }, { status: 400 })

    const { data: scheme, error: schemeErr } = await supabase
      .from('master_partner_schemes')
      .insert({ name: name.trim(), description: description || null, status: status === 'inactive' ? 'inactive' : 'active' })
      .select()
      .single()
    if (schemeErr) return NextResponse.json({ error: schemeErr.message }, { status: 400 })

    const slabInsert = slabCheck.slabs.map((s) => ({ ...s, scheme_id: scheme.id, is_active: true }))
    const { error: slabErr } = await supabase.from('master_partner_scheme_slabs').insert(slabInsert)
    if (slabErr) {
      await supabase.from('master_partner_schemes').delete().eq('id', scheme.id)
      return NextResponse.json({ error: slabErr.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, data: { ...scheme, slabs: slabInsert } })
  } catch (err: any) {
    console.error('[MCP Schemes] POST error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const { id, name, description, status, slabs } = body
    if (!id) return NextResponse.json({ error: 'Scheme id is required' }, { status: 400 })

    const patch: Record<string, any> = { updated_at: new Date().toISOString() }
    if (name !== undefined) patch.name = String(name).trim()
    if (description !== undefined) patch.description = description || null
    if (status !== undefined) patch.status = status === 'inactive' ? 'inactive' : 'active'

    const { error: upErr } = await supabase.from('master_partner_schemes').update(patch).eq('id', id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })

    // Replace slabs when provided (full replace keeps the set consistent).
    if (slabs !== undefined) {
      const slabCheck = validateSlabs(slabs)
      if (!slabCheck.ok) return NextResponse.json({ error: slabCheck.error }, { status: 400 })
      await supabase.from('master_partner_scheme_slabs').delete().eq('scheme_id', id)
      const slabInsert = slabCheck.slabs.map((s) => ({ ...s, scheme_id: id, is_active: true }))
      const { error: slabErr } = await supabase.from('master_partner_scheme_slabs').insert(slabInsert)
      if (slabErr) return NextResponse.json({ error: slabErr.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[MCP Schemes] PUT error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const supabase = getSupabaseAdmin()
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Scheme id is required' }, { status: 400 })

    // Block deletion when a scheme is still assigned to any partner.
    const { count } = await supabase
      .from('master_partner_partner_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('scheme_id', id)
    if ((count || 0) > 0) {
      return NextResponse.json({ error: 'Scheme is assigned to one or more partners. Unassign it first.' }, { status: 400 })
    }

    const { error } = await supabase.from('master_partner_schemes').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[MCP Schemes] DELETE error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
