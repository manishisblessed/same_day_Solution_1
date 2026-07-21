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

async function getPartnerUser(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) return null
  // Only full partners (not sub-partners) can manage sub-partners,
  // unless the sub-partner has the 'sub-partners' permission
  if (user.role === 'partner') return user
  if (user.role === 'sub_partner' && user.permissions?.['sub-partners']) return user
  return null
}

/**
 * GET - List sub-partners for the current partner
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getPartnerUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const supabase = getSupabaseAdmin()
    const partnerId = user.partner_id

    const { data, error } = await supabase
      .from('sub_partners')
      .select('*')
      .eq('parent_partner_id', partnerId)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const { data: partner } = await supabase
      .from('partners')
      .select('sub_partner_limit, sub_partners_enabled')
      .eq('id', partnerId)
      .single()

    return NextResponse.json({
      success: true,
      data,
      limit: partner?.sub_partner_limit || 5,
      enabled: partner?.sub_partners_enabled === true,
    })
  } catch (err: any) {
    console.error('[Sub-Partners API] GET error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST - Create a new sub-partner
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getPartnerUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    // Only full partners can create sub-partners
    if (user.role !== 'partner') {
      return NextResponse.json({ error: 'Only the main partner account can create sub-partners' }, { status: 403 })
    }

    const body = await request.json()
    const { name, email, phone, password, designation, permissions } = body

    if (!name || !email || !phone || !password) {
      return NextResponse.json({ error: 'Name, email, phone, and password are required' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const partnerId = user.partner_id!

    // Check if sub-partners feature is enabled for this partner
    const [{ count }, { data: partner }] = await Promise.all([
      supabase.from('sub_partners').select('id', { count: 'exact', head: true }).eq('parent_partner_id', partnerId),
      supabase.from('partners').select('sub_partner_limit, sub_partners_enabled').eq('id', partnerId).single(),
    ])

    if (!partner?.sub_partners_enabled) {
      return NextResponse.json({
        error: 'Team members feature is not enabled for your account. Please contact admin to enable it.',
      }, { status: 403 })
    }

    const limit = partner?.sub_partner_limit || 5
    if ((count || 0) >= limit) {
      return NextResponse.json({
        error: `Sub-partner limit reached (${limit}). Contact admin to increase your limit.`,
      }, { status: 400 })
    }

    // Check email uniqueness across partners and sub_partners
    const [{ data: existingPartner }, { data: existingSub }] = await Promise.all([
      supabase.from('partners').select('id').eq('email', email).maybeSingle(),
      supabase.from('sub_partners').select('id').eq('email', email).maybeSingle(),
    ])

    if (existingPartner || existingSub) {
      return NextResponse.json({ error: 'This email is already registered' }, { status: 400 })
    }

    // Create Supabase Auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    // Insert sub-partner record
    const { data: created, error: insertError } = await supabase
      .from('sub_partners')
      .insert([{
        parent_partner_id: partnerId,
        name,
        email,
        phone,
        designation: designation || 'Operator',
        permissions: permissions || {
          dashboard: true,
          wallet: false,
          transactions: true,
          ledger: false,
          services: false,
          bbps: false,
          'bbps-2': false,
          'credit-card': false,
          'credit-card-2': false,
          payout: false,
          'settlement-2': false,
          aeps: false,
          'aeps-ledger': false,
          'pos-machines': false,
          subscriptions: false,
          'mdr-schemes': false,
          reports: false,
          'api-dashboard': false,
          analytics: false,
          reconciliation: false,
          'api-management': false,
          settings: false,
          'sub-partners': false,
        },
      }])
      .select()
      .single()

    if (insertError) {
      // Rollback auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: insertError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, data: created })
  } catch (err: any) {
    console.error('[Sub-Partners API] POST error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT - Update a sub-partner
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await getPartnerUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const body = await request.json()
    const { id, ...updateData } = body
    if (!id) return NextResponse.json({ error: 'Missing sub-partner id' }, { status: 400 })

    const supabase = getSupabaseAdmin()

    // Verify sub-partner belongs to this partner
    const { data: existing } = await supabase
      .from('sub_partners')
      .select('id, parent_partner_id')
      .eq('id', id)
      .single()

    if (!existing || existing.parent_partner_id !== user.partner_id) {
      return NextResponse.json({ error: 'Sub-partner not found' }, { status: 404 })
    }

    // Don't allow updating email or parent_partner_id
    delete updateData.email
    delete updateData.parent_partner_id
    delete updateData.created_at

    const { error } = await supabase
      .from('sub_partners')
      .update(updateData)
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[Sub-Partners API] PUT error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE - Delete a sub-partner
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getPartnerUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    if (user.role !== 'partner') {
      return NextResponse.json({ error: 'Only the main partner account can delete sub-partners' }, { status: 403 })
    }

    const body = await request.json()
    const { id } = body
    if (!id) return NextResponse.json({ error: 'Missing sub-partner id' }, { status: 400 })

    const supabase = getSupabaseAdmin()

    // Get sub-partner to verify ownership and get email for auth cleanup
    const { data: existing } = await supabase
      .from('sub_partners')
      .select('id, email, parent_partner_id')
      .eq('id', id)
      .single()

    if (!existing || existing.parent_partner_id !== user.partner_id) {
      return NextResponse.json({ error: 'Sub-partner not found' }, { status: 404 })
    }

    // Delete sub-partner record
    const { error } = await supabase.from('sub_partners').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Also delete Supabase Auth user
    try {
      const { data: authUsers } = await supabase.auth.admin.listUsers()
      const authUser = authUsers?.users?.find((u: any) => u.email === existing.email)
      if (authUser) {
        await supabase.auth.admin.deleteUser(authUser.id)
      }
    } catch {
      // Best-effort auth cleanup
    }

    // End any active sessions
    try {
      const { data: authUsers } = await supabase.auth.admin.listUsers()
      const authUser = authUsers?.users?.find((u: any) => u.email === existing.email)
      if (authUser) {
        await supabase
          .from('user_sessions')
          .update({ is_active: false, ended_reason: 'account_deleted' })
          .eq('user_id', authUser.id)
          .eq('is_active', true)
      }
    } catch {}

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[Sub-Partners API] DELETE error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
