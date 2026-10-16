import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { checkCompanyComplete, type CompanyConfig, type Receiver } from '@/lib/ca/company-invoice'
import { buildTaxInvoicesPdf } from '@/lib/ca/invoice-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireCA(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) return { error: 'Session expired. Please login again.', status: 401 as const }
  if (user.role !== 'ca_executive' && user.role !== 'admin') {
    return { error: 'CA access required', status: 403 as const }
  }
  return { user }
}

/** GET /api/ca/reimbursement/[id]/invoice — single Tax Invoice PDF. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const supabase = getSupabaseAdmin()

    const { data: r, error } = await supabase
      .from('ca_reimbursement_invoices')
      .select(`*,
        brands:brand_id ( id, key, name, short_name ),
        partners:partner_id ( id, name, business_name, gst_number, pan_number, address, city, state, pincode, email, phone )
      `)
      .eq('id', id)
      .single()
    if (error || !r) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    const { data: cfg } = await supabase
      .from('ca_company_config')
      .select('*, brands:brand_id ( id, key, name, short_name )')
      .eq('brand_id', r.brand_id)
      .single()

    const { complete, missing } = checkCompanyComplete(cfg as CompanyConfig)
    if (!complete) {
      const name = (cfg as any)?.brands?.name || r.brands?.name || 'this company'
      return NextResponse.json(
        { error: `Complete the Company Details for ${name} before generating invoices. Missing: ${missing.join(', ')}` },
        { status: 400 },
      )
    }

    const receiver: Receiver = {
      name: r.partners?.business_name || r.partners?.name,
      address: [r.partners?.address, r.partners?.city, r.partners?.state, r.partners?.pincode].filter(Boolean).join(', '),
      gstin: r.partners?.gst_number,
      pan: r.partners?.pan_number,
      email: r.partners?.email,
      phone: r.partners?.phone,
      state: r.partners?.state,
    }

    const pdf = buildTaxInvoicesPdf([{
      company: cfg as CompanyConfig,
      receiver,
      inv: {
        invoiceNumber: r.invoice_number,
        date: r.transaction_date,
        taxableValue: Number(r.transaction_amount || 0),
        gstPercent: Number((cfg as any)?.gst_percent ?? 18),
        kind: 'Reimbursement Invoice',
      },
    }])
    const safe = String(r.invoice_number || 'invoice').replace(/[^\w.-]+/g, '_')

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safe}.pdf"`,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
