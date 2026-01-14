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
    // Get current master distributor
    const masterDistributor = await getCurrentUserServer()
    if (!masterDistributor || masterDistributor.role !== 'master_distributor') {
      return NextResponse.json(
        { error: 'Unauthorized: Master distributor access required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { distributor_id, approved_mdr_rate } = body

    // Validation
    if (!distributor_id) {
      return NextResponse.json(
        { error: 'distributor_id is required' },
        { status: 400 }
      )
    }

    if (approved_mdr_rate === undefined || approved_mdr_rate === null) {
      return NextResponse.json(
        { error: 'approved_mdr_rate is required' },
        { status: 400 }
      )
    }

    // Validate MDR rate (should be between 0 and 1, e.g., 0.015 for 1.5%)
    if (approved_mdr_rate < 0 || approved_mdr_rate > 1) {
      return NextResponse.json(
        { error: 'approved_mdr_rate must be between 0 and 1 (e.g., 0.015 for 1.5%)' },
        { status: 400 }
      )
    }

    // Verify distributor belongs to this master distributor
    const { data: distributor, error: distributorError } = await supabase
      .from('distributors')
      .select('*')
      .eq('partner_id', distributor_id)
      .eq('master_distributor_id', masterDistributor.partner_id)
      .single()

    if (distributorError || !distributor) {
      return NextResponse.json(
        { error: 'Distributor not found or does not belong to you' },
        { status: 404 }
      )
    }

    // Update distributor with approved MDR
    const { data: updatedDistributor, error: updateError } = await supabase
      .from('distributors')
      .update({
        approved_mdr_rate: approved_mdr_rate,
        mdr_approved_by: masterDistributor.partner_id,
        mdr_approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('partner_id', distributor_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating distributor MDR:', updateError)
      return NextResponse.json(
        { error: 'Failed to approve MDR' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `MDR ${(approved_mdr_rate * 100).toFixed(2)}% approved successfully`,
      distributor: updatedDistributor
    })
  } catch (error: any) {
    console.error('Error approving MDR:', error)
    return NextResponse.json(
      { error: 'Failed to approve MDR' },
      { status: 500 }
    )
  }
}

