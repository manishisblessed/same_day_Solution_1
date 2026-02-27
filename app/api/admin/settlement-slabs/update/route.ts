import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    // Get current admin user with fallback
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Settlement Slabs Update] Auth:', method, '|', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const {
      slab_id,
      is_enabled
    } = body

    // Validation
    if (!slab_id || is_enabled === undefined) {
      return NextResponse.json(
        { error: 'slab_id and is_enabled are required' },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Update settlement charge slab
    const { data: slab, error: slabError } = await supabase
      .from('settlement_charge_slabs')
      .update({
        is_enabled: is_enabled,
        updated_at: new Date().toISOString()
      })
      .eq('id', slab_id)
      .select()
      .single()

    if (slabError || !slab) {
      console.error('Error updating settlement slab:', slabError)
      return NextResponse.json(
        { error: 'Failed to update settlement slab' },
        { status: 500 }
      )
    }

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: is_enabled ? 'settlement_slab_enable' : 'settlement_slab_disable',
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: `Settlement slab ${is_enabled ? 'enabled' : 'disabled'} - Min: ₹${slab.min_amount}, Max: ₹${slab.max_amount}, Charge: ₹${slab.charge}`,
        metadata: {
          slab_id: slab_id,
          min_amount: slab.min_amount,
          max_amount: slab.max_amount,
          charge: slab.charge
        }
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, admin, {
      activity_type: 'admin_settlement_slabs_update',
      activity_category: 'admin',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: `Settlement slab ${is_enabled ? 'enabled' : 'disabled'} successfully`,
      slab: {
        id: slab.id,
        min_amount: slab.min_amount,
        max_amount: slab.max_amount,
        charge: slab.charge,
        is_enabled: slab.is_enabled
      }
    })
  } catch (error: any) {
    console.error('Error updating settlement slab:', error)
    return NextResponse.json(
      { error: 'Failed to update settlement slab' },
      { status: 500 }
    )
  }
}

