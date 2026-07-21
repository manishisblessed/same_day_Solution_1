import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

let _supabase: SupabaseClient | null = null
function getSupabaseAdmin(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase environment variables not configured')
    _supabase = createClient(url, key)
  }
  return _supabase
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'partner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { sub_partner_id, password } = await request.json()
    if (!sub_partner_id || !password) {
      return NextResponse.json({ error: 'sub_partner_id and password are required' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    // Verify sub-partner belongs to this partner
    const { data: subPartner } = await supabase
      .from('sub_partners')
      .select('id, email, parent_partner_id')
      .eq('id', sub_partner_id)
      .single()

    if (!subPartner || subPartner.parent_partner_id !== user.partner_id) {
      return NextResponse.json({ error: 'Sub-partner not found' }, { status: 404 })
    }

    // Find auth user by email and update password
    const { data: authUsers } = await supabase.auth.admin.listUsers()
    const authUser = authUsers?.users?.find((u: any) => u.email === subPartner.email)

    if (!authUser) {
      return NextResponse.json({ error: 'Auth user not found for this sub-partner' }, { status: 404 })
    }

    const { error } = await supabase.auth.admin.updateUserById(authUser.id, { password })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[Sub-Partner Set Password] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
