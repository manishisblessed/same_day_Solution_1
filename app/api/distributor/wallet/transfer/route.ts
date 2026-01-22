import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
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
    
    // Get current distributor with fallback
    const { user: distributor, method } = await getCurrentUserWithFallback(request)
    console.log('[Distributor Wallet Transfer] Auth:', method, '|', distributor?.email || 'none')
    
    if (!distributor) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (distributor.role !== 'distributor') {
      return NextResponse.json({ error: 'Unauthorized: Distributor access required' }, { status: 403 })
    }

    const body = await request.json()
    const {
      retailer_id,
      action, // 'push' or 'pull'
      amount,
      fund_category, // 'cash' or 'online'
      remarks
    } = body

    // Validation
    if (!retailer_id || !action || !amount || !fund_category) {
      return NextResponse.json(
        { error: 'retailer_id, action, amount, and fund_category are required' },
        { status: 400 }
      )
    }

    if (!['push', 'pull'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "push" or "pull"' },
        { status: 400 }
      )
    }

    if (!['cash', 'online'].includes(fund_category)) {
      return NextResponse.json(
        { error: 'fund_category must be "cash" or "online"' },
        { status: 400 }
      )
    }

    const amountDecimal = parseFloat(amount)
    if (isNaN(amountDecimal) || amountDecimal <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount' },
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

    // Get IP address for audit
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    if (action === 'push') {
      // Push funds: Debit distributor, Credit retailer
      
      // Check distributor balance
      const { data: distributorBalance } = await supabase.rpc('get_wallet_balance_v2', {
        p_user_id: distributor.partner_id,
        p_wallet_type: 'primary'
      })

      if ((distributorBalance || 0) < amountDecimal) {
        return NextResponse.json(
          { 
            error: 'Insufficient balance',
            available_balance: distributorBalance || 0,
            requested_amount: amountDecimal
          },
          { status: 400 }
        )
      }

      // Debit distributor wallet
      const { data: distributorLedger, error: debitError } = await supabase.rpc('debit_wallet_v2', {
        p_user_id: distributor.partner_id,
        p_user_role: 'distributor',
        p_wallet_type: 'primary',
        p_fund_category: fund_category,
        p_service_type: 'admin',
        p_amount: amountDecimal,
        p_debit: amountDecimal,
        p_transaction_id: null,
        p_reference_id: `DIST_PUSH_${Date.now()}`,
        p_remarks: remarks || `Fund push to retailer ${retailer.name} (${retailer.partner_id})`
      })

      if (debitError) {
        console.error('Error debiting distributor wallet:', debitError)
        return NextResponse.json(
          { error: 'Failed to debit distributor wallet' },
          { status: 500 }
        )
      }

      // Credit retailer wallet
      const { data: retailerLedger, error: creditError } = await supabase.rpc('credit_wallet_v2', {
        p_user_id: retailer_id,
        p_user_role: 'retailer',
        p_wallet_type: 'primary',
        p_fund_category: fund_category,
        p_service_type: 'admin',
        p_amount: amountDecimal,
        p_credit: amountDecimal,
        p_transaction_id: null,
        p_reference_id: `DIST_PUSH_${Date.now()}`,
        p_remarks: remarks || `Fund received from distributor ${distributor.name} (${distributor.partner_id})`
      })

      if (creditError) {
        console.error('Error crediting retailer wallet:', creditError)
        // Try to reverse distributor debit
        await supabase.rpc('credit_wallet_v2', {
          p_user_id: distributor.partner_id,
          p_user_role: 'distributor',
          p_wallet_type: 'primary',
          p_fund_category: fund_category,
          p_service_type: 'admin',
          p_amount: amountDecimal,
          p_credit: amountDecimal,
          p_transaction_id: null,
          p_reference_id: `REVERSE_${Date.now()}`,
          p_remarks: 'Reversal: Failed to credit retailer wallet'
        })
        return NextResponse.json(
          { error: 'Failed to credit retailer wallet' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: `Funds pushed successfully to retailer`,
        amount: amountDecimal,
        fund_category: fund_category,
        distributor_balance: (distributorBalance || 0) - amountDecimal
      })
    } else {
      // Pull funds: Debit retailer, Credit distributor
      
      // Check retailer balance
      const { data: retailerBalance } = await supabase.rpc('get_wallet_balance_v2', {
        p_user_id: retailer_id,
        p_wallet_type: 'primary'
      })

      if ((retailerBalance || 0) < amountDecimal) {
        return NextResponse.json(
          { 
            error: 'Retailer has insufficient balance',
            available_balance: retailerBalance || 0,
            requested_amount: amountDecimal
          },
          { status: 400 }
        )
      }

      // Debit retailer wallet
      const { data: retailerLedger, error: debitError } = await supabase.rpc('debit_wallet_v2', {
        p_user_id: retailer_id,
        p_user_role: 'retailer',
        p_wallet_type: 'primary',
        p_fund_category: fund_category,
        p_service_type: 'admin',
        p_amount: amountDecimal,
        p_debit: amountDecimal,
        p_transaction_id: null,
        p_reference_id: `DIST_PULL_${Date.now()}`,
        p_remarks: remarks || `Fund pulled by distributor ${distributor.name} (${distributor.partner_id})`
      })

      if (debitError) {
        console.error('Error debiting retailer wallet:', debitError)
        return NextResponse.json(
          { error: 'Failed to debit retailer wallet' },
          { status: 500 }
        )
      }

      // Credit distributor wallet
      const { data: distributorLedger, error: creditError } = await supabase.rpc('credit_wallet_v2', {
        p_user_id: distributor.partner_id,
        p_user_role: 'distributor',
        p_wallet_type: 'primary',
        p_fund_category: fund_category,
        p_service_type: 'admin',
        p_amount: amountDecimal,
        p_credit: amountDecimal,
        p_transaction_id: null,
        p_reference_id: `DIST_PULL_${Date.now()}`,
        p_remarks: remarks || `Fund pulled from retailer ${retailer.name} (${retailer.partner_id})`
      })

      if (creditError) {
        console.error('Error crediting distributor wallet:', creditError)
        // Try to reverse retailer debit
        await supabase.rpc('credit_wallet_v2', {
          p_user_id: retailer_id,
          p_user_role: 'retailer',
          p_wallet_type: 'primary',
          p_fund_category: fund_category,
          p_service_type: 'admin',
          p_amount: amountDecimal,
          p_credit: amountDecimal,
          p_transaction_id: null,
          p_reference_id: `REVERSE_${Date.now()}`,
          p_remarks: 'Reversal: Failed to credit distributor wallet'
        })
        return NextResponse.json(
          { error: 'Failed to credit distributor wallet' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: `Funds pulled successfully from retailer`,
        amount: amountDecimal,
        fund_category: fund_category
      })
    }
  } catch (error: any) {
    console.error('Error in fund transfer:', error)
    return NextResponse.json(
      { error: 'Failed to transfer funds' },
      { status: 500 }
    )
  }
}

