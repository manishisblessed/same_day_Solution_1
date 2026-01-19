import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders } from '@/lib/cors'

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
    
    // Get current distributor
    const distributor = await getCurrentUserServer()
    if (!distributor || distributor.role !== 'distributor') {
      return NextResponse.json(
        { error: 'Unauthorized: Distributor access required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      retailer_id,
      commission_id,
      adjustment_amount,
      adjustment_type, // 'add' or 'deduct'
      remarks
    } = body

    // Validation
    if (!retailer_id || !commission_id || !adjustment_amount || !adjustment_type) {
      return NextResponse.json(
        { error: 'retailer_id, commission_id, adjustment_amount, and adjustment_type are required' },
        { status: 400 }
      )
    }

    if (!['add', 'deduct'].includes(adjustment_type)) {
      return NextResponse.json(
        { error: 'adjustment_type must be "add" or "deduct"' },
        { status: 400 }
      )
    }

    const adjustmentAmount = parseFloat(adjustment_amount)
    if (isNaN(adjustmentAmount) || adjustmentAmount <= 0) {
      return NextResponse.json(
        { error: 'Invalid adjustment_amount' },
        { status: 400 }
      )
    }

    // Verify retailer belongs to this distributor
    const { data: retailer, error: retailerError } = await supabase
      .from('retailers')
      .select('*')
      .eq('partner_id', retailer_id)
      .eq('distributor_id', distributor.partner_id)
      .single()

    if (retailerError || !retailer) {
      return NextResponse.json(
        { error: 'Retailer not found or does not belong to you' },
        { status: 404 }
      )
    }

    // Get commission entry
    const { data: commission, error: commissionError } = await supabase
      .from('commission_ledger')
      .select('*')
      .eq('id', commission_id)
      .eq('user_id', distributor.partner_id)
      .eq('user_role', 'distributor')
      .single()

    if (commissionError || !commission) {
      return NextResponse.json(
        { error: 'Commission not found or does not belong to you' },
        { status: 404 }
      )
    }

    // Calculate new commission amount
    const newCommissionAmount = adjustment_type === 'add' 
      ? commission.commission_amount + adjustmentAmount
      : commission.commission_amount - adjustmentAmount

    if (newCommissionAmount < 0) {
      return NextResponse.json(
        { error: 'Adjustment would result in negative commission' },
        { status: 400 }
      )
    }

    // Update commission ledger
    const { error: updateError } = await supabase
      .from('commission_ledger')
      .update({
        commission_amount: newCommissionAmount,
        updated_at: new Date().toISOString()
      })
      .eq('id', commission_id)

    if (updateError) {
      console.error('Error updating commission:', updateError)
      return NextResponse.json(
        { error: 'Failed to adjust commission' },
        { status: 500 }
      )
    }

    // Adjust wallet balance
    const walletAdjustment = adjustment_type === 'add' ? adjustmentAmount : -adjustmentAmount
    
    const { error: walletError } = await supabase.rpc('add_ledger_entry', {
      p_user_id: distributor.partner_id,
      p_user_role: 'distributor',
      p_wallet_type: 'primary',
      p_fund_category: 'commission',
      p_service_type: 'admin',
      p_tx_type: adjustment_type === 'add' ? 'COMMISSION_ADJUSTMENT_ADD' : 'COMMISSION_ADJUSTMENT_DEDUCT',
      p_credit: adjustment_type === 'add' ? adjustmentAmount : 0,
      p_debit: adjustment_type === 'deduct' ? adjustmentAmount : 0,
      p_reference_id: `COMM_ADJ_${commission_id}`,
      p_transaction_id: null,
      p_status: 'completed',
      p_remarks: remarks || `Commission adjustment: ${adjustment_type} ₹${adjustmentAmount} for transaction ${commission.transaction_id}`
    })

    if (walletError) {
      console.error('Error adjusting wallet:', walletError)
      // Rollback commission update
      await supabase
        .from('commission_ledger')
        .update({
          commission_amount: commission.commission_amount,
          updated_at: commission.updated_at
        })
        .eq('id', commission_id)
      
      return NextResponse.json(
        { error: 'Failed to adjust wallet balance' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Commission ${adjustment_type === 'add' ? 'added' : 'deducted'} successfully`,
      old_commission: commission.commission_amount,
      new_commission: newCommissionAmount,
      adjustment_amount: adjustmentAmount
    })
  } catch (error: any) {
    console.error('Error adjusting commission:', error)
    return NextResponse.json(
      { error: 'Failed to adjust commission' },
      { status: 500 }
    )
  }
}

