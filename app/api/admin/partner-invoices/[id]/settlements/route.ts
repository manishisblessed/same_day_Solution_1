import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_METHODS = ['bank_transfer', 'wallet_push', 'upi', 'cash', 'adjustment', 'other']

/**
 * POST /api/admin/partner-invoices/[id]/settlements
 * Record a manual settlement the accounts team made against an invoice.
 * Body: { amount, settled_on, method, bank_account?, utr_reference?, note?,
 *         push_to_wallet? }
 *
 * When push_to_wallet is true and method is 'wallet_push', the partner wallet is
 * also credited via credit_partner_wallet and the ledger entry is linked.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
    }

    const { id } = await params
    if (!id) return NextResponse.json({ success: false, error: 'Invoice ID required' }, { status: 400 })

    const body = await request.json()
    const { amount, settled_on, method, bank_account, utr_reference, note, push_to_wallet } = body

    const amountNum = parseFloat(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json({ success: false, error: 'Amount must be a positive number' }, { status: 400 })
    }
    if (!settled_on || isNaN(new Date(settled_on).getTime())) {
      return NextResponse.json({ success: false, error: 'A valid settled_on date is required' }, { status: 400 })
    }
    if (!method || !VALID_METHODS.includes(method)) {
      return NextResponse.json(
        { success: false, error: `method must be one of: ${VALID_METHODS.join(', ')}` },
        { status: 400 }
      )
    }

    const { data: invoice, error: invErr } = await supabaseAdmin
      .from('partner_invoices')
      .select('id, partner_id, status, net_payable, amount_settled, balance_due, invoice_number')
      .eq('id', id)
      .single()
    if (invErr || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 })
    }
    if (invoice.status === 'void') {
      return NextResponse.json({ success: false, error: 'Cannot settle a voided invoice' }, { status: 400 })
    }
    if (invoice.status === 'draft') {
      return NextResponse.json(
        { success: false, error: 'Issue the invoice before recording settlements' },
        { status: 400 }
      )
    }

    const balanceDue = Number(invoice.balance_due) || 0
    if (amountNum > balanceDue + 0.01) {
      return NextResponse.json(
        { success: false, error: `Amount exceeds balance due (₹${balanceDue.toFixed(2)})` },
        { status: 400 }
      )
    }

    let referenceType: string | null = null
    let referenceId: string | null = null

    // Optional: actually credit the partner wallet in-system
    if (push_to_wallet && method === 'wallet_push') {
      const { data: ledgerId, error: creditErr } = await supabaseAdmin.rpc('credit_partner_wallet', {
        p_partner_id: invoice.partner_id,
        p_amount: amountNum,
        p_description: `Invoice ${invoice.invoice_number} settlement by ${user.email}`,
        p_reference_id: `INV_SETTLE_${invoice.invoice_number}_${Date.now()}`,
        p_transaction_type: 'CREDIT',
        p_service_type: 'partner_invoice',
      })
      if (creditErr) {
        return NextResponse.json(
          { success: false, error: `Wallet credit failed: ${creditErr.message}` },
          { status: 500 }
        )
      }
      referenceType = 'partner_wallet_ledger'
      referenceId = ledgerId ? String(ledgerId) : null
    }

    const { data: settlement, error: insErr } = await supabaseAdmin
      .from('partner_invoice_settlements')
      .insert({
        invoice_id: id,
        amount: amountNum,
        settled_on,
        method,
        bank_account: bank_account || null,
        utr_reference: utr_reference || null,
        note: note || null,
        reference_type: referenceType,
        reference_id: referenceId,
        recorded_by: user.email,
      })
      .select()
      .single()
    if (insErr) throw new Error(insErr.message)

    // Rollup is maintained by DB trigger; re-read the fresh header
    const { data: freshInvoice } = await supabaseAdmin
      .from('partner_invoices')
      .select('id, status, amount_settled, balance_due')
      .eq('id', id)
      .single()

    return NextResponse.json({ success: true, data: settlement, invoice: freshInvoice })
  } catch (error: any) {
    console.error('[Partner Invoice Settlement POST] Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/partner-invoices/[id]/settlements?settlement_id=xxx
 * Remove a settlement entry (correction). Rollup recomputes via trigger.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
    }

    const { id } = await params
    const settlementId = request.nextUrl.searchParams.get('settlement_id')
    if (!id || !settlementId) {
      return NextResponse.json({ success: false, error: 'Invoice ID and settlement_id are required' }, { status: 400 })
    }

    const { data: settlement } = await supabaseAdmin
      .from('partner_invoice_settlements')
      .select('id, reference_type')
      .eq('id', settlementId)
      .eq('invoice_id', id)
      .maybeSingle()
    if (!settlement) {
      return NextResponse.json({ success: false, error: 'Settlement not found' }, { status: 404 })
    }
    if (settlement.reference_type === 'partner_wallet_ledger') {
      return NextResponse.json(
        { success: false, error: 'This settlement credited the partner wallet in-system and cannot be deleted here. Reverse it via the wallet instead.' },
        { status: 400 }
      )
    }

    const { error: delErr } = await supabaseAdmin
      .from('partner_invoice_settlements')
      .delete()
      .eq('id', settlementId)
      .eq('invoice_id', id)
    if (delErr) throw new Error(delErr.message)

    const { data: freshInvoice } = await supabaseAdmin
      .from('partner_invoices')
      .select('id, status, amount_settled, balance_due')
      .eq('id', id)
      .single()

    return NextResponse.json({ success: true, invoice: freshInvoice })
  } catch (error: any) {
    console.error('[Partner Invoice Settlement DELETE] Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
  }
}
