import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders } from '@/lib/cors'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Get current admin user
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
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

