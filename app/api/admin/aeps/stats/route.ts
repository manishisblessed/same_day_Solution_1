import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/aeps/stats
 * Get AEPS statistics for admin dashboard
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Database configuration missing' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check
    const { user } = await getCurrentUserWithFallback(request);

    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      );
    }

    // Get transaction statistics
    const { data: transactions, error: txError } = await supabase
      .from('aeps_transactions')
      .select('id, status, transaction_type, is_financial, amount, created_at');

    if (txError) {
      console.error('[AEPS Stats] Transaction query error:', txError);
      return NextResponse.json(
        { error: 'Failed to fetch transaction data' },
        { status: 500 }
      );
    }

    // Get merchant statistics
    const { data: merchants, error: merchantError } = await supabase
      .from('aeps_merchants')
      .select('id, kyc_status, created_at');

    if (merchantError) {
      console.error('[AEPS Stats] Merchant query error:', merchantError);
    }

    // Calculate statistics
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Filter today's transactions
    const todayTransactions = transactions?.filter(t => new Date(t.created_at) >= today) || [];
    
    // Today's stats (consistent time period for overview cards)
    const todaySuccess = todayTransactions.filter(t => t.status === 'success').length;
    const todayFailed = todayTransactions.filter(t => t.status === 'failed').length;
    const todayPending = todayTransactions.filter(t => t.status === 'pending').length;
    const todayReversed = todayTransactions.filter(t => t.status === 'reversed').length;
    const todaySuccessRate = todayTransactions.length > 0 
      ? (todaySuccess / todayTransactions.length) * 100 : 0;
    const todayVolume = todayTransactions
      .filter(t => t.is_financial && t.status === 'success')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    // All-time stats for breakdown
    const allTimeSuccess = transactions?.filter(t => t.status === 'success').length || 0;
    const allTimeFailed = transactions?.filter(t => t.status === 'failed').length || 0;
    const allTimePending = transactions?.filter(t => t.status === 'pending').length || 0;
    const allTimeReversed = transactions?.filter(t => t.status === 'reversed').length || 0;
    const allTimeTotal = transactions?.length || 0;
    const allTimeSuccessRate = allTimeTotal > 0 
      ? (allTimeSuccess / allTimeTotal) * 100 : 0;

    // Count active merchants (validated)
    const activeMerchants = merchants?.filter(m => m.kyc_status === 'validated').length || 0;
    
    const stats = {
      totalTransactions: todayTransactions.length,
      successCount: allTimeSuccess,
      failedCount: allTimeFailed,
      pendingCount: allTimePending,
      reversedCount: allTimeReversed,
      totalVolume: todayVolume,
      successRate: parseFloat(allTimeSuccessRate.toFixed(2)),
      merchantCount: merchants?.length || 0,
      activeMerchants: activeMerchants,
    };

    return NextResponse.json(stats);

  } catch (error: any) {
    console.error('[AEPS Stats] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch AEPS statistics' },
      { status: 500 }
    );
  }
}
