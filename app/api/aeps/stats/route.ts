import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Get AEPS dashboard statistics
 * GET /api/aeps/stats
 */
export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Database configuration missing' },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { user, method } = await getCurrentUserWithFallback(request);
    console.log('[AEPS Stats] Auth:', method, '|', user?.email || 'none');

    if (!user || !user.partner_id) {
      return NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Get total transactions stats
    const { data: totalStats, error: totalError } = await supabase
      .from('aeps_transactions')
      .select('status, amount')
      .eq('user_id', user.partner_id);

    if (totalError) {
      console.error('[AEPS Stats] Total stats error:', totalError);
    }

    // Get today's transactions
    const { data: todayStats, error: todayError } = await supabase
      .from('aeps_transactions')
      .select('status, amount')
      .eq('user_id', user.partner_id)
      .gte('created_at', today.toISOString());

    if (todayError) {
      console.error('[AEPS Stats] Today stats error:', todayError);
    }

    // Get wallet balance
    const { data: walletBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user.partner_id,
      p_wallet_type: 'aeps'
    });

    // Calculate stats
    const transactions = totalStats || [];
    const todayTxns = todayStats || [];

    const totalTransactions = transactions.length;
    const successfulTransactions = transactions.filter(t => t.status === 'success').length;
    const failedTransactions = transactions.filter(t => t.status === 'failed').length;
    const totalVolume = transactions
      .filter(t => t.status === 'success' && t.amount)
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const todayTransactions = todayTxns.length;
    const todayVolume = todayTxns
      .filter(t => t.status === 'success' && t.amount)
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    // Get commission earned (simplified - in production, calculate from ledger)
    const { data: commissionData } = await supabase
      .from('wallet_ledger')
      .select('credit')
      .eq('user_id', user.partner_id)
      .eq('wallet_type', 'aeps')
      .eq('tx_type', 'AEPS_COMMISSION')
      .gte('created_at', startOfMonth.toISOString());

    const commission = (commissionData || []).reduce((sum, c) => sum + (c.credit || 0), 0);

    return NextResponse.json({
      success: true,
      data: {
        totalTransactions,
        successfulTransactions,
        failedTransactions,
        totalVolume,
        todayVolume,
        todayTransactions,
        walletBalance: walletBalance || 0,
        commission,
      },
    });
  } catch (error: any) {
    console.error('[AEPS Stats] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
