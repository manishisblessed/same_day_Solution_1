/**
 * API: /api/schemes/mappings
 * GET - List scheme mappings (with filters)
 * POST - Create a new scheme mapping (assign scheme to user)
 * DELETE - Remove a mapping
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';
import { getCurrentUserFromRequest } from '@/lib/auth-server-request';
import {
  getSchemeMappings,
  createSchemeMapping,
  deleteSchemeMapping,
} from '@/lib/scheme/scheme.service';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Helper: Get admin Supabase client for ownership verification
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

// Helper: Verify that a distributor owns the retailer
async function verifyDistributorOwnsRetailer(distributorId: string, retailerId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('retailers')
    .select('partner_id')
    .eq('partner_id', retailerId)
    .eq('distributor_id', distributorId)
    .maybeSingle();
  return !!data;
}

// Helper: Verify that an MD owns the distributor
async function verifyMDOwnsDistributor(mdId: string, distributorId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('distributors')
    .select('partner_id')
    .eq('partner_id', distributorId)
    .eq('master_distributor_id', mdId)
    .maybeSingle();
  return !!data;
}

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
    // Distributors can only see mappings they assigned or for their own retailers
    if (user.role === 'distributor' && filters.entity_id && user.partner_id) {
      // Verify the entity belongs to this distributor
      const entityId = filters.entity_id;
      const isOwned = await verifyDistributorOwnsRetailer(user.partner_id, entityId);
      if (!isOwned && entityId !== user.partner_id) {
        return NextResponse.json({ error: 'Access denied: entity does not belong to you' }, { status: 403 });
      }
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
    if (!user || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Validate: only admin/MD/distributor can assign schemes
    if (user.role !== 'admin' && user.role !== 'master_distributor' && user.role !== 'distributor') {
      return NextResponse.json({ error: 'Only admin/distributor/MD can assign schemes' }, { status: 403 });
    }

    // Input validation
    if (!body.scheme_id || !body.entity_id || !body.entity_role) {
      return NextResponse.json({ error: 'scheme_id, entity_id, and entity_role are required' }, { status: 400 });
    }

    // Validate entity_role value
    if (!['retailer', 'distributor', 'master_distributor'].includes(body.entity_role)) {
      return NextResponse.json({ error: 'Invalid entity_role' }, { status: 400 });
    }

    // Ownership verification: ensure the assigner has authority over the target entity
    if (user.role === 'distributor') {
      // Distributor can only map schemes to their own retailers
      if (body.entity_role !== 'retailer') {
        return NextResponse.json({ error: 'Distributors can only assign schemes to retailers' }, { status: 403 });
      }
      const isOwned = await verifyDistributorOwnsRetailer(user.partner_id, body.entity_id);
      if (!isOwned) {
        return NextResponse.json({ error: 'Access denied: this retailer does not belong to you' }, { status: 403 });
      }
    }

    if (user.role === 'master_distributor') {
      // MD can map to distributors under them or retailers under their distributors
      if (body.entity_role === 'distributor') {
        const isOwned = await verifyMDOwnsDistributor(user.partner_id, body.entity_id);
        if (!isOwned) {
          return NextResponse.json({ error: 'Access denied: this distributor does not belong to you' }, { status: 403 });
        }
      } else if (body.entity_role === 'retailer') {
        // Check if retailer belongs to one of the MD's distributors
        const supabase = getSupabase();
        const { data: retailerData } = await supabase
          .from('retailers')
          .select('distributor_id')
          .eq('partner_id', body.entity_id)
          .maybeSingle();

        if (!retailerData?.distributor_id) {
          return NextResponse.json({ error: 'Retailer not found' }, { status: 404 });
        }

        const isOwned = await verifyMDOwnsDistributor(user.partner_id, retailerData.distributor_id);
        if (!isOwned) {
          return NextResponse.json({ error: 'Access denied: this retailer does not belong to your network' }, { status: 403 });
        }
      } else if (body.entity_role === 'master_distributor') {
        return NextResponse.json({ error: 'MDs cannot assign schemes to other MDs' }, { status: 403 });
      }
    }

    // Verify the scheme exists and the user has access to it
    if (user.role !== 'admin') {
      const supabase = getSupabase();
      const { data: schemeData } = await supabase
        .from('schemes')
        .select('id, created_by_id, scheme_type')
        .eq('id', body.scheme_id)
        .maybeSingle();

      if (!schemeData) {
        return NextResponse.json({ error: 'Scheme not found' }, { status: 404 });
      }

      // Non-admin can only map schemes they created or global/golden schemes
      if (schemeData.scheme_type === 'custom' && schemeData.created_by_id !== user.partner_id) {
        return NextResponse.json({ error: 'Access denied: you can only map schemes you created or global schemes' }, { status: 403 });
      }
    }

    const { data, error } = await createSchemeMapping(body, user.partner_id, user.role);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    const ctx = getRequestContext(request);
    logActivityFromContext(ctx, user, {
      activity_type: 'scheme_mapping_create',
      activity_category: 'scheme',
      reference_table: 'scheme_mappings',
    }).catch(() => {});

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('[API /api/schemes/mappings POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user || !user.partner_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const mappingId = url.searchParams.get('id');

    if (!mappingId) {
      return NextResponse.json({ error: 'Mapping id is required' }, { status: 400 });
    }

    // Retailers cannot delete mappings
    if (user.role === 'retailer') {
      return NextResponse.json({ error: 'Retailers cannot delete scheme mappings' }, { status: 403 });
    }

    // Ownership check: verify the user has authority over this mapping
    if (user.role !== 'admin') {
      const supabase = getSupabase();
      const { data: mapping } = await supabase
        .from('scheme_mappings')
        .select('assigned_by_id, assigned_by_role, entity_id, entity_role')
        .eq('id', mappingId)
        .maybeSingle();

      if (!mapping) {
        return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
      }

      // Only the user who assigned the mapping can delete it
      if (mapping.assigned_by_id !== user.partner_id) {
        return NextResponse.json({ error: 'Access denied: you did not create this mapping' }, { status: 403 });
      }
    }

    const { success } = await deleteSchemeMapping(mappingId);

    if (success) {
      const ctx = getRequestContext(request);
      logActivityFromContext(ctx, user, {
        activity_type: 'scheme_mapping_delete',
        activity_category: 'scheme',
      }).catch(() => {});
    }

    return NextResponse.json({ success });
  } catch (err: any) {
    console.error('[API /api/schemes/mappings DELETE]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
