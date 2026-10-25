import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const TABLE_BY_ROLE: Record<string, { table: string; idCol: string }> = {
  retailer:           { table: 'retailers',          idCol: 'email' },
  distributor:        { table: 'distributors',        idCol: 'email' },
  master_distributor: { table: 'master_distributors', idCol: 'email' },
  partner:            { table: 'partners',            idCol: 'email' },
  master_partner:     { table: 'partners',            idCol: 'email' },
  sub_partner:        { table: 'sub_partners',        idCol: 'email' },
  finance_executive:  { table: 'finance_executives',  idCol: 'email' },
}

export async function OPTIONS(request: NextRequest) {
  const res = handleCorsPreflight(request)
  return res || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }))

    const body = await request.json()
    const mobile = (body.mobile || '').replace(/\D/g, '').slice(0, 10)
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Enter a valid 10-digit Indian mobile number' }, { status: 400 }))
    }

    const mapping = TABLE_BY_ROLE[user.role]
    if (!mapping) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Cannot update mobile for this role' }, { status: 400 }))
    }

    const { error } = await supabaseAdmin
      .from(mapping.table)
      .update({ phone: mobile, updated_at: new Date().toISOString() })
      .eq(mapping.idCol, user.email)

    if (error) throw new Error(error.message)

    return addCorsHeaders(request, NextResponse.json({ success: true, mobile }))
  } catch (e: any) {
    return addCorsHeaders(request, NextResponse.json({ success: false, error: e.message || 'Update failed' }, { status: 500 }))
  }
}
