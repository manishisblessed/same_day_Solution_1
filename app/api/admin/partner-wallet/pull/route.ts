import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * POST /api/admin/partner-wallet/pull
 *
 * Admin debits a partner's wallet (same flow as push, opposite direction).
 * Body: { partner_id, amount, remarks? }
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
    }

    if (user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { partner_id, amount, remarks } = body

    if (!partner_id) {
      return NextResponse.json(
        { success: false, error: 'partner_id is required' },
        { status: 400 }
      )
    }

    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { success: false, error: 'Amount must be a positive number' },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    const { data: partner, error: partnerErr } = await supabase
      .from('partners')
      .select('id, name, status')
      .eq('id', partner_id)
      .single()

    if (partnerErr || !partner) {
      return NextResponse.json(
        { success: false, error: 'Partner not found' },
        { status: 404 }
      )
    }

    const { data: balanceBefore } = await supabase.rpc('get_partner_wallet_balance', {
      p_partner_id: partner_id,
    })

    const { data: ledgerId, error: debitErr } = await supabase.rpc('debit_partner_wallet', {
      p_partner_id: partner_id,
      p_amount: amountNum,
      p_payout_transaction_id: null,
      p_description: remarks || `Admin debit by ${user.email}`,
      p_reference_id: `ADMIN_PULL_${Date.now()}`,
    })

    if (debitErr) {
      console.error('[Partner Wallet Pull] Debit error:', debitErr)
      return NextResponse.json(
        { success: false, error: debitErr.message || 'Failed to debit wallet' },
        { status: 400 }
      )
    }

    const { data: balanceAfter } = await supabase.rpc('get_partner_wallet_balance', {
      p_partner_id: partner_id,
    })

    try {
      await supabase.from('admin_audit_log').insert({
        admin_id: user.id,
        admin_email: user.email,
        action: 'partner_wallet_pull',
        target_type: 'partner',
        target_id: partner_id,
        details: {
          partner_name: partner.name,
          amount: amountNum,
          balance_before: balanceBefore || 0,
          balance_after: balanceAfter,
          remarks,
        },
      })
    } catch {
      // ignore audit log errors
    }

    return NextResponse.json({
      success: true,
      message: `₹${amountNum.toFixed(2)} debited from ${partner.name}'s wallet`,
      data: {
        partner_id,
        partner_name: partner.name,
        amount: amountNum,
        balance_before: balanceBefore || 0,
        balance_after: balanceAfter,
        ledger_entry_id: ledgerId,
      },
    })
  } catch (error: any) {
    console.error('[Partner Wallet Pull] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
