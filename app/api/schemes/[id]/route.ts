/**
 * API: /api/schemes/[id]
 * GET - Get scheme details with all configs
 * PUT - Update scheme (only creator or admin)
 * DELETE - Delete scheme (only admin or creator for custom schemes)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';
import { getCurrentUserFromRequest } from '@/lib/auth-server-request';
import { getSchemeById, updateScheme, deleteScheme } from '@/lib/scheme/scheme.service';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Helper: Get admin Supabase client for ownership verification
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await getSchemeById(params.id);
    if (error) {
      return NextResponse.json({ error }, { status: 404 });
    }

    // Retailers can only see schemes mapped to them or global schemes
    if (user.role === 'retailer' && data) {
      const scheme = data as any;
      if (scheme.scheme_type === 'custom' && scheme.created_by_id !== user.partner_id) {
        // Check if this scheme is mapped to the retailer
        const hasMappingToUser = scheme.mappings?.some(
          (m: any) => m.entity_id === user.partner_id && m.status === 'active'
        );
        if (!hasMappingToUser) {
          return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }
      }
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('[API /api/schemes/[id] GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Retailers cannot update schemes
    if (user.role === 'retailer') {
      return NextResponse.json({ error: 'Retailers cannot update schemes' }, { status: 403 });
    }

    // Ownership check: only the creator or admin can update
    if (user.role !== 'admin') {
      const supabase = getSupabase();
      const { data: schemeData } = await supabase
        .from('schemes')
        .select('created_by_id, created_by_role, scheme_type')
        .eq('id', params.id)
        .maybeSingle();

      if (!schemeData) {
        return NextResponse.json({ error: 'Scheme not found' }, { status: 404 });
      }

      // Only the creator can update their own custom schemes
      if (schemeData.created_by_id !== user.partner_id) {
        return NextResponse.json({ error: 'Access denied: you can only update schemes you created' }, { status: 403 });
      }

      // Non-admin cannot change scheme_type to global or golden
      const body_preview = await request.clone().json();
      if (body_preview.scheme_type && ['global', 'golden'].includes(body_preview.scheme_type) && schemeData.scheme_type === 'custom') {
        return NextResponse.json({ error: 'Only admin can change scheme type to global or golden' }, { status: 403 });
      }
    }

    const body = await request.json();

    // Input validation: prevent injection of protected fields
    const allowedFields = ['name', 'description', 'service_scope', 'priority', 'status', 'effective_from', 'effective_to', 'metadata'];
    if (user.role === 'admin') {
      allowedFields.push('scheme_type'); // Only admin can change type
    }
    const sanitizedBody: Record<string, any> = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        sanitizedBody[key] = body[key];
      }
    }

    // Validate name length
    if (sanitizedBody.name && (typeof sanitizedBody.name !== 'string' || sanitizedBody.name.trim().length === 0 || sanitizedBody.name.length > 200)) {
      return NextResponse.json({ error: 'Scheme name must be 1-200 characters' }, { status: 400 });
    }

    // Validate status value
    if (sanitizedBody.status && !['active', 'inactive', 'draft'].includes(sanitizedBody.status)) {
      return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
    }

    const { success, error } = await updateScheme(params.id, sanitizedBody);
    if (!success) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[API /api/schemes/[id] PUT]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admin can delete global/golden schemes
    // MD/Distributor can delete their own custom schemes
    if (user.role === 'retailer') {
      return NextResponse.json({ error: 'Retailers cannot delete schemes' }, { status: 403 });
    }

    if (user.role !== 'admin') {
      const supabase = getSupabase();
      const { data: schemeData } = await supabase
        .from('schemes')
        .select('created_by_id, scheme_type')
        .eq('id', params.id)
        .maybeSingle();

      if (!schemeData) {
        return NextResponse.json({ error: 'Scheme not found' }, { status: 404 });
      }

      // Non-admin can only delete their own custom schemes
      if (schemeData.scheme_type !== 'custom') {
        return NextResponse.json({ error: 'Only admin can delete global/golden schemes' }, { status: 403 });
      }
      if (schemeData.created_by_id !== user.partner_id) {
        return NextResponse.json({ error: 'Access denied: you can only delete schemes you created' }, { status: 403 });
      }
    }

    const { success, error } = await deleteScheme(params.id);
    if (!success) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const ctx = getRequestContext(request);
    logActivityFromContext(ctx, user, {
      activity_type: 'scheme_delete',
      activity_category: 'scheme',
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[API /api/schemes/[id] DELETE]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
