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

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/
const VALID_SETTLEMENT = ['INSTANT', 'T1', 'BOTH']

/** GET /api/admin/brands — all brands with rate/machine counts. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data: brands, error } = await supabase
      .from('brands')
      .select('*')
      .order('active', { ascending: false })
      .order('name', { ascending: true })
    if (error) {
      return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    }

    const ids = (brands || []).map((b: any) => b.id)
    const rateCounts: Record<string, number> = {}
    const machineCounts: Record<string, number> = {}
    if (ids.length) {
      const { data: rates } = await supabase
        .from('brand_mdr_rates')
        .select('brand_id')
        .in('brand_id', ids)
      for (const r of (rates as any[]) || []) rateCounts[r.brand_id] = (rateCounts[r.brand_id] || 0) + 1

      const { data: machines } = await supabase
        .from('pos_machines')
        .select('brand_id')
        .in('brand_id', ids)
      for (const m of (machines as any[]) || []) machineCounts[m.brand_id] = (machineCounts[m.brand_id] || 0) + 1
    }

    const result = (brands || []).map((b: any) => ({
      ...b,
      rates: rateCounts[b.id] || 0,
      machines: machineCounts[b.id] || 0,
    }))

    return addCorsHeaders(request, NextResponse.json({ success: true, brands: result }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

/** POST /api/admin/brands — create a brand. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const body = await request.json()
    const key = String(body.key || '').toLowerCase().trim()
    const name = String(body.name || '').trim()
    if (!SLUG_RE.test(key)) {
      return addCorsHeaders(request, NextResponse.json({ error: 'key must be a lowercase slug (a-z, 0-9, -)' }, { status: 400 }))
    }
    if (name.length < 2) {
      return addCorsHeaders(request, NextResponse.json({ error: 'name is required' }, { status: 400 }))
    }
    const settlement_mode = VALID_SETTLEMENT.includes(body.settlement_mode) ? body.settlement_mode : 'T1'
    let t1_cutoff_hour: number | null = null
    if (body.t1_cutoff_hour !== null && body.t1_cutoff_hour !== undefined && body.t1_cutoff_hour !== '') {
      const h = Number(body.t1_cutoff_hour)
      if (!Number.isInteger(h) || h < 0 || h > 23) {
        return addCorsHeaders(request, NextResponse.json({ error: 't1_cutoff_hour must be an integer 0-23' }, { status: 400 }))
      }
      t1_cutoff_hour = h
    }

    const supabase = getSupabaseAdmin()
    const { data: exists } = await supabase.from('brands').select('id').eq('key', key).maybeSingle()
    if (exists) {
      return addCorsHeaders(request, NextResponse.json({ error: `A brand with key "${key}" already exists` }, { status: 409 }))
    }

    const { data, error } = await supabase
      .from('brands')
      .insert({
        key,
        name,
        short_name: body.short_name ? String(body.short_name).trim() : null,
        description: body.description ? String(body.description).trim() : null,
        settlement_mode,
        t1_cutoff_hour,
        created_by: (auth.admin as any).id ?? null,
      })
      .select()
      .single()
    if (error) {
      return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    }

    return addCorsHeaders(request, NextResponse.json({ success: true, brand: data }, { status: 201 }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}
