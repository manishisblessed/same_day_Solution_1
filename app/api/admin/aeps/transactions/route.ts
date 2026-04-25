import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/aeps/transactions
 * Get AEPS transactions list with pagination and filters
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

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status');
    const transactionType = searchParams.get('transaction_type');
    const userId = searchParams.get('user_id');
    const merchantId = searchParams.get('merchant_id');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const search = searchParams.get('search');

    // Build query
    let query = supabase
      .from('aeps_transactions')
      .select(`
        *,
        users:user_id (
          partner_id,
          email,
          role
        )
      `, { count: 'exact' });

    // Apply filters
    if (status) {
      query = query.eq('status', status);
    }

    if (transactionType) {
      query = query.eq('transaction_type', transactionType);
    }

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (merchantId) {
      query = query.eq('merchant_id', merchantId);
    }

    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }

    if (search) {
      // Search in multiple fields
      query = query.or(
        `order_id.ilike.%${search}%,utr.ilike.%${search}%,bank_iin.ilike.%${search}%,aadhaar_number_masked.ilike.%${search}%`
      );
    }

    // Order by created_at desc
    query = query.order('created_at', { ascending: false });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: transactions, error, count } = await query;

    if (error) {
      console.error('[AEPS Transactions] Query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch transactions' },
        { status: 500 }
      );
    }

    // Calculate summary statistics for current filter
    const summary = transactions
      ? {
          total: count || 0,
          success: transactions.filter(t => t.status === 'success').length,
          failed: transactions.filter(t => t.status === 'failed').length,
          pending: transactions.filter(t => t.status === 'pending').length,
          totalAmount: transactions
            .filter(t => t.is_financial && t.status === 'success')
            .reduce((sum, t) => sum + (t.amount || 0), 0),
        }
      : { total: 0, success: 0, failed: 0, pending: 0, totalAmount: 0 };

    return NextResponse.json({
      transactions: transactions || [],
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
      summary,
    });

  } catch (error: any) {
    console.error('[AEPS Transactions] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}
