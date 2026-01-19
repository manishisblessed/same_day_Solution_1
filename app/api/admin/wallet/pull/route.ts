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
      user_id,
      user_role,
      wallet_type = 'primary',
      fund_category,
      amount,
      remarks
    } = body

    // Validation
    if (!user_id || !user_role || !fund_category || !amount) {
      return NextResponse.json(
        { error: 'user_id, user_role, fund_category, and amount are required' },
        { status: 400 }
      )
    }

    if (!['retailer', 'distributor', 'master_distributor'].includes(user_role)) {
      return NextResponse.json(
        { error: 'Invalid user_role' },
        { status: 400 }
      )
    }

    if (!['primary', 'aeps'].includes(wallet_type)) {
      return NextResponse.json(
        { error: 'Invalid wallet_type' },
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

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown'

    // Get before balance
    const { data: beforeBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user_id,
      p_wallet_type: wallet_type
    })

    // Check sufficient balance
    if ((beforeBalance || 0) < amountDecimal) {
      return NextResponse.json(
        { 
          error: 'Insufficient balance',
          available_balance: beforeBalance || 0,
          requested_amount: amountDecimal
        },
        { status: 400 }
      )
    }

    // Check if wallet is frozen
    const { data: wallet } = await supabase
      .from('wallets')
      .select('is_frozen')
      .eq('user_id', user_id)
      .eq('wallet_type', wallet_type)
      .single()

    if (wallet?.is_frozen) {
      return NextResponse.json(
        { error: 'Wallet is frozen. Cannot pull funds.' },
        { status: 403 }
      )
    }

    // Add ledger entry and update wallet balance
    const { data: ledgerId, error: ledgerError } = await supabase.rpc('add_ledger_entry', {
      p_user_id: user_id,
      p_user_role: user_role,
      p_wallet_type: wallet_type,
      p_fund_category: fund_category,
      p_service_type: 'admin',
      p_tx_type: 'ADJUSTMENT',
      p_credit: 0,
      p_debit: amountDecimal,
      p_reference_id: `ADMIN_PULL_${Date.now()}`,
      p_status: 'completed',
      p_remarks: remarks || `Admin pull funds - ${fund_category}`
    })

    if (ledgerError) {
      console.error('Error adding ledger entry:', ledgerError)
      return NextResponse.json(
        { error: 'Failed to pull funds' },
        { status: 500 }
      )
    }

    // Get after balance
    const { data: afterBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user_id,
      p_wallet_type: wallet_type
    })

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: 'wallet_pull',
        target_user_id: user_id,
        target_user_role: user_role,
        wallet_type: wallet_type,
        fund_category: fund_category,
        amount: amountDecimal,
        before_balance: beforeBalance || 0,
        after_balance: afterBalance || 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: remarks || `Admin pull funds - ${fund_category}`
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
      // Don't fail the request if audit logging fails
    }

    return NextResponse.json({
      success: true,
      message: 'Funds pulled successfully',
      ledger_id: ledgerId,
      before_balance: beforeBalance || 0,
      after_balance: afterBalance || 0,
      amount: amountDecimal
    })
  } catch (error: any) {
    console.error('Error pulling funds:', error)
    return NextResponse.json(
      { error: 'Failed to pull funds' },
      { status: 500 }
    )
  }
}

