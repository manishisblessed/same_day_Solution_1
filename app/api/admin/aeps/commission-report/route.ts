import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin AEPS Commission & TDS Report
 * GET /api/admin/aeps/commission-report?from=&to=&user_id=
 *
 * Returns aggregated commission and TDS data from commission_ledger,
 * with per-retailer breakdowns for admin oversight and TDS filing.
 */
export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Database configuration missing' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { user } = await getCurrentUserWithFallback(request);
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const url = new URL(request.url);
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const filterUserId = url.searchParams.get('user_id') || '';
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

    // --- 1. Aggregated summary ---
    let summaryQuery = supabase
      .from('commission_ledger')
      .select('total_commission, rt_amount, dt_amount, md_amount, admin_amount, company_extra_amount, tds_amount, status')
      .like('service_type', 'aeps_%');

    if (from) summaryQuery = summaryQuery.gte('created_at', from);
    if (to) summaryQuery = summaryQuery.lte('created_at', `${to}T23:59:59.999Z`);
    if (filterUserId) summaryQuery = summaryQuery.eq('rt_user_id', filterUserId);

    const { data: summaryRows, error: summaryError } = await summaryQuery;

    if (summaryError) {
      console.error('[Admin Commission Report] Summary error:', summaryError);
      return NextResponse.json({ error: 'Failed to load summary' }, { status: 500 });
    }

    const summary = {
      totalCommission: 0,
      totalRtAmount: 0,
      totalDtAmount: 0,
      totalMdAmount: 0,
      totalAdminAmount: 0,
      totalCompanyExtra: 0,
      totalTds: 0,
      distributedCount: 0,
      pendingCount: 0,
      totalEntries: summaryRows?.length || 0,
    };

    for (const row of summaryRows || []) {
      summary.totalCommission += parseFloat(row.total_commission) || 0;
      summary.totalRtAmount += parseFloat(row.rt_amount) || 0;
      summary.totalDtAmount += parseFloat(row.dt_amount) || 0;
      summary.totalMdAmount += parseFloat(row.md_amount) || 0;
      summary.totalAdminAmount += parseFloat(row.admin_amount) || 0;
      summary.totalCompanyExtra += parseFloat(row.company_extra_amount) || 0;
      summary.totalTds += parseFloat(row.tds_amount) || 0;
      if (row.status === 'distributed') summary.distributedCount++;
      else summary.pendingCount++;
    }

    // --- 2. Per-retailer TDS breakdown ---
    let perUserRows: any[] | null = null;
    let perUserError: any = null;
    try {
      const rpcResult = await supabase.rpc('admin_aeps_tds_per_user', {
        p_from: from || '2000-01-01',
        p_to: to ? `${to}T23:59:59.999Z` : '2099-12-31',
        p_user_id: filterUserId || null,
      });
      perUserRows = rpcResult.data;
      perUserError = rpcResult.error;
    } catch {
      perUserError = { message: 'RPC not available' };
    }

    // Fallback: if RPC doesn't exist, aggregate from commission_ledger manually
    let perUserBreakdown: any[] = [];
    if (perUserError || !perUserRows) {
      let fallbackQuery = supabase
        .from('commission_ledger')
        .select('rt_user_id, rt_amount, tds_amount, total_commission')
        .like('service_type', 'aeps_%')
        .eq('status', 'distributed');

      if (from) fallbackQuery = fallbackQuery.gte('created_at', from);
      if (to) fallbackQuery = fallbackQuery.lte('created_at', `${to}T23:59:59.999Z`);
      if (filterUserId) fallbackQuery = fallbackQuery.eq('rt_user_id', filterUserId);

      const { data: fallbackRows } = await fallbackQuery;

      const userMap: Record<string, { userId: string; grossCommission: number; tdsDeducted: number; netCredited: number; txnCount: number }> = {};
      for (const row of fallbackRows || []) {
        const uid = row.rt_user_id;
        if (!userMap[uid]) {
          userMap[uid] = { userId: uid, grossCommission: 0, tdsDeducted: 0, netCredited: 0, txnCount: 0 };
        }
        const gross = parseFloat(row.rt_amount) || 0;
        const tds = parseFloat(row.tds_amount) || 0;
        userMap[uid].grossCommission += gross;
        userMap[uid].tdsDeducted += tds;
        userMap[uid].netCredited += (gross - tds);
        userMap[uid].txnCount++;
      }
      perUserBreakdown = Object.values(userMap).sort((a, b) => b.grossCommission - a.grossCommission);
    } else {
      perUserBreakdown = perUserRows;
    }

    // --- 3. Paginated commission_ledger entries ---
    const offset = (page - 1) * limit;
    let entriesQuery = supabase
      .from('commission_ledger')
      .select('id, transaction_id, service_type, total_commission, admin_amount, md_amount, md_user_id, dt_amount, dt_user_id, rt_amount, rt_user_id, company_extra_amount, tds_amount, status, distributed_at, created_at')
      .like('service_type', 'aeps_%')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) entriesQuery = entriesQuery.gte('created_at', from);
    if (to) entriesQuery = entriesQuery.lte('created_at', `${to}T23:59:59.999Z`);
    if (filterUserId) entriesQuery = entriesQuery.eq('rt_user_id', filterUserId);

    const { data: entries, error: entriesError } = await entriesQuery;

    if (entriesError) {
      console.error('[Admin Commission Report] Entries error:', entriesError);
    }

    // Resolve retailer names for display
    const userIds = new Set<string>();
    for (const e of entries || []) {
      if (e.rt_user_id) userIds.add(e.rt_user_id);
      if (e.dt_user_id) userIds.add(e.dt_user_id);
      if (e.md_user_id) userIds.add(e.md_user_id);
    }
    for (const u of perUserBreakdown) {
      if (u.userId) userIds.add(u.userId);
    }

    const userNames: Record<string, string> = {};
    if (userIds.size > 0) {
      const { data: retailers } = await supabase
        .from('retailers')
        .select('user_id, business_name, mobile')
        .in('user_id', Array.from(userIds));

      for (const r of retailers || []) {
        userNames[r.user_id] = r.business_name || r.mobile || r.user_id;
      }
    }

    return NextResponse.json({
      success: true,
      summary,
      perUserBreakdown: perUserBreakdown.map(u => ({
        ...u,
        userName: userNames[u.userId] || u.userId,
      })),
      entries: (entries || []).map(e => ({
        ...e,
        rt_user_name: userNames[e.rt_user_id] || e.rt_user_id,
        dt_user_name: e.dt_user_id ? (userNames[e.dt_user_id] || e.dt_user_id) : null,
        md_user_name: e.md_user_id ? (userNames[e.md_user_id] || e.md_user_id) : null,
      })),
      page,
      limit,
    });
  } catch (error: any) {
    console.error('[Admin Commission Report] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
