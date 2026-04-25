import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/aeps/merchants
 * Get AEPS merchants list with pagination and filters
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
    const kycStatus = searchParams.get('kyc_status');
    const userId = searchParams.get('user_id');
    const search = searchParams.get('search');

    // Build query
    let query = supabase
      .from('aeps_merchants')
      .select(`
        *,
        users:user_id (
          partner_id,
          email,
          role
        )
      `, { count: 'exact' });

    // Apply filters
    if (kycStatus) {
      query = query.eq('kyc_status', kycStatus);
    }

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (search) {
      // Search in multiple fields
      query = query.or(
        `name.ilike.%${search}%,mobile.ilike.%${search}%,email.ilike.%${search}%,merchant_id.ilike.%${search}%,pan.ilike.%${search}%`
      );
    }

    // Order by created_at desc
    query = query.order('created_at', { ascending: false });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: merchants, error, count } = await query;

    if (error) {
      console.error('[AEPS Merchants] Query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch merchants' },
        { status: 500 }
      );
    }

    // Calculate summary statistics
    const summary = merchants
      ? {
          total: count || 0,
          validated: merchants.filter(m => m.kyc_status === 'validated').length,
          pending: merchants.filter(m => m.kyc_status === 'pending').length,
          rejected: merchants.filter(m => m.kyc_status === 'rejected').length,
        }
      : { total: 0, validated: 0, pending: 0, rejected: 0 };

    return NextResponse.json({
      merchants: merchants || [],
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
      summary,
    });

  } catch (error: any) {
    console.error('[AEPS Merchants] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch merchants' },
      { status: 500 }
    );
  }
}
