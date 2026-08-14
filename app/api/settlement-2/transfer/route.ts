import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
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
import { distributeServiceCommission, reverseServiceCommission } from '@/lib/commission/distribute-service-commission'

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
    const access = authorizeSubPartner(user, 'settlement-2')
    if (!access.ok) return access.response
    if (!user || !['retailer', 'distributor', 'partner'].includes(user.role)) {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { account_id, amount, mode = 'IMPS', narration, tpin } = body

    if (!tpin || tpin.length !== 4) {
      const response = NextResponse.json({ success: false, error: 'Valid 4-digit TPIN is required' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    const tpinFn = user.role === 'partner' ? 'verify_partner_tpin' : user.role === 'distributor' ? 'verify_distributor_tpin' : 'verify_retailer_tpin'
    const tpinParam = user.role === 'partner' ? 'p_partner_id' : user.role === 'distributor' ? 'p_distributor_id' : 'p_retailer_id'
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

    // SameDay hard limit: max ₹1,00,000 per transaction
    const MAX_PER_TXN = 100000
    if (amountNum > MAX_PER_TXN) {
      const response = NextResponse.json(
        { success: false, error: `Maximum transaction amount is ₹1,00,000. Please split into smaller transfers.` },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const validModes = ['IMPS', 'RTGS']
    if (!validModes.includes(mode)) {
      const response = NextResponse.json({ success: false, error: 'Invalid transfer mode' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    // Fetch account (verified or unverified — risk is on the user)
    const { data: account, error: acctError } = await supabaseAdmin
      .from('shadval_settlement_accounts')
      .select('*')
      .eq('id', account_id)
      .eq('retailer_id', user.partner_id)
      .eq('is_active', true)
      .maybeSingle()

    if (acctError || !account) {
      const response = NextResponse.json(
        { success: false, error: 'Account not found or inactive' },
        { status: 404 }
      )
      return addCorsHeaders(request, response)
    }

    // SameDay hard limit: max ₹10,00,000 settled to one account per day
    const MAX_PER_ACCOUNT_DAILY = 1000000
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { data: dailyRows } = await supabaseAdmin
      .from('shadval_settlement')
      .select('amount')
      .eq('account_number', account.account_number)
      .gte('created_at', todayStart.toISOString())
      .in('status', ['SUCCESS', 'PENDING'])

    const dailySettled = (dailyRows || []).reduce(
      (sum, r) => sum + parseFloat(String(r.amount || 0)), 0
    )
    if (dailySettled + amountNum > MAX_PER_ACCOUNT_DAILY) {
      const remaining = MAX_PER_ACCOUNT_DAILY - dailySettled
      const response = NextResponse.json(
        {
          success: false,
          error: `Daily settlement limit of ₹10,00,000 per account reached. Already settled: ₹${dailySettled.toLocaleString('en-IN')}. Remaining: ₹${Math.max(0, remaining).toLocaleString('en-IN')}.`,
          daily_settled: dailySettled,
          daily_remaining: Math.max(0, remaining),
        },
        { status: 400 }
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
    let chargeModelData: { md_purchase_charge: number; dt_purchase_charge: number; rt_purchase_charge: number; company_cost: number } | null = null

    // Get user hierarchy
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
    } else if (user.role === 'distributor') {
      distributorId = user.partner_id
      try {
        const { data: distData } = await supabaseAdmin
          .from('distributors')
          .select('master_distributor_id')
          .eq('partner_id', user.partner_id)
          .maybeSingle()
        mdId = distData?.master_distributor_id || null
      } catch (e) {
        console.warn('[Settlement-2] Failed to fetch distributor hierarchy:', e)
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

        if (!chargeError && chargeResult?.length > 0 && parseFloat(chargeResult[0].retailer_charge) > 0) {
          baseCharges = parseFloat(chargeResult[0].retailer_charge) || 0
          gstAmount = Math.round(baseCharges * GST_PERCENT / 100 * 100) / 100
          charges = Math.round((baseCharges + gstAmount) * 100) / 100
          commissionSplit = {
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
            company_earning: parseFloat(chargeResult[0].company_charge) || 0,
          }
          const mdPc = parseFloat(chargeResult[0].md_purchase_charge_val) || 0
          const dtPc = parseFloat(chargeResult[0].dt_purchase_charge_val) || 0
          const rtPc = parseFloat(chargeResult[0].rt_purchase_charge_val) || 0
          if (mdPc > 0 || dtPc > 0 || rtPc > 0) {
            chargeModelData = {
              md_purchase_charge: mdPc,
              dt_purchase_charge: dtPc,
              rt_purchase_charge: rtPc,
              company_cost: parseFloat(chargeResult[0].company_earning || chargeResult[0].company_charge) || 0,
            }
          }
          console.log(`[Settlement-2] Scheme charge: ₹${baseCharges} + GST ₹${gstAmount} = ₹${charges}${chargeModelData ? ' [CHARGE MODEL]' : ''}`)
        }
      }
    } catch (schemeErr) {
      console.error('[Settlement-2] Scheme resolution failed:', schemeErr)
    }

    // Direct query fallback for charges (also triggers when RPC returned retailer_charge=0).
    // Scope to the user's entitled scheme(s): the RPC-resolved scheme if present,
    // otherwise the schemes directly mapped to the user. This prevents picking up
    // charges from an unrelated/previous scheme.
    if (!resolvedSchemeId || baseCharges === 0) {
      try {
        let scopedSchemeIds: string[] = []
        if (resolvedSchemeId) {
          scopedSchemeIds = [resolvedSchemeId]
        } else {
          const { data: mappings } = await supabaseAdmin
            .from('scheme_mappings')
            .select('scheme_id, service_type, status')
            .eq('entity_id', user.partner_id)
            .eq('entity_role', user.role)
            .eq('status', 'active')
          scopedSchemeIds = (mappings || [])
            .filter((m: any) => !m.service_type || m.service_type === 'all' || m.service_type === 'shadval_settlement')
            .map((m: any) => m.scheme_id)
        }

        const { data: slabs } = scopedSchemeIds.length > 0 ? await supabaseAdmin
          .from('scheme_shadval_settlement_charges')
          .select('*, schemes!inner(id, name, status)')
          .in('scheme_id', scopedSchemeIds)
          .eq('status', 'active')
          .eq('transfer_mode', mode)
          .lte('min_amount', amountNum)
          .gte('max_amount', amountNum)
          .order('min_amount', { ascending: false })
          .limit(1) : { data: null }

        if (slabs?.length) {
          const slab = slabs[0] as any
          const calc = (v: number, t: string) => t === 'percentage' ? Math.round(amountNum * v / 100 * 100) / 100 : v
          const rtCharge = parseFloat(slab.rt_purchase_charge) || 0
          const rawRetailer = parseFloat(slab.retailer_charge) || 0
          const effectiveCharge = rtCharge > 0 ? rtCharge : rawRetailer
          const effectiveType = rtCharge > 0 ? (slab.rt_purchase_charge_type || 'flat') : (slab.retailer_charge_type || 'flat')
          baseCharges = calc(effectiveCharge, effectiveType)
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
    let walletBalance = 0
    let balanceError: any = null
    if (user.role === 'partner') {
      const { data, error } = await (supabaseAdmin as any).rpc('get_partner_wallet_balance', { p_partner_id: user.partner_id })
      walletBalance = data || 0
      balanceError = error
    } else {
      const { data, error } = await (supabaseAdmin as any).rpc('get_wallet_balance_v2', { p_user_id: user.partner_id, p_wallet_type: 'primary' })
      walletBalance = data || 0
      balanceError = error
    }

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

    // Duplicate prevention — same account + same amount within 1 min
    // SUCCESS txns: block for full 60s (prevents double credit/debit)
    // PENDING txns: block only for 15s (allows retry after stale timeouts)
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString()
    const fifteenSecAgo = new Date(Date.now() - 15 * 1000).toISOString()

    const { data: recentSuccessTx } = await supabaseAdmin
      .from('shadval_settlement')
      .select('id, status, created_at')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', account.account_number)
      .eq('amount', amountNum)
      .gte('created_at', oneMinuteAgo)
      .eq('status', 'SUCCESS')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: recentPendingTx } = await supabaseAdmin
      .from('shadval_settlement')
      .select('id, status, created_at')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', account.account_number)
      .eq('amount', amountNum)
      .gte('created_at', fifteenSecAgo)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const recentTx = recentSuccessTx || recentPendingTx
    if (recentTx) {
      const response = NextResponse.json(
        { success: false, error: 'An identical transaction (same account + amount) is already processing. Please wait.' },
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

    const requiresApproval = user.role === 'distributor'

    // Create transaction record
    const { data: txRecord, error: txError } = await supabaseAdmin
      .from('shadval_settlement')
      .insert({
        retailer_id: user.partner_id,
        user_role: user.role,
        account_number: account.account_number,
        ifsc_code: account.ifsc_code,
        account_holder_name: account.verified_name || account.account_holder_name,
        amount: amountNum,
        charges,
        total_debit: amountNum + charges,
        mode,
        reference_id: refId,
        status: requiresApproval ? 'AWAITING_APPROVAL' : 'PENDING',
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

    // Debit transfer amount + charges
    const totalDebit = amountNum + charges
    const debitRemarks = charges > 0
      ? `Settlement-2 transfer ₹${amountNum} + charge ₹${baseCharges} + GST ₹${gstAmount} = ₹${totalDebit.toFixed(2)} to ${account.account_number} (${account.account_holder_name})`
      : `Settlement-2 transfer ₹${amountNum} to ${account.account_number} (${account.account_holder_name})`

    let transferLedgerId: string | null = null
    let transferLedgerError: any = null
    if (user.role === 'partner') {
      const { data, error } = await (supabaseAdmin as any).rpc('debit_partner_wallet', {
        p_partner_id: user.partner_id,
        p_amount: totalDebit,
        p_description: debitRemarks,
        p_reference_id: `${refId}_TRANSFER`,
        p_service_type: 'shadval_settlement',
      })
      transferLedgerId = data
      transferLedgerError = error
    } else {
      const { data, error } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
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
      transferLedgerId = data
      transferLedgerError = error
    }

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

    // Distributor settlements require admin approval before processing
    if (requiresApproval) {
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'completed', response: { awaiting_approval: true } })
      const response = NextResponse.json({
        success: true,
        transaction: {
          id: txRecord.id,
          reference_id: refId,
          amount: amountNum,
          charges,
          mode,
          status: 'AWAITING_APPROVAL',
          status_message: 'Settlement request submitted. Awaiting admin approval.',
          account_number: account.account_number,
          account_holder_name: account.verified_name || account.account_holder_name,
        },
      })
      return addCorsHeaders(request, response)
    }

    const chargeLedgerId: string | null = null

    // Per-transaction commission: distributor + company only (no MD; S2 has no
    // retailer slab). MD's former slice folds into company revenue. The company
    // remainder = charge - distributor_commission. Idempotent references.
    const revenueLedgerId: string | null = null
    if (charges > 0) {
      const commResult = await distributeServiceCommission({
        supabase: supabaseAdmin,
        service: 'shadval_settlement',
        refPrefix: 'SHADVAL',
        refKey: refId,
        transactionUuid: txRecord.id,
        totalCharge: charges,
        retailer: { id: user.partner_id, role: user.role, commission: 0 },
        distributor: { id: distributorId, commission: commissionSplit.distributor_commission },
        masterDistributor: { id: mdId },
        chargeModel: chargeModelData,
        remarksSuffix: `on ₹${amountNum} transfer`,
        auditWriteback: {
          table: 'shadval_settlement',
          txnId: txRecord.id,
          distributorCol: 'distributor_commission',
          mdCol: 'md_margin_earned',
          companyCol: 'company_earning',
        },
      })
      if (commResult.errors.length) console.error('[Settlement-2] Commission errors:', commResult.errors)
      else console.log(`[Settlement-2] ✅ Commission distributed (${commResult.model}): DT ₹${commResult.distributorCredited}, MD ₹${commResult.mdCredited}, Company ₹${commResult.companyCredited}`)
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
      mode: mode as 'IMPS' | 'RTGS',
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
    // A network timeout or a malformed provider response does NOT mean the payout
    // failed — the transfer may already be in flight at the bank. Treat these as
    // INDETERMINATE: leave the transaction PENDING (money stays debited) and let
    // the status poll / check-pending cron resolve it against the real provider
    // status. Refunding here risks paying the beneficiary AND refunding the wallet.
    const INDETERMINATE_CODES = ['NETWORK_ERROR', 'PROVIDER_ERROR', 'TIMEOUT']
    const isIndeterminate = apiResult.status === 'FAILED' && INDETERMINATE_CODES.includes(String(apiResult.code || ''))
    const isFailed = apiResult.status === 'FAILED' && !isIndeterminate

    // Provider hard-failed (a definitive business failure, money never left) →
    // make everyone whole: refund the retailer (amount + charges) and reverse the
    // commission/revenue credits that were posted optimistically above.
    if (isFailed) {
      let retailerRefundErr: any = null
      if (user.role === 'partner') {
        const { error } = await (supabaseAdmin as any).rpc('credit_partner_wallet', {
          p_partner_id: user.partner_id,
          p_amount: totalDebit,
          p_description: `Settlement-2 refund ₹${totalDebit.toFixed(2)} — provider transfer failed: ${apiResult.message || ''}`,
          p_reference_id: `REFUND_${refId}`,
          p_transaction_type: 'REFUND',
          p_service_type: 'shadval_settlement',
        })
        retailerRefundErr = error
      } else {
        const { error } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
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
        retailerRefundErr = error
      }
      if (retailerRefundErr) console.error('[Settlement-2] CRITICAL retailer refund failed:', retailerRefundErr)

      if (charges > 0) {
        await reverseServiceCommission({
          supabase: supabaseAdmin,
          service: 'shadval_settlement',
          refPrefix: 'SHADVAL',
          refKey: refId,
          transactionUuid: txRecord.id,
        })
      }
    }

    // Update transaction with API result. Indeterminate outcomes stay PENDING
    // (no refund) so the poll/cron can confirm against the provider.
    await supabaseAdmin
      .from('shadval_settlement')
      .update({
        status: isSuccess ? 'SUCCESS' : isFailed ? 'FAILED' : 'PENDING',
        status_message: isFailed
          ? `${apiResult.message || 'Transfer failed'} [Wallet refunded]`
          : isIndeterminate
          ? `${apiResult.message || 'Awaiting confirmation'} [PENDING — verifying with provider]`
          : apiResult.message,
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
        status: isSuccess ? 'SUCCESS' : isFailed ? 'FAILED' : 'PENDING',
        status_message: isIndeterminate
          ? 'Transfer is being verified with the provider. Please check status shortly — do not retry.'
          : apiResult.message,
        account_number: account.account_number,
        account_holder_name: account.verified_name || account.account_holder_name,
        provider_timestamp: apiResult.data?.timestamp,
      },
    }
    // Only a DEFINITIVE provider failure is retryable. Indeterminate outcomes are
    // PENDING with the money still debited, so a retry would double-debit — cache
    // them as completed so a replay returns the same pending result.
    if (idemKey) {
      await finalizeIdempotencyKey({
        scope: IDEM_SCOPE,
        key: idemKey,
        status: isFailed ? 'failed' : 'completed',
        response: isFailed ? undefined : successBody,
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
