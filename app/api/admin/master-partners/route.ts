import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Admin-only management of Master Channel Partners (MCP).
 *
 * A master partner IS a partners row with is_master_partner = true. Child
 * partners point at it via partners.master_partner_id (tracked in
 * master_partner_partner_assignments). The POS commission the master earns is
 * configured on the child's Partner Plan MDR rate in Scheme Management.
 *
 * GET  -> list master partners (+ their child partners) and the pool of
 *         unassigned normal partners available to assign.
 * POST -> actions: create | promote | demote | set_status | assign | unassign
 */

export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const supabase = getSupabaseAdmin()

    const [{ data: masters }, { data: partners }, { data: assignments }] = await Promise.all([
      supabase.from('partners').select('id, name, business_name, email, phone, status, created_at').eq('is_master_partner', true).order('created_at', { ascending: false }),
      supabase.from('partners').select('id, name, business_name, email, phone, status, master_partner_id').eq('is_master_partner', false).order('name', { ascending: true }),
      supabase.from('master_partner_partner_assignments').select('*'),
    ])

    const assignmentByPartner = new Map((assignments || []).map((a: any) => [a.partner_id, a]))

    const mastersWithChildren = (masters || []).map((m: any) => {
      const children = (partners || [])
        .filter((p: any) => p.master_partner_id === m.id)
        .map((p: any) => {
          const a = assignmentByPartner.get(p.id)
          return {
            ...p,
            assignment: a ? { id: a.id, status: a.status } : null,
          }
        })
      return { ...m, children }
    })

    const unassignedPartners = (partners || []).filter((p: any) => !p.master_partner_id)

    return NextResponse.json({
      success: true,
      data: {
        masters: mastersWithChildren,
        unassignedPartners,
      },
    })
  } catch (err: any) {
    console.error('[MCP Admin] GET error:', err)
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
    const { action } = body

    switch (action) {
      // Create a brand-new master partner (partners row + login).
      case 'create': {
        const { name, business_name, email, phone, password } = body
        if (!name || !email || !phone || !password) {
          return NextResponse.json({ error: 'name, email, phone and password are required' }, { status: 400 })
        }
        if (String(password).length < 8) {
          return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
        }

        const [{ data: existingPartner }, { data: existingSub }] = await Promise.all([
          supabase.from('partners').select('id').eq('email', email).maybeSingle(),
          supabase.from('sub_partners').select('id').eq('email', email).maybeSingle(),
        ])
        if (existingPartner || existingSub) {
          return NextResponse.json({ error: 'This email is already registered' }, { status: 400 })
        }

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        })
        if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

        const { data: created, error: insertErr } = await supabase
          .from('partners')
          .insert({
            name,
            business_name: business_name || name,
            email,
            phone,
            status: 'active',
            is_master_partner: true,
          })
          .select()
          .single()

        if (insertErr) {
          await supabase.auth.admin.deleteUser(authData.user.id)
          return NextResponse.json({ error: insertErr.message }, { status: 400 })
        }

        return NextResponse.json({ success: true, data: created })
      }

      // Promote an existing normal partner to a master partner.
      case 'promote': {
        const { partner_id } = body
        if (!partner_id) return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })

        const { data: p } = await supabase.from('partners').select('id, is_master_partner, master_partner_id').eq('id', partner_id).maybeSingle()
        if (!p) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
        if (p.is_master_partner) return NextResponse.json({ error: 'Partner is already a master partner' }, { status: 400 })
        if (p.master_partner_id) {
          return NextResponse.json({ error: 'Partner is assigned under another master partner. Unassign it first.' }, { status: 400 })
        }

        const { error } = await supabase.from('partners').update({ is_master_partner: true, updated_at: new Date().toISOString() }).eq('id', partner_id)
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ success: true })
      }

      // Demote a master partner back to a normal partner (must have no children).
      case 'demote': {
        const { partner_id } = body
        if (!partner_id) return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })

        const { count } = await supabase
          .from('partners')
          .select('id', { count: 'exact', head: true })
          .eq('master_partner_id', partner_id)
        if ((count || 0) > 0) {
          return NextResponse.json({ error: 'This master partner still has child partners. Unassign them first.' }, { status: 400 })
        }

        const { error } = await supabase.from('partners').update({ is_master_partner: false, updated_at: new Date().toISOString() }).eq('id', partner_id)
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ success: true })
      }

      // Assign a child partner under a master partner. The POS commission itself
      // is configured on the child's Partner Plan MDR rate (Scheme Management),
      // so no scheme is selected here.
      case 'assign': {
        const { master_partner_id, partner_id } = body
        if (!master_partner_id || !partner_id) {
          return NextResponse.json({ error: 'master_partner_id and partner_id are required' }, { status: 400 })
        }
        if (master_partner_id === partner_id) {
          return NextResponse.json({ error: 'A master partner cannot be assigned to itself' }, { status: 400 })
        }

        const [{ data: master }, { data: child }] = await Promise.all([
          supabase.from('partners').select('id, is_master_partner').eq('id', master_partner_id).maybeSingle(),
          supabase.from('partners').select('id, is_master_partner, master_partner_id').eq('id', partner_id).maybeSingle(),
        ])
        if (!master || !master.is_master_partner) return NextResponse.json({ error: 'Master partner not found' }, { status: 404 })
        if (!child) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
        if (child.is_master_partner) return NextResponse.json({ error: 'A master partner cannot be a child partner' }, { status: 400 })
        if (child.master_partner_id && child.master_partner_id !== master_partner_id) {
          return NextResponse.json({ error: 'Partner is already assigned to another master partner' }, { status: 400 })
        }

        const { error: linkErr } = await supabase
          .from('partners')
          .update({ master_partner_id, updated_at: new Date().toISOString() })
          .eq('id', partner_id)
        if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 400 })

        const { error: assignErr } = await supabase
          .from('master_partner_partner_assignments')
          .upsert(
            { master_partner_id, partner_id, status: 'active', updated_at: new Date().toISOString() },
            { onConflict: 'partner_id' }
          )
        if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 400 })

        return NextResponse.json({ success: true })
      }

      // Remove a child partner from its master partner.
      case 'unassign': {
        const { partner_id } = body
        if (!partner_id) return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })

        await supabase.from('master_partner_partner_assignments').delete().eq('partner_id', partner_id)
        const { error } = await supabase
          .from('partners')
          .update({ master_partner_id: null, updated_at: new Date().toISOString() })
          .eq('id', partner_id)
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ success: true })
      }

      // Activate / deactivate a master partner account.
      case 'set_status': {
        const { partner_id, status } = body
        if (!partner_id || !['active', 'inactive', 'suspended'].includes(status)) {
          return NextResponse.json({ error: 'partner_id and a valid status are required' }, { status: 400 })
        }
        const { error } = await supabase.from('partners').update({ status, updated_at: new Date().toISOString() }).eq('id', partner_id)
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err: any) {
    console.error('[MCP Admin] POST error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
