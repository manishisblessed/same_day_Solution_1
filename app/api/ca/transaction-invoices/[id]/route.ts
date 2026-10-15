import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireCA(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) return { error: 'Session expired. Please login again.', status: 401 as const }
  if (user.role !== 'ca_executive' && user.role !== 'admin') {
    return { error: 'CA access required', status: 403 as const }
  }
  return { user }
}

/** GET /api/ca/transaction-invoices/[id] */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('ca_transaction_invoices')
      .select(`*, brands:brand_id ( id, key, name, short_name )`)
      .eq('id', params.id)
      .single()

    if (error || !data) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    return NextResponse.json({ success: true, invoice: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** PATCH /api/ca/transaction-invoices/[id]  — update status or notes */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const patch: Record<string, any> = {}

    if (body.status !== undefined) {
      const allowed = ['draft', 'issued', 'filed', 'void']
      if (!allowed.includes(body.status)) {
        return NextResponse.json({ error: `status must be one of: ${allowed.join(', ')}` }, { status: 400 })
      }
      patch.status = body.status
    }
    if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from('ca_transaction_invoices')
      .update(patch)
      .eq('id', params.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
