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
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Filter today's transactions
    const todayTransactions = transactions?.filter(t => new Date(t.created_at) >= today) || [];
    
    // Calculate success rate
    const totalTxns = transactions?.length || 0;
    const successTxns = transactions?.filter(t => t.status === 'success').length || 0;
    const successRateCalc = totalTxns > 0 ? (successTxns / totalTxns) * 100 : 0;
    
    // Calculate today's volume
    const todayVolume = todayTransactions
      .filter(t => t.is_financial && t.status === 'success')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    // Count active merchants (validated)
    const activeMerchants = merchants?.filter(m => m.kyc_status === 'validated').length || 0;
    
    // Match frontend interface exactly
    const stats = {
      totalTransactions: todayTransactions.length,
      successCount: transactions?.filter(t => t.status === 'success').length || 0,
      failedCount: transactions?.filter(t => t.status === 'failed').length || 0,
      pendingCount: transactions?.filter(t => t.status === 'pending').length || 0,
      totalVolume: todayVolume,
      successRate: parseFloat(successRateCalc.toFixed(2)),
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
