import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { initiateBankTransfer } from '@/services/shadval-pay'
import type { ShadvalTransferRequest } from '@/services/shadval-pay'
import { createClient } from '@supabase/supabase-js'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import {
  reserveIdempotencyKey,
  finalizeIdempotencyKey,
  getIdempotencyKeyFromHeaders,
} from '@/lib/security/idempotency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IDEM_SCOPE = 'settlement2_transfer'

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
  const rl = rateLimit(request, RATE_LIMITS.transfer)
  if (rl.limited) return addCorsHeaders(request, rl.response!)

  const idemKey = getIdempotencyKeyFromHeaders(request.headers)

  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !['retailer', 'partner'].includes(user.role)) {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { account_id, amount, mode = 'IMPS', narration, tpin } = body

    if (!tpin || tpin.length !== 4) {
      const response = NextResponse.json({ success: false, error: 'Valid 4-digit TPIN is required' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    const tpinFn = user.role === 'partner' ? 'verify_partner_tpin' : 'verify_retailer_tpin'
    const tpinParam = user.role === 'partner' ? 'p_partner_id' : 'p_retailer_id'
    const { data: tpinResult, error: tpinError } = await supabaseAdmin.rpc(tpinFn, {
      [tpinParam]: user.partner_id,
      p_tpin: tpin,
    })
    if (tpinError || !tpinResult?.success) {
      const msg = tpinResult?.error || tpinError?.message || 'TPIN verification failed'
      const response = NextResponse.json({ success: false, error: msg }, { status: 403 })
      return addCorsHeaders(request, response)
    }

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
    let baseCharges = 0
    let gstAmount = 0
    const GST_PERCENT = 18
    let resolvedSchemeId: string | null = null
    let resolvedSchemeName: string | null = null
    let resolvedVia: string | null = null
    let commissionSplit = { distributor_commission: 0, md_commission: 0, company_earning: 0 }

    // Get retailer hierarchy
    let distributorId: string | null = null
    let mdId: string | null = null
    if (user.role === 'retailer') {
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
    }

    // Resolve scheme via RPC
    try {
      const { data: schemeResult, error: schemeError } = await (supabaseAdmin as any).rpc('resolve_scheme_for_user', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
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
          baseCharges = parseFloat(chargeResult[0].retailer_charge) || 0
          gstAmount = Math.round(baseCharges * GST_PERCENT / 100 * 100) / 100
          charges = Math.round((baseCharges + gstAmount) * 100) / 100
          commissionSplit = {
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
            company_earning: parseFloat(chargeResult[0].company_charge) || 0,
          }
          console.log(`[Settlement-2] Scheme charge: ₹${baseCharges} + GST ₹${gstAmount} = ₹${charges}`)
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
          baseCharges = calc(parseFloat(slab.retailer_charge) || 0, slab.retailer_charge_type)
          gstAmount = Math.round(baseCharges * GST_PERCENT / 100 * 100) / 100
          charges = Math.round((baseCharges + gstAmount) * 100) / 100
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

    // Enforce slab limits: if charge slabs are configured for this mode, the amount
    // must fall within one of them. Otherwise (e.g. IMPS max slab is 49,999 and the
    // retailer enters 99,000) no slab matches, charges silently become 0, and the
    // transfer would go through above the intended limit.
    try {
      let slabQuery = supabaseAdmin
        .from('scheme_shadval_settlement_charges')
        .select('min_amount, max_amount')
        .eq('status', 'active')
        .eq('transfer_mode', mode)
      if (resolvedSchemeId) slabQuery = slabQuery.eq('scheme_id', resolvedSchemeId)
      const { data: slabRows } = await slabQuery

      if (slabRows && slabRows.length > 0) {
        const inSlab = slabRows.some(s =>
          amountNum >= parseFloat(String(s.min_amount)) && amountNum <= parseFloat(String(s.max_amount))
        )
        if (!inSlab) {
          const minAllowed = Math.min(...slabRows.map(s => parseFloat(String(s.min_amount))))
          const maxAllowed = Math.max(...slabRows.map(s => parseFloat(String(s.max_amount))))
          console.log(`[Settlement-2] Amount ₹${amountNum} outside ${mode} slab limits (₹${minAllowed}–₹${maxAllowed})`)
          const response = NextResponse.json(
            {
              success: false,
              error: `Amount not allowed for ${mode}. Allowed range: ₹${minAllowed.toLocaleString('en-IN')} – ₹${maxAllowed.toLocaleString('en-IN')}. Please split larger settlements into multiple transfers.`,
              min_allowed: minAllowed,
              max_allowed: maxAllowed,
            },
            { status: 400 }
          )
          return addCorsHeaders(request, response)
        }
      }
    } catch (e) {
      console.warn('[Settlement-2] Slab limit check failed:', e)
    }

    // Check wallet balance (transfer amount + charges must be available)
    const { data: walletBalance, error: balanceError } = await (supabaseAdmin as any).rpc('get_wallet_balance_v2', {
      p_user_id: user.partner_id,
      p_wallet_type: 'primary',
    })

    if (balanceError || walletBalance === null) {
      const response = NextResponse.json({ success: false, error: 'Failed to check wallet balance' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    const totalRequired = amountNum + charges
    if (walletBalance < totalRequired) {
      const response = NextResponse.json(
        {
          success: false,
          error: `Insufficient wallet balance. Required: ₹${totalRequired.toFixed(2)} (₹${amountNum} transfer + ₹${charges} charges). Available: ₹${walletBalance.toFixed(2)}`,
          wallet_balance: walletBalance,
          required: totalRequired,
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

    // Idempotency: dedup repeated submits of the same settlement
    if (idemKey) {
      const reservation = await reserveIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, userId: user.partner_id })
      if (!reservation.fresh) {
        if (reservation.status === 'completed' && reservation.cachedResponse) {
          return addCorsHeaders(request, NextResponse.json(reservation.cachedResponse))
        }
        return addCorsHeaders(
          request,
          NextResponse.json(
            { success: false, error: 'A settlement with this idempotency key is already being processed.', code: 'IDEMPOTENT_REPLAY' },
            { status: 409 }
          )
        )
      }
    }

    const refId = `SV2_${user.partner_id}_${Date.now()}`

    // Create transaction record
    const { data: txRecord, error: txError } = await supabaseAdmin
      .from('shadval_settlement')
      .insert({
        retailer_id: user.partner_id,
        account_number: account.account_number,
        ifsc_code: account.ifsc_code,
        account_holder_name: account.verified_name || account.account_holder_name,
        amount: amountNum,
        charges,
        total_debit: amountNum + charges,
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
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' })
      const response = NextResponse.json({ success: false, error: 'Failed to create transaction record' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    // Debit transfer amount + charges in one entry
    const totalDebit = amountNum + charges
    const debitRemarks = charges > 0
      ? `Settlement-2 transfer ₹${amountNum} + charge ₹${baseCharges} + GST ₹${gstAmount} = ₹${totalDebit.toFixed(2)} to ${account.account_number} (${account.account_holder_name})`
      : `Settlement-2 transfer ₹${amountNum} to ${account.account_number} (${account.account_holder_name})`

    const { data: transferLedgerId, error: transferLedgerError } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
      p_user_id: user.partner_id,
      p_user_role: user.role,
      p_wallet_type: 'primary',
      p_fund_category: 'service',
      p_service_type: 'shadval_settlement',
      p_tx_type: 'SETTLEMENT2_TRANSFER',
      p_credit: 0,
      p_debit: totalDebit,
      p_reference_id: `${refId}_TRANSFER`,
      p_transaction_id: txRecord.id,
      p_status: 'completed',
      p_remarks: debitRemarks,
    })

    if (transferLedgerError) {
      console.error('[Settlement-2] Transfer debit failed:', transferLedgerError)
      await supabaseAdmin
        .from('shadval_settlement')
        .update({ status: 'FAILED', status_message: 'Transfer amount debit failed' })
        .eq('id', txRecord.id)
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' })
      const response = NextResponse.json({ success: false, error: 'Failed to debit transfer amount from wallet' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    // Persist the exact amount debited so refund logic never drifts
    await supabaseAdmin
      .from('shadval_settlement')
      .update({ actual_wallet_debit: totalDebit, transfer_ledger_id: transferLedgerId })
      .eq('id', txRecord.id)

    const chargeLedgerId: string | null = null

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
    const fundAccountName = account.verified_name || account.account_holder_name
    const contactMobile = account.contact_mobile || user.phone || ''

    if (!contactMobile) {
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' })
      const response = NextResponse.json(
        { success: false, error: 'Mobile number is missing for this account. Please delete and re-add the account with a valid mobile number.' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const transferRequest: ShadvalTransferRequest = {
      amount: amountNum,
      mode: mode as 'IMPS' | 'NEFT' | 'RTGS',
      fund_account: {
        name: fundAccountName,
        ifsc: account.ifsc_code,
        account_number: account.account_number,
      },
      contact_details: {
        name: account.contact_name || user.name || fundAccountName,
        email: account.contact_email || user.email || '',
        mobile: contactMobile,
      },
      reference_id: refId,
      latitude: '28.6139',
      longitude: '77.2090',
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
    const isFailed = apiResult.status === 'FAILED'

    // Provider hard-failed → make everyone whole: refund the retailer (amount + charges)
    // and reverse the commission/revenue credits that were posted optimistically above.
    if (isFailed) {
      const { error: retailerRefundErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'shadval_settlement',
        p_tx_type: 'SETTLEMENT2_REFUND',
        p_credit: totalDebit,
        p_debit: 0,
        p_reference_id: `REFUND_${refId}`,
        p_transaction_id: txRecord.id,
        p_status: 'completed',
        p_remarks: `Settlement-2 refund ₹${totalDebit.toFixed(2)} — provider transfer failed: ${apiResult.message || ''}`,
      })
      if (retailerRefundErr) console.error('[Settlement-2] CRITICAL retailer refund failed:', retailerRefundErr)

      if (charges > 0) {
        const companyEarning = commissionSplit.company_earning > 0 ? commissionSplit.company_earning : charges
        const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
        const revenueUserRole = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'
        if (revenueLedgerId && revenueUserId) {
          const { error: revRevErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
            p_user_id: revenueUserId, p_user_role: revenueUserRole, p_wallet_type: 'primary',
            p_fund_category: 'revenue', p_service_type: 'shadval_settlement', p_tx_type: 'COMPANY_REVENUE_REVERSAL',
            p_credit: 0, p_debit: companyEarning,
            p_reference_id: `REVREV_${refId}`, p_transaction_id: txRecord.id, p_status: 'completed',
            p_remarks: `Reversal of Settlement-2 revenue ₹${companyEarning} — transfer failed`,
          })
          if (revRevErr) console.error('[Settlement-2] Revenue reversal failed:', revRevErr)
        }
        if (commissionSplit.distributor_commission > 0 && distributorId) {
          const { error: dtCommRevErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
            p_user_id: distributorId, p_user_role: 'distributor', p_wallet_type: 'primary',
            p_fund_category: 'commission', p_service_type: 'shadval_settlement', p_tx_type: 'COMMISSION_REVERSAL',
            p_credit: 0, p_debit: commissionSplit.distributor_commission,
            p_reference_id: `DTCOMMREV_${refId}`, p_transaction_id: txRecord.id, p_status: 'completed',
            p_remarks: `Reversal of Settlement-2 DT commission — transfer failed`,
          })
          if (dtCommRevErr) console.error('[Settlement-2] DT commission reversal failed:', dtCommRevErr)
        }
        if (commissionSplit.md_commission > 0 && mdId) {
          const { error: mdCommRevErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
            p_user_id: mdId, p_user_role: 'master_distributor', p_wallet_type: 'primary',
            p_fund_category: 'commission', p_service_type: 'shadval_settlement', p_tx_type: 'COMMISSION_REVERSAL',
            p_credit: 0, p_debit: commissionSplit.md_commission,
            p_reference_id: `MDCOMMREV_${refId}`, p_transaction_id: txRecord.id, p_status: 'completed',
            p_remarks: `Reversal of Settlement-2 MD commission — transfer failed`,
          })
          if (mdCommRevErr) console.error('[Settlement-2] MD commission reversal failed:', mdCommRevErr)
        }
      }
    }

    // Update transaction with API result
    await supabaseAdmin
      .from('shadval_settlement')
      .update({
        status: isSuccess ? 'SUCCESS' : isFailed ? 'FAILED' : 'PENDING',
        status_message: isFailed ? `${apiResult.message || 'Transfer failed'} [Wallet refunded]` : apiResult.message,
        order_id: apiResult.data?.order_id || null,
        internal_ref_id: apiResult.data?.internal_ref_id || null,
        utr: apiResult.data?.utr || null,
        charge_ledger_id: chargeLedgerId,
        revenue_ledger_id: revenueLedgerId,
        provider_timestamp: apiResult.data?.timestamp || null,
      })
      .eq('id', txRecord.id)

    const successBody = {
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
        account_holder_name: account.verified_name || account.account_holder_name,
        provider_timestamp: apiResult.data?.timestamp,
      },
    }
    // Provider FAILED is retryable; only persist a replayable result when not failed.
    if (idemKey) {
      await finalizeIdempotencyKey({
        scope: IDEM_SCOPE,
        key: idemKey,
        status: apiResult.status === 'FAILED' ? 'failed' : 'completed',
        response: apiResult.status === 'FAILED' ? undefined : successBody,
      })
    }
    const response = NextResponse.json(successBody)
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Settlement-2 Transfer] Error:', error)
    if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
    const response = NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return addCorsHeaders(request, response)
  }
}
