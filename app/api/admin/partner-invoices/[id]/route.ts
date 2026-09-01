import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/partner-invoices/[id]
 * Returns the invoice header, its settlement log, and (optionally) the
 * underlying transactions when ?include_txns=1.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
    }

    const { id } = await params
    if (!id) return NextResponse.json({ success: false, error: 'Invoice ID required' }, { status: 400 })

    const { data: invoice, error } = await supabaseAdmin
      .from('partner_invoices')
      .select('*, partners(name, business_name, email, phone, gst_number)')
      .eq('id', id)
      .single()
    if (error || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 })
    }

    const { data: settlements } = await supabaseAdmin
      .from('partner_invoice_settlements')
      .select('*')
      .eq('invoice_id', id)
      .order('settled_on', { ascending: false })
      .order('created_at', { ascending: false })

    const partner = (invoice as any).partners || {}
    const header = { ...invoice, partner, partners: undefined }

    let transactions: any[] | undefined
    if (request.nextUrl.searchParams.get('include_txns') === '1') {
      const startISO = new Date(`${invoice.period_start}T00:00:00.000Z`).toISOString()
      const endISO = new Date(`${invoice.period_end}T23:59:59.999Z`).toISOString()
      const { data: txns } = await supabaseAdmin
        .from('razorpay_pos_transactions')
        .select(
          'id, txn_id, tid, amount, gross_amount, partner_mdr_amount, partner_net_amount, ' +
            'payment_mode, card_type, card_brand, display_status, transaction_time'
        )
        .eq('partner_id', invoice.partner_id)
        .gte('transaction_time', startISO)
        .lte('transaction_time', endISO)
        .order('transaction_time', { ascending: false })
        .limit(2000)
      transactions = txns || []
    }

    return NextResponse.json({ success: true, data: { ...header, settlements: settlements || [], transactions } })
  } catch (error: any) {
    console.error('[Partner Invoice GET] Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/partner-invoices/[id]
 * Lifecycle actions: issue, void, or update notes.
 * Body: { action?: 'issue' | 'void', notes?: string }
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
    }

    const { id } = await params
    if (!id) return NextResponse.json({ success: false, error: 'Invoice ID required' }, { status: 400 })

    const body = await request.json()
    const { action, notes } = body

    const { data: invoice, error: fetchErr } = await supabaseAdmin
      .from('partner_invoices')
      .select('id, status, amount_settled')
      .eq('id', id)
      .single()
    if (fetchErr || !invoice) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 })
    }

    const updates: Record<string, any> = {}

    if (action === 'issue') {
      if (invoice.status !== 'draft') {
        return NextResponse.json({ success: false, error: 'Only draft invoices can be issued' }, { status: 400 })
      }
      updates.status = 'issued'
      updates.issued_at = new Date().toISOString()
    } else if (action === 'void') {
      if (Number(invoice.amount_settled) > 0) {
        return NextResponse.json(
          { success: false, error: 'Cannot void an invoice that already has recorded settlements' },
          { status: 400 }
        )
      }
      updates.status = 'void'
    }

    if (typeof notes === 'string') updates.notes = notes

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 })
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('partner_invoices')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (updErr) throw new Error(updErr.message)

    return NextResponse.json({ success: true, data: updated })
  } catch (error: any) {
    console.error('[Partner Invoice PATCH] Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
  }
}
