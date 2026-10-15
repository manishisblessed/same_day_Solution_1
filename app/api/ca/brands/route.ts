import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/ca/brands — list active brands for CA portal dropdowns */
export async function GET(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ca_executive' && user.role !== 'admin') {
    return NextResponse.json({ error: 'CA access required' }, { status: 403 })
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('brands')
      .select('id, key, name, short_name, active')
      .eq('active', true)
      .order('name', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, brands: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
