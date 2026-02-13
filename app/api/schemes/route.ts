/**
 * API: /api/schemes
 * GET - List schemes (with optional filters)
 * POST - Create a new scheme
 */

import { NextRequest, NextResponse } from 'next/server';
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
    if (user.role !== 'admin') {
      // They'll see global+golden + their own customs
      // This is handled in the response filter below
    }

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

    // Only admin can create global/golden schemes
    const body = await request.json();
    if ((body.scheme_type === 'global' || body.scheme_type === 'golden') && user.role !== 'admin') {
      return NextResponse.json({ error: 'Only admin can create global/golden schemes' }, { status: 403 });
    }

    const { data, error } = await createScheme(body, user.partner_id, user.role);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('[API /api/schemes POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

