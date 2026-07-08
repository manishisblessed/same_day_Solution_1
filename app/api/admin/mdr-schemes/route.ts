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

const VALID_MODES = ['CARD', 'UPI']
const VALID_CARD_TYPES = ['CREDIT', 'DEBIT', 'PREPAID']

/**
 * Build a sanitized global_schemes row from client input.
 * Only whitelisted fields are accepted; MDR values are validated server-side.
 */
function buildSchemeRow(body: any): { row?: Record<string, any>; error?: string } {
  const mode = String(body.mode || '').toUpperCase()
  if (!VALID_MODES.includes(mode)) return { error: 'Invalid payment mode' }

  const cardType = body.card_type ? String(body.card_type).toUpperCase() : null
  if (cardType && !VALID_CARD_TYPES.includes(cardType)) return { error: 'Invalid card type' }

  const rt_mdr_t1 = Number(body.rt_mdr_t1)
  const dt_mdr_t1 = Number(body.dt_mdr_t1)
  if (!Number.isFinite(rt_mdr_t1) || rt_mdr_t1 < 0 || rt_mdr_t1 > 100) {
    return { error: 'Retailer MDR T+1 must be between 0 and 100' }
  }
  if (!Number.isFinite(dt_mdr_t1) || dt_mdr_t1 < 0 || dt_mdr_t1 > 100) {
    return { error: 'Distributor MDR T+1 must be between 0 and 100' }
  }
  if (rt_mdr_t1 < dt_mdr_t1) {
    return { error: 'Retailer MDR T+1 must be >= Distributor MDR T+1' }
  }

  const status = body.status === 'inactive' ? 'inactive' : 'active'

  return {
    row: {
      mode,
      card_type: cardType,
      brand_type: body.brand_type || null,
      card_classification: body.card_classification || null,
      rt_mdr_t1,
      // T+0 MDR = T+1 + 1% (matches the previous client-side calculation)
      rt_mdr_t0: rt_mdr_t1 + 1,
      dt_mdr_t1,
      dt_mdr_t0: dt_mdr_t1 + 1,
      status,
      effective_date: new Date().toISOString(),
    },
  }
}

/** POST /api/admin/mdr-schemes - create a global MDR scheme */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const body = await request.json()
    const { row, error: buildError } = buildSchemeRow(body)
    if (buildError) {
      return addCorsHeaders(request, NextResponse.json({ error: buildError }, { status: 400 }))
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.from('global_schemes').insert(row).select().single()
    if (error) {
      return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    }

    return addCorsHeaders(request, NextResponse.json({ success: true, data }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

/** PUT /api/admin/mdr-schemes - update a global MDR scheme (id in body) */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) {
      return addCorsHeaders(request, NextResponse.json({ error: 'Scheme id is required' }, { status: 400 }))
    }

    const { row, error: buildError } = buildSchemeRow(body)
    if (buildError) {
      return addCorsHeaders(request, NextResponse.json({ error: buildError }, { status: 400 }))
    }

    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('global_schemes').update(row).eq('id', id)
    if (error) {
      return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    }

    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

/** DELETE /api/admin/mdr-schemes?id=... - delete a global MDR scheme */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const id = new URL(request.url).searchParams.get('id')?.trim()
    if (!id) {
      return addCorsHeaders(request, NextResponse.json({ error: 'Scheme id is required' }, { status: 400 }))
    }

    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('global_schemes').delete().eq('id', id)
    if (error) {
      return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    }

    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}
