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

const VALID_KINDS = ['POS', 'BBPS', 'PAYOUT']
const VALID_TYPES = ['PERCENT', 'FLAT']
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : NaN }

function buildRow(body: any): { row?: any; error?: string } {
  const service_kind = String(body.service_kind || '').toUpperCase()
  if (!VALID_KINDS.includes(service_kind)) return { error: 'Invalid service_kind (POS | BBPS | PAYOUT)' }
  const scope_key = body.scope_key ? String(body.scope_key).trim() : '*'
  const min_amount = num(body.min_amount ?? 0)
  const max_amount = num(body.max_amount ?? 999999999)
  if (!(min_amount >= 0)) return { error: 'min_amount must be >= 0' }
  if (!(max_amount > 0)) return { error: 'max_amount must be > 0' }
  if (min_amount > max_amount) return { error: 'min_amount must be <= max_amount' }
  const rate_type = String(body.rate_type || 'PERCENT').toUpperCase()
  if (!VALID_TYPES.includes(rate_type)) return { error: 'Invalid rate_type' }
  const floor_value = num(body.floor_value ?? 0)
  if (Number.isNaN(floor_value) || floor_value < 0) return { error: 'floor_value must be >= 0' }
  if (rate_type === 'PERCENT' && floor_value > 100) return { error: 'PERCENT floor_value must be <= 100' }
  return { row: { service_kind, scope_key, min_amount, max_amount, rate_type, floor_value } }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  try {
    const kind = new URL(request.url).searchParams.get('service_kind')
    const supabase = getSupabaseAdmin()
    let q = supabase.from('company_mdr_floor').select('*').order('service_kind').order('scope_key').order('min_amount')
    if (kind) q = q.eq('service_kind', kind.toUpperCase())
    const { data, error } = await q
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    return addCorsHeaders(request, NextResponse.json({ success: true, floors: data || [] }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  try {
    const body = await request.json()
    const { row, error: buildError } = buildRow(body)
    if (buildError) return addCorsHeaders(request, NextResponse.json({ error: buildError }, { status: 400 }))
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('company_mdr_floor')
      .insert({ ...row, created_by: null })
      .select()
      .single()
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    return addCorsHeaders(request, NextResponse.json({ success: true, floor: data }, { status: 201 }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) return addCorsHeaders(request, NextResponse.json({ error: 'id is required' }, { status: 400 }))
    const { row, error: buildError } = buildRow(body)
    if (buildError) return addCorsHeaders(request, NextResponse.json({ error: buildError }, { status: 400 }))
    const patch: any = { ...row }
    if (body.active !== undefined) patch.active = !!body.active
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('company_mdr_floor').update(patch).eq('id', id)
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  try {
    const id = new URL(request.url).searchParams.get('id')?.trim()
    if (!id) return addCorsHeaders(request, NextResponse.json({ error: 'id is required' }, { status: 400 }))
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('company_mdr_floor').delete().eq('id', id)
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}
