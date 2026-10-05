import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

async function requireAdmin(request: NextRequest) {
  const { user: admin } = await getCurrentUserWithFallback(request)
  if (!admin) return { error: 'Session expired. Please login again.', status: 401 as const }
  if (admin.role !== 'admin') return { error: 'Admin access required', status: 403 as const }
  return { admin }
}

const VALID_SETTLEMENT = ['INSTANT', 'T1', 'BOTH']

/** GET /api/admin/brands/:id — brand with its rate card. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data: brand, error } = await supabase.from('brands').select('*').eq('id', params.id).maybeSingle()
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    if (!brand) return addCorsHeaders(request, NextResponse.json({ error: 'Brand not found' }, { status: 404 }))

    const { data: rates } = await supabase
      .from('brand_mdr_rates')
      .select('*')
      .eq('brand_id', params.id)
      .order('provider', { ascending: true })
      .order('mode', { ascending: true })
      .order('min_amount', { ascending: true })

    return addCorsHeaders(request, NextResponse.json({ success: true, brand, rates: rates || [] }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

/** PATCH /api/admin/brands/:id — update brand metadata. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const body = await request.json()
    const patch: Record<string, any> = {}
    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (name.length < 2) return addCorsHeaders(request, NextResponse.json({ error: 'name is required' }, { status: 400 }))
      patch.name = name
    }
    if (body.short_name !== undefined) patch.short_name = body.short_name ? String(body.short_name).trim() : null
    if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null
    if (body.active !== undefined) patch.active = !!body.active
    if (body.settlement_mode !== undefined) {
      if (!VALID_SETTLEMENT.includes(body.settlement_mode)) {
        return addCorsHeaders(request, NextResponse.json({ error: 'Invalid settlement_mode' }, { status: 400 }))
      }
      patch.settlement_mode = body.settlement_mode
    }
    if (body.t1_cutoff_hour !== undefined) {
      if (body.t1_cutoff_hour === null || body.t1_cutoff_hour === '') {
        patch.t1_cutoff_hour = null
      } else {
        const h = Number(body.t1_cutoff_hour)
        if (!Number.isInteger(h) || h < 0 || h > 23) {
          return addCorsHeaders(request, NextResponse.json({ error: 't1_cutoff_hour must be an integer 0-23' }, { status: 400 }))
        }
        patch.t1_cutoff_hour = h
      }
    }
    if (Object.keys(patch).length === 0) {
      return addCorsHeaders(request, NextResponse.json({ error: 'No fields to update' }, { status: 400 }))
    }

    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('brands').update(patch).eq('id', params.id)
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))

    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

/** DELETE /api/admin/brands/:id — delete a brand (rate card cascades). */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const supabase = getSupabaseAdmin()
    // Block delete when POS machines are still linked (avoid orphaning pricing).
    const { count } = await supabase
      .from('pos_machines')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', params.id)
    if ((count || 0) > 0) {
      return addCorsHeaders(request, NextResponse.json({ error: `Cannot delete: ${count} POS machine(s) still linked to this brand. Reassign them first.` }, { status: 409 }))
    }

    const { error } = await supabase.from('brands').delete().eq('id', params.id)
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))

    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}
