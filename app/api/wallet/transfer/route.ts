/**
 * API: POST /api/wallet/transfer
 * 
 * Transfer funds between wallets (AEPS → Primary).
 * Instant, no admin approval required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUserWithFallback } from '@/lib/auth-server';
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  reserveIdempotencyKey,
  finalizeIdempotencyKey,
  getIdempotencyKeyFromHeaders,
} from '@/lib/security/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rl = rateLimit(request, RATE_LIMITS.transfer);
  if (rl.limited) return rl.response!;

  const idemKey = getIdempotencyKeyFromHeaders(request.headers);
  const IDEM_SCOPE = 'wallet_transfer';

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Database configuration missing' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { user } = await getCurrentUserWithFallback(request);
    if (!user || !user.partner_id) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 });
    }

    if (!['retailer', 'distributor', 'master_distributor'].includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden: Invalid user role' }, { status: 403 });
    }

    const body = await request.json();
    const { amount, source_wallet = 'aeps', target_wallet = 'primary' } = body;

    if (!amount) {
      return NextResponse.json({ error: 'amount is required' }, { status: 400 });
    }

    const amountDecimal = parseFloat(amount);
    if (!Number.isFinite(amountDecimal) || amountDecimal <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    if (amountDecimal > 10000000) {
      return NextResponse.json({ error: 'Amount exceeds maximum limit of ₹1,00,00,000' }, { status: 400 });
    }

    // Only AEPS → Primary is supported
    if (source_wallet !== 'aeps' || target_wallet !== 'primary') {
      return NextResponse.json({ error: 'Only AEPS → Primary wallet transfer is supported' }, { status: 400 });
    }

    // Check source wallet frozen status
    const { data: srcWallet } = await supabase
      .from('wallets')
      .select('is_frozen')
      .eq('user_id', user.partner_id)
      .eq('wallet_type', 'aeps')
      .maybeSingle();

    if (srcWallet?.is_frozen) {
      return NextResponse.json({ error: 'AEPS wallet is frozen. Cannot transfer.' }, { status: 403 });
    }

    // Check AEPS wallet balance
    const { data: aepsBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: user.partner_id,
      p_wallet_type: 'aeps',
    });

    if ((aepsBalance || 0) < amountDecimal) {
      return NextResponse.json({
        error: 'Insufficient AEPS wallet balance',
        available_balance: aepsBalance || 0,
        requested_amount: amountDecimal,
      }, { status: 400 });
    }

    // Idempotency: dedup repeated submits of the same transfer
    if (idemKey) {
      const reservation = await reserveIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, userId: user.partner_id });
      if (!reservation.fresh) {
        if (reservation.status === 'completed' && reservation.cachedResponse) {
          return NextResponse.json(reservation.cachedResponse);
        }
        return NextResponse.json(
          { error: 'A transfer with this idempotency key is already being processed.', code: 'IDEMPOTENT_REPLAY' },
          { status: 409 }
        );
      }
    }

    const transferRef = `WALLET_TRANSFER_${user.partner_id}_${Date.now()}`;

    // Debit AEPS wallet
    const { data: debitLedgerId, error: debitErr } = await supabase.rpc('add_ledger_entry', {
      p_user_id: user.partner_id,
      p_user_role: user.role,
      p_wallet_type: 'aeps',
      p_fund_category: 'adjustment',
      p_service_type: 'aeps',
      p_tx_type: 'TRANSFER_OUT',
      p_credit: 0,
      p_debit: amountDecimal,
      p_reference_id: `${transferRef}_OUT`,
      p_status: 'completed',
      p_remarks: `Transfer to Primary Wallet - ₹${amountDecimal}`,
    });

    if (debitErr) {
      console.error('[Wallet Transfer] AEPS debit failed:', debitErr);
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' });
      return NextResponse.json({ error: 'Failed to debit AEPS wallet' }, { status: 500 });
    }

    // Credit Primary wallet
    const { data: creditLedgerId, error: creditErr } = await supabase.rpc('add_ledger_entry', {
      p_user_id: user.partner_id,
      p_user_role: user.role,
      p_wallet_type: 'primary',
      p_fund_category: 'adjustment',
      p_service_type: 'aeps',
      p_tx_type: 'TRANSFER_IN',
      p_credit: amountDecimal,
      p_debit: 0,
      p_reference_id: `${transferRef}_IN`,
      p_status: 'completed',
      p_remarks: `Transfer from AEPS Wallet - ₹${amountDecimal}`,
    });

    if (creditErr) {
      console.error('[Wallet Transfer] Primary credit failed, reversing AEPS debit:', creditErr);
      // Reverse the AEPS debit
      await supabase.rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_wallet_type: 'aeps',
        p_fund_category: 'adjustment',
        p_service_type: 'aeps',
        p_tx_type: 'TRANSFER_REVERSAL',
        p_credit: amountDecimal,
        p_debit: 0,
        p_reference_id: `${transferRef}_REVERSAL`,
        p_status: 'completed',
        p_remarks: `Transfer reversal - Primary wallet credit failed`,
      });
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' });
      return NextResponse.json({ error: 'Failed to credit Primary wallet. AEPS wallet refunded.' }, { status: 500 });
    }

    // Record the transfer
    await supabase.from('wallet_transfers').insert({
      user_id: user.partner_id,
      user_role: user.role,
      source_wallet: 'aeps',
      target_wallet: 'primary',
      amount: amountDecimal,
      source_ledger_id: debitLedgerId,
      target_ledger_id: creditLedgerId,
      status: 'completed',
      remarks: `AEPS → Primary: ₹${amountDecimal}`,
    });

    // Get updated balances
    const [{ data: newAepsBalance }, { data: newPrimaryBalance }] = await Promise.all([
      supabase.rpc('get_wallet_balance_v2', { p_user_id: user.partner_id, p_wallet_type: 'aeps' }),
      supabase.rpc('get_wallet_balance_v2', { p_user_id: user.partner_id, p_wallet_type: 'primary' }),
    ]);

    const ctx = getRequestContext(request);
    logActivityFromContext(ctx, user, {
      activity_type: 'wallet_transfer',
      activity_category: 'wallet',
      activity_description: `AEPS → Primary transfer: ₹${amountDecimal}`,
      metadata: { amount: amountDecimal, source: 'aeps', target: 'primary' },
    }).catch(() => {});

    const successPayload = {
      success: true,
      amount: amountDecimal,
      source_wallet: 'aeps',
      target_wallet: 'primary',
      aeps_balance: newAepsBalance || 0,
      primary_balance: newPrimaryBalance || 0,
      message: `₹${amountDecimal.toLocaleString('en-IN')} transferred from AEPS to Primary wallet`,
    };
    if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'completed', response: successPayload });
    return NextResponse.json(successPayload);
  } catch (error: any) {
    console.error('[Wallet Transfer] Error:', error);
    if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {});
    return NextResponse.json({ error: error.message || 'Transfer failed' }, { status: 500 });
  }
}
