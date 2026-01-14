import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

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

