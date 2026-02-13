/**
 * API: /api/schemes/mappings
 * GET - List scheme mappings (with filters)
 * POST - Create a new scheme mapping (assign scheme to user)
 * DELETE - Remove a mapping
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth-server-request';
import {
  getSchemeMappings,
  createSchemeMapping,
  deleteSchemeMapping,
} from '@/lib/scheme/scheme.service';

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
      scheme_id: url.searchParams.get('scheme_id') || undefined,
      entity_id: url.searchParams.get('entity_id') || undefined,
      entity_role: url.searchParams.get('entity_role') || undefined,
      status: url.searchParams.get('status') || 'active',
    };

    // Non-admin: can only see their own mappings or their downstream
    if (user.role === 'retailer') {
      filters.entity_id = user.partner_id;
    }

    const data = await getSchemeMappings(filters);
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('[API /api/schemes/mappings GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Validate: admin can assign to anyone, distributor can assign to their retailers
    if (user.role !== 'admin' && user.role !== 'master_distributor' && user.role !== 'distributor') {
      return NextResponse.json({ error: 'Only admin/distributor/MD can assign schemes' }, { status: 403 });
    }

    const { data, error } = await createSchemeMapping(body, user.partner_id, user.role);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('[API /api/schemes/mappings POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const mappingId = url.searchParams.get('id');

    if (!mappingId) {
      return NextResponse.json({ error: 'Mapping id is required' }, { status: 400 });
    }

    const { success } = await deleteSchemeMapping(mappingId);
    return NextResponse.json({ success });
  } catch (err: any) {
    console.error('[API /api/schemes/mappings DELETE]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

