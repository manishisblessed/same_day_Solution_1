import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders } from '@/lib/cors'
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
    console.log('[BBPS Slabs Update] Auth:', method, '|', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const {
      slab_name,
      is_enabled
    } = body

    // Validation
    if (!slab_name || is_enabled === undefined) {
      return NextResponse.json(
        { error: 'slab_name and is_enabled are required' },
        { status: 400 }
      )
    }

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Update slab
    const { data: slab, error: slabError } = await supabase
      .from('bbps_limit_slabs')
      .update({
        is_enabled: is_enabled,
        updated_at: new Date().toISOString()
      })
      .eq('slab_name', slab_name)
      .select()
      .single()

    if (slabError || !slab) {
      console.error('Error updating BBPS slab:', slabError)
      return NextResponse.json(
        { error: 'Failed to update BBPS slab' },
        { status: 500 }
      )
    }

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: is_enabled ? 'bbps_slab_enable' : 'bbps_slab_disable',
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: `BBPS slab ${is_enabled ? 'enabled' : 'disabled'} - ${slab_name}`,
        metadata: {
          slab_name: slab_name,
          min_amount: slab.min_amount,
          max_amount: slab.max_amount
        }
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
      // Don't fail the request if audit logging fails
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, admin, {
      activity_type: 'admin_bbps_slabs_update',
      activity_category: 'admin',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: `BBPS slab ${is_enabled ? 'enabled' : 'disabled'} successfully`,
      slab: slab
    })
  } catch (error: any) {
    console.error('Error updating BBPS slab:', error)
    return NextResponse.json(
      { error: 'Failed to update BBPS slab' },
      { status: 500 }
    )
  }
}

