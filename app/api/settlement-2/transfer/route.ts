import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { initiateBankTransfer } from '@/services/shadval-pay'
import type { ShadvalTransferRequest } from '@/services/shadval-pay'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/settlement-2/transfer
 * Process settlement via a verified account.
 *
 * Payment goes from Shadval Pay wallet (provider).
 * Charges are debited from retailer's wallet and credited to company revenue.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user || user.role !== 'retailer') {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { account_id, amount, mode = 'IMPS', narration } = body

    if (!account_id || !amount) {
      const response = NextResponse.json(
        { success: false, error: 'account_id and amount are required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      const response = NextResponse.json({ success: false, error: 'Invalid amount' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    const validModes = ['IMPS', 'NEFT', 'RTGS']
    if (!validModes.includes(mode)) {
      const response = NextResponse.json({ success: false, error: 'Invalid transfer mode' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    // Fetch verified account
    const { data: account, error: acctError } = await supabaseAdmin
      .from('shadval_settlement_accounts')
      .select('*')
      .eq('id', account_id)
      .eq('retailer_id', user.partner_id)
      .eq('is_verified', true)
      .eq('is_active', true)
      .maybeSingle()

    if (acctError || !account) {
      const response = NextResponse.json(
        { success: false, error: 'Verified account not found' },
        { status: 404 }
      )
      return addCorsHeaders(request, response)
    }

    // Resolve scheme and calculate charges
    let charges = 0
    let resolvedSchemeId: string | null = null
    let resolvedSchemeName: string | null = null
    let resolvedVia: string | null = null
    let commissionSplit = { distributor_commission: 0, md_commission: 0, company_earning: 0 }

    // Get retailer hierarchy
    let distributorId: string | null = null
    let mdId: string | null = null
    try {
      const { data: retailerData } = await supabaseAdmin
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', user.partner_id)
        .maybeSingle()
      distributorId = retailerData?.distributor_id || null
      mdId = retailerData?.master_distributor_id || null
    } catch (e) {
      console.warn('[Settlement-2] Failed to fetch retailer hierarchy:', e)
    }

    // Resolve scheme via RPC
    try {
      const { data: schemeResult, error: schemeError } = await (supabaseAdmin as any).rpc('resolve_scheme_for_user', {
        p_user_id: user.partner_id,
        p_user_role: 'retailer',
        p_service_type: 'shadval_settlement',
        p_distributor_id: distributorId,
        p_md_id: mdId,
      })

      if (!schemeError && schemeResult?.length > 0) {
        const resolved = schemeResult[0]
        resolvedSchemeId = resolved.scheme_id
        resolvedSchemeName = resolved.scheme_name
        resolvedVia = resolved.resolved_via

        const { data: chargeResult, error: chargeError } = await (supabaseAdmin as any).rpc(
          'calculate_shadval_settlement_charge_from_scheme',
          { p_scheme_id: resolved.scheme_id, p_amount: amountNum, p_transfer_mode: mode }
        )

        if (!chargeError && chargeResult?.length > 0) {
          charges = parseFloat(chargeResult[0].retailer_charge) || 0
          commissionSplit = {
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
            company_earning: parseFloat(chargeResult[0].company_charge) || 0,
          }
          console.log(`[Settlement-2] Scheme charge: ₹${charges}`)
        }
      }
    } catch (schemeErr) {
      console.error('[Settlement-2] Scheme resolution failed:', schemeErr)
    }

    // Direct query fallback for charges
    if (!resolvedSchemeId) {
      try {
        const { data: slabs } = await supabaseAdmin
          .from('scheme_shadval_settlement_charges')
          .select('*, schemes!inner(id, name, status)')
          .eq('status', 'active')
          .eq('transfer_mode', mode)
          .lte('min_amount', amountNum)
          .gte('max_amount', amountNum)
          .order('min_amount', { ascending: false })
          .limit(1)

        if (slabs?.length) {
          const slab = slabs[0] as any
          const calc = (v: number, t: string) => t === 'percentage' ? Math.round(amountNum * v / 100 * 100) / 100 : v
          charges = calc(parseFloat(slab.retailer_charge) || 0, slab.retailer_charge_type)
          commissionSplit = {
            distributor_commission: calc(parseFloat(slab.distributor_commission) || 0, slab.distributor_commission_type),
            md_commission: calc(parseFloat(slab.md_commission) || 0, slab.md_commission_type),
            company_earning: calc(parseFloat(slab.company_charge) || 0, slab.company_charge_type),
          }
          resolvedSchemeId = slab.scheme_id
        }
      } catch (e) {
        console.warn('[Settlement-2] Direct charge query failed:', e)
      }
    }

    // Check wallet balance (only charges are deducted from retailer wallet)
    const { data: walletBalance, error: balanceError } = await (supabaseAdmin as any).rpc('get_wallet_balance', {
      p_retailer_id: user.partner_id,
    })

    if (balanceError || walletBalance === null) {
      const response = NextResponse.json({ success: false, error: 'Failed to check wallet balance' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    if (charges > 0 && walletBalance < charges) {
      const response = NextResponse.json(
        {
          success: false,
          error: 'Insufficient wallet balance for settlement charges',
          wallet_balance: walletBalance,
          charges,
        },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Duplicate prevention
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const { data: recentTx } = await supabaseAdmin
      .from('shadval_settlement')
      .select('id, status, created_at')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', account.account_number)
      .gte('created_at', twoMinutesAgo)
      .in('status', ['SUCCESS', 'PENDING'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentTx) {
      const response = NextResponse.json(
        { success: false, error: 'A recent transaction to this account is already processing. Please wait 2 minutes.' },
        { status: 429 }
      )
      return addCorsHeaders(request, response)
    }

    const refId = `SV2_${user.partner_id}_${Date.now()}`

    // Create transaction record
    const { data: txRecord, error: txError } = await supabaseAdmin
      .from('shadval_settlement')
      .insert({
        retailer_id: user.partner_id,
        account_number: account.account_number,
        ifsc_code: account.ifsc_code,
        account_holder_name: account.account_holder_name,
        amount: amountNum,
        charges,
        total_debit: charges,
        mode,
        reference_id: refId,
        status: 'PENDING',
        contact_name: account.contact_name || user.name,
        contact_email: account.contact_email || user.email,
        contact_mobile: account.contact_mobile || user.phone,
        narration: narration || 'Settlement-2 Transfer',
        scheme_id: resolvedSchemeId,
        scheme_name: resolvedSchemeName,
        resolved_via: resolvedVia,
        distributor_commission: commissionSplit.distributor_commission,
        md_commission: commissionSplit.md_commission,
        company_earning: commissionSplit.company_earning,
      })
      .select()
      .single()

    if (txError || !txRecord) {
      console.error('[Settlement-2] Transaction insert error:', txError)
      const response = NextResponse.json({ success: false, error: 'Failed to create transaction record' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    // Debit charges from retailer wallet (only charges, not the transfer amount)
    let chargeLedgerId: string | null = null
    if (charges > 0) {
      const { data: ledgerId, error: ledgerError } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: 'retailer',
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'shadval_settlement',
        p_tx_type: 'SETTLEMENT2_CHARGE',
        p_credit: 0,
        p_debit: charges,
        p_reference_id: refId,
        p_transaction_id: txRecord.id,
        p_status: 'completed',
        p_remarks: `Settlement-2 charge ₹${charges} for ₹${amountNum} transfer to ${account.account_number}`,
      })

      if (ledgerError) {
        console.error('[Settlement-2] Charge debit failed:', ledgerError)
        await supabaseAdmin
          .from('shadval_settlement')
          .update({ status: 'FAILED', status_message: 'Charge debit failed' })
          .eq('id', txRecord.id)
        const response = NextResponse.json({ success: false, error: 'Failed to debit charges' }, { status: 500 })
        return addCorsHeaders(request, response)
      }
      chargeLedgerId = ledgerId
    }

    // Credit charges to company revenue
    let revenueLedgerId: string | null = null
    if (charges > 0) {
      const companyEarning = commissionSplit.company_earning > 0 ? commissionSplit.company_earning : charges
      const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
      const revenueUserRole = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'
      if (revenueUserId) {
        const { data: revId, error: revError } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
          p_user_id: revenueUserId,
          p_user_role: revenueUserRole,
          p_wallet_type: 'primary',
          p_fund_category: 'revenue',
          p_service_type: 'shadval_settlement',
          p_tx_type: 'COMPANY_REVENUE',
          p_credit: companyEarning,
          p_debit: 0,
          p_reference_id: `REV_${refId}`,
          p_transaction_id: txRecord.id,
          p_status: 'completed',
          p_remarks: `Settlement-2 revenue ₹${companyEarning} from charge ₹${charges} on ₹${amountNum} transfer (RT:${user.partner_id})`,
        })
        if (!revError) revenueLedgerId = revId
        else console.error('[Settlement-2] Revenue credit error:', revError)
      }

      // Distributor commission
      if (commissionSplit.distributor_commission > 0 && distributorId) {
        try {
          await (supabaseAdmin as any).rpc('add_ledger_entry', {
            p_user_id: distributorId,
            p_user_role: 'distributor',
            p_wallet_type: 'primary',
            p_fund_category: 'commission',
            p_service_type: 'shadval_settlement',
            p_tx_type: 'COMMISSION',
            p_credit: commissionSplit.distributor_commission,
            p_debit: 0,
            p_reference_id: `DTCOMM_${refId}`,
            p_transaction_id: txRecord.id,
            p_status: 'completed',
            p_remarks: `Settlement-2 commission ₹${commissionSplit.distributor_commission} from RT:${user.partner_id}`,
          })
        } catch (e) {
          console.error('[Settlement-2] Distributor commission error:', e)
        }
      }

      // MD commission
      if (commissionSplit.md_commission > 0 && mdId) {
        try {
          await (supabaseAdmin as any).rpc('add_ledger_entry', {
            p_user_id: mdId,
            p_user_role: 'master_distributor',
            p_wallet_type: 'primary',
            p_fund_category: 'commission',
            p_service_type: 'shadval_settlement',
            p_tx_type: 'COMMISSION',
            p_credit: commissionSplit.md_commission,
            p_debit: 0,
            p_reference_id: `MDCOMM_${refId}`,
            p_transaction_id: txRecord.id,
            p_status: 'completed',
            p_remarks: `Settlement-2 MD commission ₹${commissionSplit.md_commission} from RT:${user.partner_id}`,
          })
        } catch (e) {
          console.error('[Settlement-2] MD commission error:', e)
        }
      }
    }

    // Initiate bank transfer via Shadval Pay
    const transferRequest: ShadvalTransferRequest = {
      amount: amountNum,
      mode: mode as 'IMPS' | 'NEFT' | 'RTGS',
      fund_account: {
        name: account.account_holder_name,
        ifsc: account.ifsc_code,
        account_number: account.account_number,
      },
      contact_details: {
        name: account.contact_name || user.name || account.account_holder_name,
        email: account.contact_email || user.email || '',
        mobile: account.contact_mobile || user.phone || '',
      },
      reference_id: refId,
      latitude: '0',
      longitude: '0',
      narration: narration || 'Settlement-2 Transfer',
    }

    console.log('[Settlement-2] Initiating transfer:', {
      ref: refId,
      amount: amountNum,
      charges,
      account: account.account_number.substring(0, 4) + '****',
      retailer: user.partner_id,
    })

    const apiResult = await initiateBankTransfer(transferRequest)
    const isSuccess = apiResult.status === 'SUCCESS'

    // Update transaction with API result
    await supabaseAdmin
      .from('shadval_settlement')
      .update({
        status: isSuccess ? 'SUCCESS' : apiResult.status === 'FAILED' ? 'FAILED' : 'PENDING',
        order_id: apiResult.data?.order_id || null,
        internal_ref_id: apiResult.data?.internal_ref_id || null,
        utr: apiResult.data?.utr || null,
        status_message: apiResult.message,
        charge_ledger_id: chargeLedgerId,
        revenue_ledger_id: revenueLedgerId,
        provider_timestamp: apiResult.data?.timestamp || null,
      })
      .eq('id', txRecord.id)

    const response = NextResponse.json({
      success: true,
      transaction: {
        id: txRecord.id,
        reference_id: refId,
        order_id: apiResult.data?.order_id,
        utr: apiResult.data?.utr,
        amount: amountNum,
        charges,
        mode,
        status: isSuccess ? 'SUCCESS' : apiResult.status === 'FAILED' ? 'FAILED' : 'PENDING',
        status_message: apiResult.message,
        account_number: account.account_number,
        account_holder_name: account.account_holder_name,
        provider_timestamp: apiResult.data?.timestamp,
      },
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Settlement-2 Transfer] Error:', error)
    const response = NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return addCorsHeaders(request, response)
  }
}
