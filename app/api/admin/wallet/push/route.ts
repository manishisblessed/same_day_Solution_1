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
    
    // Get current admin user with fallback
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Wallet Push] Auth method:', method, '| User:', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    // Note: Wallet push/pull is a core admin function available to all admins
    // Permission checks can be added later if needed for role-based access control

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

    if (!['cash', 'online', 'commission', 'settlement', 'adjustment', 'aeps', 'bbps', 'other'].includes(fund_category)) {
      return NextResponse.json(
        { error: 'Invalid fund_category' },
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

    // Check if wallet is frozen
    const { data: wallet } = await supabase
      .from('wallets')
      .select('is_frozen')
      .eq('user_id', user_id)
      .eq('wallet_type', wallet_type)
      .single()

    if (wallet?.is_frozen) {
      return NextResponse.json(
        { error: 'Wallet is frozen. Cannot push funds.' },
        { status: 403 }
      )
    }

    // Add ledger entry and update wallet balance (real-time update)
    const { data: ledgerId, error: ledgerError } = await supabase.rpc('add_ledger_entry', {
      p_user_id: user_id,
      p_user_role: user_role,
      p_wallet_type: wallet_type,
      p_fund_category: fund_category,
      p_service_type: 'admin',
      p_tx_type: 'ADJUSTMENT',
      p_credit: amountDecimal,
      p_debit: 0,
      p_reference_id: `ADMIN_PUSH_${Date.now()}`,
      p_status: 'completed',
      p_remarks: remarks || `Admin push funds - ${fund_category}`
    })

    if (ledgerError) {
      console.error('Error adding ledger entry:', ledgerError)
      return NextResponse.json(
        { error: 'Failed to push funds' },
        { status: 500 }
      )
    }

    // Get after balance (real-time balance update)
    const { data: afterBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user_id,
      p_wallet_type: wallet_type
    })

    // If funds are added to primary wallet and there are pending settlements, 
    // check if any can be processed (for instant settlements)
    if (wallet_type === 'primary' && fund_category === 'settlement') {
      // Check for pending instant settlements that can now be processed
      const { data: pendingSettlements } = await supabase
        .from('settlements')
        .select('*')
        .eq('user_id', user_id)
        .eq('status', 'processing')
        .eq('settlement_mode', 'instant')
        .order('created_at', { ascending: true })
        .limit(10)

      // Note: Settlement processing will be handled by admin via /api/admin/settlement/release
      // This is just for tracking - actual release requires admin approval
    }

    // Log admin action
    const { error: auditError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: 'wallet_push',
        target_user_id: user_id,
        target_user_role: user_role,
        wallet_type: wallet_type,
        fund_category: fund_category,
        amount: amountDecimal,
        before_balance: beforeBalance || 0,
        after_balance: afterBalance || 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: remarks || `Admin push funds - ${fund_category}`
      })

    if (auditError) {
      console.error('Error logging admin action:', auditError)
      // Don't fail the request if audit logging fails
    }

    return NextResponse.json({
      success: true,
      message: 'Funds pushed successfully',
      ledger_id: ledgerId,
      before_balance: beforeBalance || 0,
      after_balance: afterBalance || 0,
      amount: amountDecimal
    })
  } catch (error: any) {
    console.error('Error pushing funds:', error)
    return NextResponse.json(
      { error: 'Failed to push funds' },
      { status: 500 }
    )
  }
}

