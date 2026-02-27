/**
 * API: /api/schemes
 * GET - List schemes (with optional filters)
 * POST - Create a new scheme
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';
import { getCurrentUserFromRequest } from '@/lib/auth-server-request';
import { getSchemes, createScheme } from '@/lib/scheme/scheme.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const filters = {
      scheme_type: url.searchParams.get('scheme_type') || undefined,
      service_scope: url.searchParams.get('service_scope') || undefined,
      status: url.searchParams.get('status') || undefined,
      created_by_id: undefined as string | undefined,
    };

    // Non-admin users can only see their own custom schemes + all global/golden
    // This is handled in the response filter below

    const { data, error } = await getSchemes(filters);
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    // Filter: non-admin see global/golden + their own custom schemes
    let filteredData = data;
    if (user.role !== 'admin') {
      filteredData = data.filter(
        (s) =>
          s.scheme_type === 'global' ||
          s.scheme_type === 'golden' ||
          s.created_by_id === user.partner_id
      );
    }

    return NextResponse.json({ success: true, data: filteredData });
  } catch (err: any) {
    console.error('[API /api/schemes GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Retailers cannot create schemes
    if (user.role === 'retailer') {
      return NextResponse.json({ error: 'Retailers cannot create schemes' }, { status: 403 });
    }

    const body = await request.json();

    // Only admin can create global/golden schemes
    if ((body.scheme_type === 'global' || body.scheme_type === 'golden') && user.role !== 'admin') {
      return NextResponse.json({ error: 'Only admin can create global/golden schemes' }, { status: 403 });
    }

    // Input validation
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'Scheme name is required' }, { status: 400 });
    }
    if (body.name.length > 200) {
      return NextResponse.json({ error: 'Scheme name must be 200 characters or less' }, { status: 400 });
    }

    // Validate scheme_type
    if (!body.scheme_type || !['global', 'golden', 'custom'].includes(body.scheme_type)) {
      return NextResponse.json({ error: 'Invalid scheme_type. Must be global, golden, or custom' }, { status: 400 });
    }

    // Validate service_scope
    if (body.service_scope && !['all', 'bbps', 'payout', 'mdr', 'settlement'].includes(body.service_scope)) {
      return NextResponse.json({ error: 'Invalid service_scope' }, { status: 400 });
    }

    // Non-admin can only create custom schemes
    if (user.role !== 'admin' && body.scheme_type !== 'custom') {
      return NextResponse.json({ error: 'Only admin can create non-custom schemes' }, { status: 403 });
    }

    const { data, error } = await createScheme(body, user.partner_id, user.role);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const ctx = getRequestContext(request);
    logActivityFromContext(ctx, user, {
      activity_type: 'scheme_create',
      activity_category: 'scheme',
      activity_description: `Created scheme: ${body.name}`,
      reference_table: 'schemes',
    }).catch(() => {});

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('[API /api/schemes POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
