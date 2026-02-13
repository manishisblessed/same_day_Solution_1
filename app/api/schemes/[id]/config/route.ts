/**
 * API: /api/schemes/[id]/config
 * POST - Add/update BBPS commission, Payout charge, or MDR rate for a scheme
 * DELETE - Remove a specific config entry
 * 
 * Body: { config_type: 'bbps' | 'payout' | 'mdr', ...configData }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth-server-request';
import {
  upsertBBPSCommission,
  upsertPayoutCharge,
  upsertMDRRate,
  deleteBBPSCommission,
  deletePayoutCharge,
  deleteMDRRate,
} from '@/lib/scheme/scheme.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { config_type, ...configData } = body;
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
      default:
        return NextResponse.json({ error: `Invalid config_type: ${config_type}` }, { status: 400 });
    }

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (err: any) {
    console.error('[API /api/schemes/[id]/config POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const configType = url.searchParams.get('config_type');
    const configId = url.searchParams.get('config_id');

    if (!configType || !configId) {
      return NextResponse.json({ error: 'config_type and config_id are required' }, { status: 400 });
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
      default:
        return NextResponse.json({ error: `Invalid config_type: ${configType}` }, { status: 400 });
    }

    return NextResponse.json({ success: result.success });
  } catch (err: any) {
    console.error('[API /api/schemes/[id]/config DELETE]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

