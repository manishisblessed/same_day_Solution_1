/**
 * API: /api/schemes/[id]/config
 * POST - Add/update config (BBPS, Payout, MDR, AEPS, AEPS Settlement, Shadval Settlement)
 * DELETE - Remove a specific config entry
 * 
 * All scheme config writes MUST go through this route for:
 *  - Role-based authorization
 *  - Audit logging
 *  - Server-side validation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import {
  getSchemeById,
  upsertBBPSCommission,
  upsertPayoutCharge,
  upsertMDRRate,
  upsertAEPSCommission,
  upsertAEPSSettlementCharge,
  upsertShadvalSettlementCharge,
  deleteBBPSCommission,
  deletePayoutCharge,
  deleteMDRRate,
  deleteAEPSCommission,
  deleteAEPSSettlementCharge,
  deleteShadvalSettlementCharge,
} from '@/lib/scheme/scheme.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLE_TO_CONFIG_TYPE: Record<string, string> = {
  scheme_bbps_commissions: 'bbps',
  scheme_payout_charges: 'payout',
  scheme_mdr_rates: 'mdr',
  scheme_aeps_commissions: 'aeps',
  scheme_aeps_settlement_charges: 'aeps_settlement',
  scheme_shadval_settlement_charges: 'shadval_settlement',
};

const VALID_CONFIG_TYPES = ['bbps', 'payout', 'mdr', 'aeps', 'aeps_settlement', 'shadval_settlement'];

const ALLOWED_ROLES = ['admin', 'master_distributor', 'distributor'];

async function authorizeSchemeAccess(user: any, schemeId: string): Promise<string | null> {
  if (!ALLOWED_ROLES.includes(user.role)) {
    return 'Your role does not have permission to modify scheme configurations';
  }

  const { data: scheme } = await getSchemeById(schemeId);
  if (!scheme) {
    return 'Scheme not found';
  }

  if (user.role === 'admin') return null;

  if (scheme.scheme_type === 'global' || scheme.scheme_type === 'golden') {
    return 'Only admin can modify global/golden scheme configurations';
  }

  if (scheme.created_by_id && scheme.created_by_id !== user.partner_id) {
    return 'You can only modify configurations for schemes you created or were assigned';
  }

  return null;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user } = await getCurrentUserWithFallback(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authError = await authorizeSchemeAccess(user, params.id);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 403 });
    }

    const body = await request.json();
    let { config_type, ...configData } = body;

    // Support legacy table-name based config_type from old clients
    if (config_type && TABLE_TO_CONFIG_TYPE[config_type]) {
      config_type = TABLE_TO_CONFIG_TYPE[config_type];
    }

    if (!VALID_CONFIG_TYPES.includes(config_type)) {
      return NextResponse.json({ error: `Invalid config_type: ${config_type}` }, { status: 400 });
    }

    configData.scheme_id = params.id;

    let result: { data: any; error: string | null };

    switch (config_type) {
      case 'bbps':
        result = await upsertBBPSCommission(configData);
        break;
      case 'payout':
        result = await upsertPayoutCharge(configData);
        break;
      case 'mdr':
        result = await upsertMDRRate(configData);
        break;
      case 'aeps':
        result = await upsertAEPSCommission(configData);
        break;
      case 'aeps_settlement':
        result = await upsertAEPSSettlementCharge(configData);
        break;
      case 'shadval_settlement':
        result = await upsertShadvalSettlementCharge(configData);
        break;
      default:
        return NextResponse.json({ error: `Invalid config_type: ${config_type}` }, { status: 400 });
    }

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const ctx = getRequestContext(request);
    logActivityFromContext(ctx, user, {
      activity_type: 'scheme_config_add',
      activity_category: 'scheme',
      activity_description: `Added ${config_type} config to scheme ${params.id}`,
      reference_id: result.data?.id,
      reference_table: `scheme_${config_type}_config`,
      metadata: { config_type, scheme_id: params.id },
    }).catch(() => {});

    return NextResponse.json({ success: true, data: result.data });
  } catch (err: any) {
    console.error('[API /api/schemes/[id]/config POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user } = await getCurrentUserWithFallback(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authError = await authorizeSchemeAccess(user, params.id);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 403 });
    }

    const url = new URL(request.url);
    let configType = url.searchParams.get('config_type');
    const configId = url.searchParams.get('config_id');

    if (!configType || !configId) {
      return NextResponse.json({ error: 'config_type and config_id are required' }, { status: 400 });
    }

    // Support legacy table-name based config_type
    if (TABLE_TO_CONFIG_TYPE[configType]) {
      configType = TABLE_TO_CONFIG_TYPE[configType];
    }

    if (!VALID_CONFIG_TYPES.includes(configType)) {
      return NextResponse.json({ error: `Invalid config_type: ${configType}` }, { status: 400 });
    }

    let result: { success: boolean };

    switch (configType) {
      case 'bbps':
        result = await deleteBBPSCommission(configId);
        break;
      case 'payout':
        result = await deletePayoutCharge(configId);
        break;
      case 'mdr':
        result = await deleteMDRRate(configId);
        break;
      case 'aeps':
        result = await deleteAEPSCommission(configId);
        break;
      case 'aeps_settlement':
        result = await deleteAEPSSettlementCharge(configId);
        break;
      case 'shadval_settlement':
        result = await deleteShadvalSettlementCharge(configId);
        break;
      default:
        return NextResponse.json({ error: `Invalid config_type: ${configType}` }, { status: 400 });
    }

    const ctx = getRequestContext(request);
    logActivityFromContext(ctx, user, {
      activity_type: 'scheme_config_delete',
      activity_category: 'scheme',
      activity_description: `Deleted ${configType} config ${configId} from scheme ${params.id}`,
      reference_id: configId,
      reference_table: `scheme_${configType}_config`,
      metadata: { config_type: configType, config_id: configId, scheme_id: params.id },
    }).catch(() => {});

    return NextResponse.json({ success: result.success });
  } catch (err: any) {
    console.error('[API /api/schemes/[id]/config DELETE]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
