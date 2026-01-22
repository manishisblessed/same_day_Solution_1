import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

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
    console.log('[Commission Push] Auth:', method, '|', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const {
      user_id,
      user_role,
      amount,
      remarks
    } = body

    // Validation
    if (!user_id || !user_role || !amount) {
      return NextResponse.json(
        { error: 'user_id, user_role, and amount are required' },
        { status: 400 }
      )
    }

    if (!['retailer', 'distributor', 'master_distributor'].includes(user_role)) {
      return NextResponse.json(
        { error: 'Invalid user_role' },
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
      p_wallet_type: 'primary'
    })

    // Create commission ledger entry
    const { data: commissionEntry, error: commissionError } = await supabase
      .from('commission_ledger')
      .insert({
        user_id: user_id,
        user_role: user_role,
        service_type: 'admin',
        transaction_id: null,
        reference_id: `ADMIN_COMM_PUSH_${Date.now()}`,
        mdr_amount: 0,
        commission_rate: 0,
        commission_amount: amountDecimal,
        is_locked: false,
        status: 'credited',
        remarks: remarks || 'Commission pushed by admin'
      })
      .select()
      .single()

    if (commissionError || !commissionEntry) {
      console.error('Error creating commission entry:', commissionError)
      return NextResponse.json(
        { error: 'Failed to create commission entry' },
        { status: 500 }
      )
    }

    // Credit wallet with commission
    const { data: ledgerId, error: ledgerError } = await supabase.rpc('add_ledger_entry', {
      p_user_id: user_id,
      p_user_role: user_role,
      p_wallet_type: 'primary',
      p_fund_category: 'commission',
      p_service_type: 'admin',
      p_tx_type: 'CREDIT',
      p_credit: amountDecimal,
      p_debit: 0,
      p_reference_id: commissionEntry.reference_id,
      p_transaction_id: commissionEntry.id,
      p_status: 'completed',
      p_remarks: remarks || 'Commission pushed by admin'
    })

    if (ledgerError) {
      console.error('Error crediting wallet:', ledgerError)
      // Rollback commission entry
      await supabase
        .from('commission_ledger')
        .delete()
        .eq('id', commissionEntry.id)
      
      return NextResponse.json(
        { error: 'Failed to credit wallet' },
        { status: 500 }
      )
    }

    // Update commission entry with ledger ID
    await supabase
      .from('commission_ledger')
      .update({ ledger_entry_id: ledgerId })
      .eq('id', commissionEntry.id)

    // Get after balance
    const { data: afterBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user_id,
      p_wallet_type: 'primary'
    })

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: 'commission_push',
        target_user_id: user_id,
        target_user_role: user_role,
        wallet_type: 'primary',
        fund_category: 'commission',
        amount: amountDecimal,
        before_balance: beforeBalance || 0,
        after_balance: afterBalance || 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: remarks || 'Commission pushed by admin',
        metadata: { commission_id: commissionEntry.id }
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
    }

    return NextResponse.json({
      success: true,
      message: 'Commission pushed successfully',
      commission_id: commissionEntry.id,
      ledger_id: ledgerId,
      before_balance: beforeBalance || 0,
      after_balance: afterBalance || 0,
      amount: amountDecimal
    })
  } catch (error: any) {
    console.error('Error pushing commission:', error)
    return NextResponse.json(
      { error: 'Failed to push commission' },
      { status: 500 }
    )
  }
}

