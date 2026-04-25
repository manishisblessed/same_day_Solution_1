import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/aeps/cleanup
 * Clean up test/dummy AEPS data (admin only)
 */
export async function POST(request: NextRequest) {
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

    // Auth check - ADMIN ONLY
    const { user } = await getCurrentUserWithFallback(request);

    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      );
    }

    const { confirmDelete } = await request.json();

    if (!confirmDelete) {
      return NextResponse.json(
        { error: 'Confirmation required. Set confirmDelete: true' },
        { status: 400 }
      );
    }

    // Get counts before deletion
    const { count: txnCountBefore } = await supabase
      .from('aeps_transactions')
      .select('*', { count: 'exact', head: true });

    const { count: merchantCountBefore } = await supabase
      .from('aeps_merchants')
      .select('*', { count: 'exact', head: true });

    // Delete all AEPS transactions
    const { error: txnError } = await supabase
      .from('aeps_transactions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (txnError) {
      console.error('[AEPS Cleanup] Transaction deletion error:', txnError);
      return NextResponse.json(
        { error: 'Failed to delete transactions' },
        { status: 500 }
      );
    }

    // Delete all AEPS merchants
    const { error: merchantError } = await supabase
      .from('aeps_merchants')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (merchantError) {
      console.error('[AEPS Cleanup] Merchant deletion error:', merchantError);
      return NextResponse.json(
        { error: 'Failed to delete merchants' },
        { status: 500 }
      );
    }

    // Get counts after deletion
    const { count: txnCountAfter } = await supabase
      .from('aeps_transactions')
      .select('*', { count: 'exact', head: true });

    const { count: merchantCountAfter } = await supabase
      .from('aeps_merchants')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      success: true,
      message: 'AEPS data cleanup completed',
      deleted: {
        transactions: (txnCountBefore || 0) - (txnCountAfter || 0),
        merchants: (merchantCountBefore || 0) - (merchantCountAfter || 0),
      },
      remaining: {
        transactions: txnCountAfter || 0,
        merchants: merchantCountAfter || 0,
      },
    });

  } catch (error: any) {
    console.error('[AEPS Cleanup] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to cleanup AEPS data' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/aeps/cleanup
 * Preview what will be deleted (admin only)
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

    // Auth check - ADMIN ONLY
    const { user } = await getCurrentUserWithFallback(request);

    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      );
    }

    // Get transaction summary
    const { data: transactions, count: txnCount } = await supabase
      .from('aeps_transactions')
      .select('status, transaction_type, amount, created_at', { count: 'exact' });

    const { count: merchantCount } = await supabase
      .from('aeps_merchants')
      .select('*', { count: 'exact', head: true });

    const summary = {
      transactions: {
        total: txnCount || 0,
        byStatus: {
          success: transactions?.filter(t => t.status === 'success').length || 0,
          failed: transactions?.filter(t => t.status === 'failed').length || 0,
          pending: transactions?.filter(t => t.status === 'pending').length || 0,
        },
        oldestDate: transactions && transactions.length > 0 
          ? transactions.reduce((min, t) => t.created_at < min ? t.created_at : min, transactions[0].created_at)
          : null,
        newestDate: transactions && transactions.length > 0
          ? transactions.reduce((max, t) => t.created_at > max ? t.created_at : max, transactions[0].created_at)
          : null,
      },
      merchants: {
        total: merchantCount || 0,
      },
    };

    return NextResponse.json({
      success: true,
      summary,
      message: 'Preview of AEPS data to be deleted. Use POST with confirmDelete: true to proceed.',
    });

  } catch (error: any) {
    console.error('[AEPS Cleanup Preview] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to preview cleanup' },
      { status: 500 }
    );
  }
}
