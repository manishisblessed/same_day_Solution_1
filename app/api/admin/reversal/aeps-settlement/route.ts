/**
 * POST /api/admin/reversal/aeps-settlement
 *
 * Admin reversal for failed/stuck AEPS settlement-to-bank transactions.
 * Credits the AEPS wallet (not primary) and reverses any margin credits.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Reversal AEPS Settlement] Auth:', method, '|', admin?.email || 'none')

    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { settlement_id, reason, remarks } = body

    if (!settlement_id || !reason) {
      return NextResponse.json({ error: 'settlement_id and reason are required' }, { status: 400 })
    }

    const ipAddress = request.headers.get('x-forwarded-for') ||
                      request.headers.get('x-real-ip') ||
                      'unknown'

    // Fetch the AEPS settlement
    const { data: settlement, error: settlementError } = await supabase
      .from('aeps_settlements')
      .select('id, user_id, user_role, amount, charge, ledger_entry_id, status, charge_breakdown')
      .eq('id', settlement_id)
      .single()

    if (settlementError || !settlement) {
      return NextResponse.json({ error: 'AEPS settlement not found' }, { status: 404 })
    }

    if (['reversed', 'failed', 'success'].includes(settlement.status)) {
      return NextResponse.json(
        { error: `Cannot reverse settlement with status: ${settlement.status}` },
        { status: 400 }
      )
    }

    const userId = settlement.user_id
    const userRole = settlement.user_role || 'retailer'
    const amount = parseFloat(String(settlement.amount))
    const charge = parseFloat(String(settlement.charge || 0))
    const totalDebit = amount + charge

    // Check if already refunded (idempotency)
    const refRefId = `AEPS_SETTLE_REFUND_${settlement_id}`
    const { data: existingRefund } = await supabase
      .from('wallet_ledger')
      .select('id')
      .eq('reference_id', refRefId)
      .maybeSingle()

    if (existingRefund) {
      return NextResponse.json({ error: 'This settlement has already been refunded' }, { status: 400 })
    }

    // Get before balance
    const { data: beforeBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: userId,
      p_wallet_type: 'aeps',
    })

    // Create reversal record
    const { data: reversal, error: reversalError } = await supabase
      .from('reversals')
      .insert({
        original_transaction_id: settlement_id,
        transaction_type: 'aeps_settlement',
        user_id: userId,
        user_role: userRole,
        original_amount: totalDebit,
        reversal_amount: totalDebit,
        reason,
        status: 'processing',
        original_ledger_id: settlement.ledger_entry_id,
        admin_id: admin.id,
        ip_address: ipAddress,
        remarks: remarks || `AEPS settlement reversal - ${reason}`,
      })
      .select()
      .single()

    if (reversalError || !reversal) {
      console.error('[Reversal AEPS Settlement] Error creating reversal:', reversalError)
      return NextResponse.json({ error: 'Failed to create reversal' }, { status: 500 })
    }

    // Mark original debit ledger entry as failed
    if (settlement.ledger_entry_id) {
      await supabase
        .from('wallet_ledger')
        .update({ status: 'failed' })
        .eq('id', settlement.ledger_entry_id)
    }

    // Credit AEPS wallet
    const { data: reversalLedgerId, error: ledgerError } = await supabase.rpc('add_ledger_entry', {
      p_user_id: userId,
      p_user_role: userRole,
      p_wallet_type: 'aeps',
      p_fund_category: 'settlement',
      p_service_type: 'aeps',
      p_tx_type: 'REFUND',
      p_credit: totalDebit,
      p_debit: 0,
      p_reference_id: refRefId,
      p_transaction_id: reversal.id,
      p_status: 'completed',
      p_remarks: `AEPS settlement admin reversal - ${reason} - ${remarks || ''}`,
    })

    if (ledgerError) {
      console.error('[Reversal AEPS Settlement] Ledger error:', ledgerError)
      await supabase
        .from('reversals')
        .update({ status: 'failed' })
        .eq('id', reversal.id)
      return NextResponse.json({ error: 'Failed to credit AEPS wallet' }, { status: 500 })
    }

    // Reverse margin credits (DT, MD, company revenue)
    const marginRefs = [
      { ref: `AEPS_SETTLE_MARGIN_DT_${settlement_id}`, label: 'DT margin' },
      { ref: `AEPS_SETTLE_MARGIN_MD_${settlement_id}`, label: 'MD margin' },
      { ref: `AEPS_SETTLE_REVENUE_${settlement_id}`, label: 'Company revenue' },
    ]

    const marginsReversed: string[] = []

    for (const m of marginRefs) {
      const { data: entry } = await supabase
        .from('wallet_ledger')
        .select('id, user_id, user_role, credit')
        .eq('reference_id', m.ref)
        .eq('status', 'completed')
        .maybeSingle()

      if (!entry || !entry.credit || entry.credit <= 0) continue

      const reversalRef = `${m.ref}_REVERSAL`
      const { data: alreadyReversed } = await supabase
        .from('wallet_ledger')
        .select('id')
        .eq('reference_id', reversalRef)
        .maybeSingle()

      if (alreadyReversed) continue

      const txType = m.ref.includes('REVENUE') ? 'COMPANY_REVENUE_REVERSAL' : 'MARGIN_REVERSAL'

      const { error: mErr } = await supabase.rpc('add_ledger_entry', {
        p_user_id: entry.user_id,
        p_user_role: entry.user_role,
        p_wallet_type: 'primary',
        p_fund_category: m.ref.includes('REVENUE') ? 'revenue' : 'commission',
        p_service_type: 'aeps',
        p_tx_type: txType,
        p_credit: 0,
        p_debit: entry.credit,
        p_reference_id: reversalRef,
        p_transaction_id: settlement_id,
        p_status: 'completed',
        p_remarks: `AEPS settlement admin reversal - ${m.label} reversed`,
      })

      if (!mErr) marginsReversed.push(`${m.label}: ₹${entry.credit}`)
    }

    // Get after balance
    const { data: afterBalance } = await supabase.rpc('get_wallet_balance_v2', {
      p_user_id: userId,
      p_wallet_type: 'aeps',
    })

    // Update reversal record
    await supabase
      .from('reversals')
      .update({
        reversal_ledger_id: reversalLedgerId,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', reversal.id)

    // Update AEPS settlement status
    await supabase
      .from('aeps_settlements')
      .update({
        status: 'reversed',
        failure_reason: `Admin reversal: ${reason}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', settlement_id)

    // Audit log
    await supabase
      .from('admin_audit_log')
      .insert({
        admin_id: admin.id,
        action_type: 'aeps_settlement_reversal',
        target_user_id: userId,
        target_user_role: userRole,
        wallet_type: 'aeps',
        amount: totalDebit,
        before_balance: beforeBalance || 0,
        after_balance: afterBalance || 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: `AEPS settlement reversal - Reason: ${reason}`,
        metadata: {
          settlement_id,
          transaction_type: 'aeps_settlement',
          reversal_id: reversal.id,
          margins_reversed: marginsReversed,
        },
      })
      .then(({ error }) => {
        if (error) console.error('[Reversal AEPS Settlement] Audit log error:', error)
      })

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, admin, {
      activity_type: 'admin_reversal_aeps_settlement',
      activity_category: 'admin',
      reference_table: 'aeps_settlements',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: 'AEPS settlement reversed successfully',
      reversal_id: reversal.id,
      amount: totalDebit,
      before_balance: beforeBalance || 0,
      after_balance: afterBalance || 0,
      margins_reversed: marginsReversed,
    })
  } catch (error: any) {
    console.error('[Reversal AEPS Settlement] Error:', error)
    return NextResponse.json({ error: 'Failed to reverse AEPS settlement' }, { status: 500 })
  }
}
