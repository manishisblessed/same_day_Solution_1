import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner, normalizeMasterPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import {
  reserveIdempotencyKey,
  finalizeIdempotencyKey,
  getIdempotencyKeyFromHeaders,
} from '@/lib/security/idempotency'
import { toUserSafeError } from '@/lib/provider-error'
import { SCHEME_NOT_ASSIGNED, SCHEME_NOT_ASSIGNED_STATUS, SCHEME_NO_VALID_SLAB, hasCoveringPayoutSlab } from '@/lib/scheme-guard'
import { distributeServiceCommission, reverseServiceCommission } from '@/lib/commission/distribute-service-commission'
import { initiateKnteerTransfer, generateRefId, getKnteerBalance } from '@/services/knteer-payout'
import { refundKnteerPayout } from '@/lib/knteer/refund'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IDEM_SCOPE = 'knteer_payout_transfer'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function OPTIONS(request: NextRequest) {
  const res = handleCorsPreflight(request)
  return res || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/knteer-payout/transfer
 *
 * Full payout flow via Knteer Solution:
 *   auth → TPIN → scheme charges → balance → dedup → idempotency →
 *   DB record → wallet debit → add-bene → do-transaction →
 *   commission → response
 *
 * Body: {
 *   accountNumber, ifscCode, accountHolderName, bankName,
 *   amount, paymentMode, email, mobile (beneficiary),
 *   senderName, senderMobile, remarks, tpin
 * }
 */
export async function POST(request: NextRequest) {
  const rl = rateLimit(request, RATE_LIMITS.payout)
  if (rl.limited) return addCorsHeaders(request, rl.response!)

  const idemKey = getIdempotencyKeyFromHeaders(request.headers)

  try {
    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)

    if (!user?.partner_id) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 }))
    }

    const access = authorizeSubPartner(user, 'payout')
    if (!access.ok) return access.response

    if (!['retailer', 'partner'].includes(user.role || '')) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 }))
    }

    const body = await request.json()
    const {
      accountNumber, ifscCode, accountHolderName, bankName,
      amount, paymentMode = 'IMPS',
      email, mobile,           // beneficiary
      senderName, senderMobile,
      remarks, tpin,
    } = body

    // ── Validate required fields ───────────────────────────────────────────
    if (!accountNumber || !ifscCode || !accountHolderName || !bankName || !amount || !paymentMode) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'accountNumber, ifscCode, accountHolderName, bankName, amount and paymentMode are required' }, { status: 400 }))
    }
    if (!mobile || !senderName || !senderMobile) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'mobile (beneficiary), senderName and senderMobile are required' }, { status: 400 }))
    }
    if (!tpin || String(tpin).length !== 4) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Valid 4-digit TPIN is required' }, { status: 400 }))
    }

    const validModes = ['IMPS', 'NEFT']
    if (!validModes.includes(paymentMode)) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'paymentMode must be IMPS or NEFT' }, { status: 400 }))
    }

    const mobileRegex = /^[6-9]\d{9}$/
    if (!mobileRegex.test(String(mobile))) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Invalid beneficiary mobile number' }, { status: 400 }))
    }
    if (!mobileRegex.test(String(senderMobile))) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Invalid sender mobile number' }, { status: 400 }))
    }

    const amountNum = parseFloat(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Invalid amount' }, { status: 400 }))
    }
    if (amountNum > 200000) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Maximum transfer amount is ₹2,00,000' }, { status: 400 }))
    }
    if (amountNum < 100) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Minimum transfer amount is ₹100' }, { status: 400 }))
    }

    // ── TPIN verification ──────────────────────────────────────────────────
    const tpinFn = user.role === 'partner' ? 'verify_partner_tpin' : 'verify_retailer_tpin'
    const tpinParam = user.role === 'partner' ? 'p_partner_id' : 'p_retailer_id'
    const { data: tpinResult, error: tpinError } = await supabaseAdmin.rpc(tpinFn, {
      [tpinParam]: user.partner_id,
      p_tpin: String(tpin),
    })
    if (tpinError || !tpinResult?.success) {
      const msg = tpinResult?.error || tpinError?.message || 'TPIN verification failed'
      return addCorsHeaders(request, NextResponse.json({ success: false, error: msg }, { status: 403 }))
    }

    // ── Resolve hierarchy (for scheme + commission) ─────────────────────────
    let distributorId: string | null = null
    let mdId: string | null = null
    if (user.role === 'retailer') {
      const { data: retailerData } = await supabaseAdmin
        .from('retailers')
        .select('distributor_id, master_distributor_id')
        .eq('partner_id', user.partner_id)
        .maybeSingle()
      distributorId = retailerData?.distributor_id || null
      mdId = retailerData?.master_distributor_id || null
    }

    // ── Scheme + charges ───────────────────────────────────────────────────
    let charges = 0
    let resolvedSchemeId: string | null = null
    let resolvedSchemeName: string | null = null
    let resolvedVia: string | null = null
    let commissionSplit = { retailer_commission: 0, distributor_commission: 0, md_commission: 0 }
    let chargeModelData: { md_purchase_charge: number; dt_purchase_charge: number; rt_purchase_charge: number; company_cost: number; reverify?: any } | null = null

    try {
      const { data: schemeResult } = await (supabaseAdmin as any).rpc('resolve_scheme_for_user', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_service_type: 'payout',    // reuse existing payout scheme type
        p_distributor_id: distributorId,
        p_md_id: mdId,
      })
      if (schemeResult?.length > 0) {
        const resolved = schemeResult[0]
        resolvedSchemeId = resolved.scheme_id
        resolvedSchemeName = resolved.scheme_name
        resolvedVia = resolved.resolved_via

        const { data: chargeResult } = await (supabaseAdmin as any).rpc('calculate_payout_charge_from_scheme', {
          p_scheme_id: resolved.scheme_id,
          p_amount: amountNum,
          p_transfer_mode: paymentMode,
        })
        if (chargeResult?.length > 0 && parseFloat(chargeResult[0].retailer_charge) > 0) {
          charges = parseFloat(chargeResult[0].retailer_charge)
          commissionSplit = {
            retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
            distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
            md_commission: parseFloat(chargeResult[0].md_commission) || 0,
          }
          const mdPc = parseFloat(chargeResult[0].md_purchase_charge_val) || 0
          const dtPc = parseFloat(chargeResult[0].dt_purchase_charge_val) || 0
          const rtPc = parseFloat(chargeResult[0].rt_purchase_charge_val) || 0
          if (mdPc > 0 || dtPc > 0 || rtPc > 0) {
            chargeModelData = {
              md_purchase_charge: mdPc,
              dt_purchase_charge: dtPc,
              rt_purchase_charge: rtPc,
              company_cost: parseFloat(chargeResult[0].company_earning) || 0,
              reverify: { serviceKind: 'SETTLEMENT_1', scopeKey: paymentMode, category: null, amount: amountNum },
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Knteer Transfer] Scheme resolution failed:', e)
    }

    // Fallback — direct table query if RPC returned nothing
    if (!resolvedSchemeId) {
      const { data: mappings } = await supabaseAdmin
        .from('scheme_mappings')
        .select('scheme_id')
        .eq('entity_id', user.partner_id)
        .eq('entity_role', user.role)
        .eq('status', 'active')
        .limit(5)
      const schemeIds = (mappings || []).map((m: any) => m.scheme_id)
      if (schemeIds.length > 0) {
        resolvedSchemeId = schemeIds[0]
        const { data: slabs } = await supabaseAdmin
          .from('scheme_payout_charges')
          .select('*')
          .in('scheme_id', schemeIds)
          .eq('status', 'active')
          .lte('min_amount', amountNum)
          .gte('max_amount', amountNum)
          .limit(5)
        const slab = (slabs || []).find((s: any) => s.transfer_mode?.toUpperCase() === paymentMode)
        if (slab) {
          const calc = (v: number, t: string) => t === 'percentage' ? Math.round(amountNum * v / 100 * 100) / 100 : v
          charges = calc(parseFloat(slab.retailer_charge) || 0, slab.retailer_charge_type || 'flat')
          commissionSplit = {
            retailer_commission: calc(parseFloat(slab.retailer_commission) || 0, slab.retailer_commission_type),
            distributor_commission: calc(parseFloat(slab.distributor_commission) || 0, slab.distributor_commission_type),
            md_commission: calc(parseFloat(slab.md_commission) || 0, slab.md_commission_type),
          }
        }
      }
    }

    if (!resolvedSchemeId) {
      console.error(`[Knteer Transfer] BLOCKED: No scheme for user=${user.partner_id}`)
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
      return addCorsHeaders(request, NextResponse.json(SCHEME_NOT_ASSIGNED, { status: SCHEME_NOT_ASSIGNED_STATUS }))
    }

    const slabOk = await hasCoveringPayoutSlab(supabaseAdmin, resolvedSchemeId, amountNum, paymentMode)
    if (!slabOk) {
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
      return addCorsHeaders(request, NextResponse.json(SCHEME_NO_VALID_SLAB, { status: SCHEME_NOT_ASSIGNED_STATUS }))
    }

    // ── Beneficiary verification charge (₹4 + 18% GST = ₹4.72 for new accounts) ──
    const BENE_FEE_BASE = 4
    const BENE_FEE_GST  = Math.round(BENE_FEE_BASE * 18 / 100 * 100) / 100  // 0.72
    const BENE_FEE      = BENE_FEE_BASE + BENE_FEE_GST                       // 4.72

    const { data: existingBene } = await supabaseAdmin
      .from('knteer_beneficiaries')
      .select('bene_code')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', accountNumber)
      .eq('ifsc_code', ifscCode)
      .eq('is_active', true)
      .maybeSingle()

    const isNewBene = !existingBene?.bene_code
    const verificationCharge = isNewBene ? BENE_FEE : 0

    const totalRequired = amountNum + charges + verificationCharge

    // ── Wallet balance check ───────────────────────────────────────────────
    const walletRpc = user.role === 'partner' ? 'get_partner_wallet_balance' : 'get_wallet_balance'
    const walletParam = user.role === 'partner' ? { p_partner_id: user.partner_id } : { p_retailer_id: user.partner_id }
    const { data: walletBalance, error: balErr } = await (supabaseAdmin as any).rpc(walletRpc, walletParam)
    if (balErr || walletBalance === null) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Failed to check wallet balance' }, { status: 500 }))
    }
    if (walletBalance < totalRequired) {
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
      return addCorsHeaders(request, NextResponse.json({
        success: false,
        error: `Insufficient balance. Required: ₹${totalRequired.toFixed(2)} (₹${amountNum} transfer + ₹${charges} charges${verificationCharge > 0 ? ` + ₹${verificationCharge} verification fee` : ''}). Available: ₹${walletBalance.toFixed(2)}`,
        wallet_balance: walletBalance,
        required: totalRequired,
        charges,
        verification_charge: verificationCharge,
      }, { status: 400 }))
    }

    // ── Provider balance check ─────────────────────────────────────────────
    const providerBal = await getKnteerBalance()
    if (!providerBal.success || (providerBal.usable_balance ?? 0) < amountNum) {
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Payout service temporarily unavailable. Please try again later.' }, { status: 503 }))
    }

    // ── 60-second cooldown — block ANY transfer to same account after SUCCESS ──
    const COOLDOWN_SECONDS = 60
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString()
    const { data: recentSuccessTx } = await supabaseAdmin
      .from('knteer_payout_transactions')
      .select('id, status, created_at, amount')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', accountNumber)
      .gte('created_at', cooldownCutoff)
      .eq('status', 'SUCCESS')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentSuccessTx) {
      const secsAgo = Math.round((Date.now() - new Date(recentSuccessTx.created_at).getTime()) / 1000)
      const remaining = Math.max(1, COOLDOWN_SECONDS - secsAgo)
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
      return addCorsHeaders(request, NextResponse.json({
        success: false,
        error: `Please wait ${remaining} seconds before making another transfer to this account.`,
        cooldown_seconds: remaining,
      }, { status: 429 }))
    }

    // ── Duplicate prevention — same account PENDING within 15 minutes ────────
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { data: recentPendingTx } = await supabaseAdmin
      .from('knteer_payout_transactions')
      .select('id, partner_trans_id, status, created_at, amount')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', accountNumber)
      .gte('created_at', fifteenMinAgo)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentPendingTx) {
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
      return addCorsHeaders(request, NextResponse.json({
        success: false,
        error: 'A payout to this account is already processing. Please wait for it to complete or check its status before retrying.',
        error_code: 'TRANSFER_IN_PROGRESS',
        existing_transaction_id: recentPendingTx.id,
        existing_partner_trans_id: recentPendingTx.partner_trans_id,
        existing_amount: recentPendingTx.amount,
      }, { status: 429 }))
    }

    // ── Idempotency ────────────────────────────────────────────────────────
    if (idemKey) {
      const reservation = await reserveIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, userId: user.partner_id })
      if (!reservation.fresh) {
        if (reservation.status === 'completed' && reservation.cachedResponse) {
          return addCorsHeaders(request, NextResponse.json(reservation.cachedResponse))
        }
        return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Request already processing.', code: 'IDEMPOTENT_REPLAY' }, { status: 409 }))
      }
    }

    // ── Generate unique partnerTransId ─────────────────────────────────────
    const partnerTransId = generateRefId()    // KNT<timestamp><random>

    // ── Create DB record ───────────────────────────────────────────────────
    const { data: txRecord, error: txError } = await supabaseAdmin
      .from('knteer_payout_transactions')
      .insert({
        retailer_id: user.partner_id,
        user_role: user.role,
        account_number: accountNumber,
        ifsc_code: ifscCode,
        account_holder_name: accountHolderName,
        bank_name: bankName,
        email: email || '',
        mobile: String(mobile),
        amount: amountNum,
        charges,
        verification_charge: verificationCharge,
        is_new_beneficiary: isNewBene,
        total_debit: totalRequired,
        payment_mode: paymentMode,
        partner_trans_id: partnerTransId,
        status: 'PENDING',
        remarks: remarks || null,
        narration: remarks || `Knteer payout to ${accountHolderName}`,
        scheme_id: resolvedSchemeId,
        scheme_name: resolvedSchemeName,
        resolved_via: resolvedVia,
        distributor_id: distributorId,
        md_id: mdId,
        distributor_commission: commissionSplit.distributor_commission,
        md_commission: commissionSplit.md_commission,
      })
      .select()
      .single()

    if (txError || !txRecord) {
      console.error('[Knteer Transfer] DB insert failed:', txError)
      if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Failed to create transaction record' }, { status: 500 }))
    }

    // ── Debit wallet ───────────────────────────────────────────────────────
    const debitDesc = `Knteer payout ₹${amountNum}${charges > 0 ? ` + charge ₹${charges}` : ''}${verificationCharge > 0 ? ` + verification ₹${verificationCharge}` : ''} to ${accountNumber} (${accountHolderName})`
    let transferLedgerId: string | null = null

    if (user.role === 'partner') {
      const { data, error } = await (supabaseAdmin as any).rpc('debit_partner_wallet', {
        p_partner_id: user.partner_id,
        p_amount: totalRequired,
        p_description: debitDesc,
        p_reference_id: `${partnerTransId}_TRANSFER`,
        p_service_type: 'knteer_payout',
      })
      if (error) {
        await supabaseAdmin.from('knteer_payout_transactions').update({ status: 'FAILED', status_message: 'Wallet debit failed' }).eq('id', txRecord.id)
        if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
        return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Failed to debit wallet' }, { status: 500 }))
      }
      transferLedgerId = data
    } else {
      const { data, error } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: user.partner_id,
        p_user_role: user.role,
        p_wallet_type: 'primary',
        p_fund_category: 'service',
        p_service_type: 'knteer_payout',
        p_tx_type: 'KNTEER_PAYOUT_DEBIT',
        p_credit: 0,
        p_debit: totalRequired,
        p_reference_id: `${partnerTransId}_TRANSFER`,
        p_transaction_id: txRecord.id,
        p_status: 'completed',
        p_remarks: debitDesc,
      })
      if (error) {
        await supabaseAdmin.from('knteer_payout_transactions').update({ status: 'FAILED', status_message: 'Wallet debit failed' }).eq('id', txRecord.id)
        if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
        return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Failed to debit wallet' }, { status: 500 }))
      }
      transferLedgerId = data
    }

    // Persist actual debit amount
    await supabaseAdmin
      .from('knteer_payout_transactions')
      .update({ actual_wallet_debit: totalRequired, transfer_ledger_id: transferLedgerId, wallet_debited: true })
      .eq('id', txRecord.id)

    // ── Commission distribution with 2% TDS (optimistic — reversed on failure) ─
    const TDS_RATE = 2
    if (charges > 0) {
      const commResult = await distributeServiceCommission({
        supabase: supabaseAdmin,
        service: 'knteer_payout',
        refPrefix: 'KNTEER',
        refKey: partnerTransId,
        transactionUuid: txRecord.id,
        totalCharge: charges,
        retailer: { id: user.partner_id, role: user.role, commission: commissionSplit.retailer_commission },
        distributor: { id: distributorId, commission: commissionSplit.distributor_commission },
        masterDistributor: { id: mdId },
        chargeModel: chargeModelData,
        tdsRate: TDS_RATE,
        remarksSuffix: `on ₹${amountNum} knteer payout`,
        auditWriteback: {
          table: 'knteer_payout_transactions',
          txnId: txRecord.id,
          retailerCol: 'retailer_commission_earned',
          distributorCol: 'distributor_commission',
          mdCol: 'md_commission',
          companyCol: 'company_earning',
        },
      })
      if (commResult.errors.length) {
        console.error('[Knteer Transfer] Commission errors:', commResult.errors)
      } else {
        console.log(`[Knteer Transfer] ✅ Commission: DT ₹${commResult.distributorCredited}, MD ₹${commResult.mdCredited}, Company ₹${commResult.companyCredited}, TDS ₹${commResult.tdsDeducted}`)
        // Record TDS in transaction
        await supabaseAdmin
          .from('knteer_payout_transactions')
          .update({ tds_amount: commResult.tdsDeducted, tds_rate: TDS_RATE })
          .eq('id', txRecord.id)
      }
    }

    // ── Initiate transfer via Knteer ───────────────────────────────────────
    console.log('[Knteer Transfer] Initiating:', { partnerTransId, amount: amountNum, account: accountNumber.slice(-4), mode: paymentMode })

    const transferResult = await initiateKnteerTransfer({
      supabase: supabaseAdmin,
      retailerId: user.partner_id,
      partnerTransId,
      beneDetails: {
        email: email || `${user.partner_id}@knteer.payout`,
        mobile: String(mobile),
        beneName: accountHolderName,
        accountNumber,
        bankName,
        ifsc: ifscCode,
      },
      amount: amountNum,
      paymentMode: paymentMode as 'IMPS' | 'NEFT',
      remark: remarks || `Payout ${partnerTransId}`,
    })

    const isSuccess = transferResult.status === 'success'
    const isPending = transferResult.is_indeterminate || transferResult.status === 'pending'
    const isDefinitiveFail = !isSuccess && !isPending

    // ── Handle definitive failure — refund wallet + reverse commission ─────
    if (isDefinitiveFail) {
      const refund = await refundKnteerPayout(supabaseAdmin, {
        ...txRecord,
        user_role: user.role,
        actual_wallet_debit: totalRequired,
        partner_trans_id: partnerTransId,
      }, { skipProviderCheck: true })
      if (refund.critical) console.error('[Knteer Transfer] CRITICAL refund failed:', { txId: txRecord.id, error: refund.error })

      const refundSucceeded = refund.refunded || refund.alreadyRefunded

      if (charges > 0) {
        await reverseServiceCommission({
          supabase: supabaseAdmin,
          service: 'knteer_payout',
          refPrefix: 'KNTEER',
          refKey: partnerTransId,
          transactionUuid: txRecord.id,
        })
      }

      // ── Re-update DB after refund status is known ────────────────────────
      await supabaseAdmin
        .from('knteer_payout_transactions')
        .update({
          status_message: refundSucceeded
            ? `${transferResult.error || 'Transfer failed'} [Wallet refunded]`
            : `${transferResult.error || 'Transfer failed'} [REFUND FAILED — manual action required]`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', txRecord.id)
    }

    // ── Update DB with provider response ───────────────────────────────────
    await supabaseAdmin
      .from('knteer_payout_transactions')
      .update({
        status: isSuccess ? 'SUCCESS' : isDefinitiveFail ? 'FAILED' : 'PENDING',
        status_id: transferResult.status_id || null,
        knteer_trans_id: transferResult.knteer_trans_id || null,
        utr: transferResult.utr || null,
        status_message: isDefinitiveFail
          ? null  // set by the refund block above
          : isPending && transferResult.is_indeterminate
            ? `${transferResult.error || 'Awaiting confirmation'} [PENDING — verifying with provider]`
            : isSuccess ? `SUCCESS — UTR ${transferResult.utr}` : null,
        completed_at: isSuccess ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', txRecord.id)

    const responseBody = {
      success: true,
      message: isSuccess
        ? 'Transfer successful'
        : isDefinitiveFail
          ? 'Transfer failed'
          : 'Transfer initiated. Processing may take a few minutes.',
      transaction_id: txRecord.id,
      partner_trans_id: partnerTransId,
      knteer_trans_id: transferResult.knteer_trans_id || null,
      utr: transferResult.utr || null,
      status: isSuccess ? 'SUCCESS' : isDefinitiveFail ? 'FAILED' : 'PENDING',
      amount: amountNum,
      charges,
      verification_charge: verificationCharge,
      is_new_beneficiary: isNewBene,
      total_debited: totalRequired,
      payment_mode: paymentMode,
      account_number: accountNumber.replace(/\d(?=\d{4})/g, '*'),
      account_holder_name: accountHolderName,
      bank_name: bankName,
      ...(resolvedSchemeName ? { scheme_name: resolvedSchemeName } : {}),
    }

    // Only definitive failures are retryable; PENDING money is in-flight
    if (idemKey) {
      await finalizeIdempotencyKey({
        scope: IDEM_SCOPE,
        key: idemKey,
        status: isDefinitiveFail ? 'failed' : 'completed',
        response: isDefinitiveFail ? undefined : responseBody,
      })
    }

    return addCorsHeaders(request, NextResponse.json(responseBody, { status: isDefinitiveFail ? 400 : 200 }))
  } catch (err: any) {
    console.error('[Knteer Transfer] Unhandled error:', err)
    if (idemKey) await finalizeIdempotencyKey({ scope: IDEM_SCOPE, key: idemKey, status: 'failed' }).catch(() => {})
    return addCorsHeaders(request, NextResponse.json({ success: false, error: toUserSafeError(err?.message, 'Transfer failed') }, { status: 500 }))
  }
}
