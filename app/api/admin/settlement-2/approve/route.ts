import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { initiateBankTransfer } from '@/services/shadval-pay'
import type { ShadvalTransferRequest } from '@/services/shadval-pay'
import { distributeServiceCommission, reverseServiceCommission } from '@/lib/commission/distribute-service-commission'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

/**
 * POST /api/admin/settlement-2/approve
 * Admin approves or rejects a distributor's settlement-2 request.
 *
 * Body: { transaction_id, action: 'approve' | 'reject' }
 *
 * approve → initiates Shadval Pay transfer, distributes commission
 * reject  → refunds wallet, sets status REJECTED
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { transaction_id, action } = body

    if (!transaction_id || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ success: false, error: 'transaction_id and action (approve/reject) required' }, { status: 400 })
    }

    // Fetch the transaction — must be AWAITING_APPROVAL
    const { data: txRecord, error: fetchErr } = await supabaseAdmin
      .from('shadval_settlement')
      .select('*')
      .eq('id', transaction_id)
      .eq('status', 'AWAITING_APPROVAL')
      .maybeSingle()

    if (fetchErr || !txRecord) {
      return NextResponse.json({ success: false, error: 'Transaction not found or not awaiting approval' }, { status: 404 })
    }

    // ── REJECT ──
    if (action === 'reject') {
      // Refund wallet
      const totalDebit = parseFloat(String(txRecord.actual_wallet_debit || txRecord.total_debit))
      const userRole = txRecord.user_role || 'retailer'

      const { error: refundErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: txRecord.retailer_id,
        p_user_role: userRole,
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'shadval_settlement',
        p_tx_type: 'SETTLEMENT2_REFUND',
        p_credit: totalDebit,
        p_debit: 0,
        p_reference_id: `REJECT_${txRecord.reference_id}`,
        p_transaction_id: txRecord.id,
        p_status: 'completed',
        p_remarks: `Settlement-2 rejected by admin. ₹${totalDebit.toFixed(2)} refunded.`,
      })

      if (refundErr) {
        console.error('[Admin Settlement-2] CRITICAL refund failed on reject:', refundErr)
        return NextResponse.json({ success: false, error: 'Refund failed. Please try again.' }, { status: 500 })
      }

      await supabaseAdmin
        .from('shadval_settlement')
        .update({ status: 'REJECTED', status_message: `Rejected by admin (${user.email})` })
        .eq('id', txRecord.id)

      return NextResponse.json({ success: true, status: 'REJECTED', message: 'Settlement rejected and wallet refunded.' })
    }

    // ── APPROVE ──
    // Distribute commission
    const charges = parseFloat(String(txRecord.charges || 0))
    if (charges > 0) {
      let mdId: string | null = null
      try {
        const { data: distData } = await supabaseAdmin
          .from('distributors')
          .select('master_distributor_id')
          .eq('partner_id', txRecord.retailer_id)
          .maybeSingle()
        mdId = distData?.master_distributor_id || null
      } catch {}

      const commResult = await distributeServiceCommission({
        supabase: supabaseAdmin,
        service: 'shadval_settlement',
        refPrefix: 'SHADVAL',
        refKey: txRecord.reference_id,
        transactionUuid: txRecord.id,
        totalCharge: charges,
        retailer: { id: txRecord.retailer_id, role: txRecord.user_role || 'distributor', commission: 0 },
        distributor: { id: txRecord.retailer_id, commission: parseFloat(String(txRecord.distributor_commission || 0)) },
        masterDistributor: { id: mdId },
        remarksSuffix: `on ₹${txRecord.amount} transfer`,
        auditWriteback: {
          table: 'shadval_settlement',
          txnId: txRecord.id,
          distributorCol: 'distributor_commission',
          mdCol: 'md_margin_earned',
          companyCol: 'company_earning',
        },
      })
      if (commResult.errors.length) console.error('[Admin Settlement-2] Commission errors:', commResult.errors)
    }

    // Initiate Shadval Pay transfer
    const contactMobile = txRecord.contact_mobile || ''
    if (!contactMobile) {
      return NextResponse.json({ success: false, error: 'Mobile number missing on transaction record.' }, { status: 400 })
    }

    const transferRequest: ShadvalTransferRequest = {
      amount: parseFloat(String(txRecord.amount)),
      mode: txRecord.mode as 'IMPS' | 'RTGS',
      fund_account: {
        name: txRecord.account_holder_name,
        ifsc: txRecord.ifsc_code,
        account_number: txRecord.account_number,
      },
      contact_details: {
        name: txRecord.contact_name || txRecord.account_holder_name,
        email: txRecord.contact_email || '',
        mobile: contactMobile,
      },
      reference_id: txRecord.reference_id,
      latitude: '28.6139',
      longitude: '77.2090',
      narration: txRecord.narration || 'Settlement-2 Transfer',
    }

    console.log('[Admin Settlement-2] Approving transfer:', {
      ref: txRecord.reference_id,
      amount: txRecord.amount,
      admin: user.email,
    })

    const apiResult = await initiateBankTransfer(transferRequest)
    const isSuccess = apiResult.status === 'SUCCESS'
    const isFailed = apiResult.status === 'FAILED'

    // Provider failed → refund wallet + reverse commission
    if (isFailed) {
      const totalDebit = parseFloat(String(txRecord.actual_wallet_debit || txRecord.total_debit))
      const { error: refundErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: txRecord.retailer_id,
        p_user_role: txRecord.user_role || 'distributor',
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'shadval_settlement',
        p_tx_type: 'SETTLEMENT2_REFUND',
        p_credit: totalDebit,
        p_debit: 0,
        p_reference_id: `REFUND_${txRecord.reference_id}`,
        p_transaction_id: txRecord.id,
        p_status: 'completed',
        p_remarks: `Settlement-2 refund ₹${totalDebit.toFixed(2)} — provider transfer failed: ${apiResult.message || ''}`,
      })
      if (refundErr) console.error('[Admin Settlement-2] CRITICAL refund failed:', refundErr)

      if (charges > 0) {
        await reverseServiceCommission({
          supabase: supabaseAdmin,
          service: 'shadval_settlement',
          refPrefix: 'SHADVAL',
          refKey: txRecord.reference_id,
          transactionUuid: txRecord.id,
        })
      }
    }

    await supabaseAdmin
      .from('shadval_settlement')
      .update({
        status: isSuccess ? 'SUCCESS' : isFailed ? 'FAILED' : 'PENDING',
        status_message: isFailed
          ? `${apiResult.message || 'Transfer failed'} [Wallet refunded]`
          : `Approved by admin (${user.email}). ${apiResult.message || ''}`,
        order_id: apiResult.data?.order_id || null,
        internal_ref_id: apiResult.data?.internal_ref_id || null,
        utr: apiResult.data?.utr || null,
        provider_timestamp: apiResult.data?.timestamp || null,
      })
      .eq('id', txRecord.id)

    return NextResponse.json({
      success: true,
      status: isSuccess ? 'SUCCESS' : isFailed ? 'FAILED' : 'PENDING',
      utr: apiResult.data?.utr || null,
      message: isSuccess
        ? 'Transfer approved and processed successfully.'
        : isFailed
        ? 'Transfer approved but provider failed. Wallet refunded.'
        : 'Transfer approved and processing.',
    })
  } catch (error: any) {
    console.error('[Admin Settlement-2 Approve] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

/**
 * GET /api/admin/settlement-2/approve
 * List all settlement-2 requests awaiting approval.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status') || 'AWAITING_APPROVAL'

    let query = supabaseAdmin
      .from('shadval_settlement')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ success: false, error: 'Failed to fetch' }, { status: 500 })
    }

    // Enrich with user names
    const userIds = [...new Set((data || []).map(t => t.retailer_id))]
    let usersMap: Record<string, any> = {}
    if (userIds.length > 0) {
      const { data: distributors } = await supabaseAdmin
        .from('distributors')
        .select('partner_id, name, phone, email')
        .in('partner_id', userIds)
      for (const d of distributors || []) {
        usersMap[d.partner_id] = d
      }
    }

    const enriched = (data || []).map(t => ({
      ...t,
      user_name: usersMap[t.retailer_id]?.name || null,
      user_phone: usersMap[t.retailer_id]?.phone || null,
      user_email: usersMap[t.retailer_id]?.email || null,
    }))

    return NextResponse.json({ success: true, transactions: enriched })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
