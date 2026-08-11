import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { checkTransactionStatus } from '@/services/shadval-pay'
import { sendSettlementCallback } from '@/lib/settlement-callback'
import { refundShadvalSettlement, computeShadvalRefundAmount } from '@/lib/settlement-2/shadval-refund'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Sub-admins authenticate with role 'admin'; finance executives are also allowed.
const ALLOWED_ROLES = ['admin', 'finance_executive']

const SELECT_COLS =
  'id, retailer_id, reference_id, order_id, status, status_message, amount, charges, total_debit, actual_wallet_debit, utr, account_holder_name, account_number, ifsc_code, mode, created_at'

type ItemResult = {
  identifier: string
  found: boolean
  order_id?: string
  reference_id?: string
  retailer_id?: string
  beneficiary?: string
  amount?: number
  db_status?: string
  target?: 'partner' | 'retailer' | 'none'
  result:
    | 'refunded'
    | 'already_refunded'
    | 'reconciled_success'
    | 'skipped_success'
    | 'critical_refund_failed'
    | 'not_found'
    | 'error'
  message?: string
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * POST /api/admin/reversal/shadval-refund
 *
 * Admin/sub-admin tool to refund one or many Shadval settlement (Settlement-2 /
 * payout) transactions that are stuck PENDING or FAILED but were refunded on the
 * provider side. Reuses refundShadvalSettlement() — the single exactly-once
 * source of truth — so re-running is always safe (never double-credits).
 *
 * Body: {
 *   identifiers: string[]   // order_id (APITXN...) and/or reference_id (SV2_/PSV2_...)
 *   dryRun?: boolean        // look up + classify without crediting
 *   verifyProvider?: boolean // default true: never refund a genuine provider SUCCESS
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Shadval Refund] Auth:', method, '|', admin?.email || 'none', '|', admin?.role)

    if (!admin) {
      return NextResponse.json(
        { success: false, error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
    }
    if (!ALLOWED_ROLES.includes(admin.role as string)) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const rawIdentifiers: unknown = body.identifiers
    const dryRun: boolean = body.dryRun === true
    const verifyProvider: boolean = body.verifyProvider !== false // default true

    // Normalize: accept array or newline/comma separated string, dedupe, trim.
    let identifiers: string[] = []
    if (Array.isArray(rawIdentifiers)) {
      identifiers = rawIdentifiers.map((s) => String(s).trim())
    } else if (typeof rawIdentifiers === 'string') {
      identifiers = rawIdentifiers.split(/[\s,]+/).map((s) => s.trim())
    }
    identifiers = Array.from(new Set(identifiers.filter(Boolean)))

    if (identifiers.length === 0) {
      return NextResponse.json({ success: false, error: 'No transaction identifiers provided' }, { status: 400 })
    }
    if (identifiers.length > 200) {
      return NextResponse.json({ success: false, error: 'Too many identifiers (max 200 per request)' }, { status: 400 })
    }

    const supabase = getSupabase()

    // Fetch by order_id and reference_id, then merge (an identifier may match either).
    const [{ data: byOrder }, { data: byRef }] = await Promise.all([
      supabase.from('shadval_settlement').select(SELECT_COLS).in('order_id', identifiers),
      supabase.from('shadval_settlement').select(SELECT_COLS).in('reference_id', identifiers),
    ])

    const rowsById = new Map<string, any>()
    for (const r of [...(byOrder || []), ...(byRef || [])]) rowsById.set(r.id, r)

    // Map each input identifier to its settlement row.
    const matchFor = (id: string) =>
      Array.from(rowsById.values()).find((r) => r.order_id === id || r.reference_id === id)

    const results: ItemResult[] = []
    let refunded = 0
    let alreadyRefunded = 0
    let reconciled = 0
    let skipped = 0
    let critical = 0
    let notFound = 0
    let totalRefundedAmount = 0

    const ipAddress =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

    for (const identifier of identifiers) {
      const tx = matchFor(identifier)

      if (!tx) {
        notFound++
        results.push({ identifier, found: false, result: 'not_found', message: 'No settlement found for this ID' })
        continue
      }

      const refundAmount = computeShadvalRefundAmount(tx)
      const base: ItemResult = {
        identifier,
        found: true,
        order_id: tx.order_id,
        reference_id: tx.reference_id,
        retailer_id: tx.retailer_id,
        beneficiary: tx.account_holder_name,
        amount: refundAmount,
        db_status: tx.status,
        result: 'error',
      }

      // Authoritative account type (partners table is the source of truth).
      const { data: partnerRow } = tx.reference_id
        ? await supabase.from('partners').select('id').eq('id', tx.retailer_id).maybeSingle()
        : { data: null }
      const target: 'partner' | 'retailer' = partnerRow ? 'partner' : 'retailer'

      // STEP 1 — Has the wallet already been credited for this transaction?
      // This takes precedence over EVERYTHING: if the money is already back we
      // never touch it again, and we never let a later provider "success" reading
      // flip a genuinely-refunded row to SUCCESS.
      if (tx.reference_id) {
        const refRef = `REFUND_${tx.reference_id}`
        const legacyRef = `REFUND_TIMEOUT_${tx.reference_id}`
        const ledgerTable = target === 'partner' ? 'partner_wallet_ledger' : 'wallet_ledger'
        const idCol = target === 'partner' ? 'partner_id' : 'retailer_id'
        const { data: existingRefund } = await supabase
          .from(ledgerTable)
          .select('id')
          .eq(idCol, tx.retailer_id)
          .in('reference_id', [refRef, legacyRef])
          .gt('credit', 0)
          .limit(1)

        if (existingRefund && existingRefund.length > 0) {
          // Already refunded — make sure the settlement row reflects it, then stop.
          if (!dryRun && tx.status !== 'SUCCESS') {
            await supabase
              .from('shadval_settlement')
              .update({
                status: 'FAILED',
                status_message: `${tx.status_message || ''} [Wallet refunded]`.trim(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', tx.id)
          }
          alreadyRefunded++
          results.push({ ...base, target, result: 'already_refunded', message: 'Wallet was already credited — no action taken' })
          continue
        }
      }

      // STEP 2 — Not yet refunded. Safety net: only SKIP the refund if the provider
      // reports a GENUINE terminal success. Aligned with settlement-2/status: a
      // status that mentions refund/reversal/fail/pending/initiated is NOT a
      // success, and a real success always carries a UTR.
      // We also record whether the provider ACTIVELY confirmed a non-success so
      // STEP 3 can decide if it's safe to refund a row that is SUCCESS in our DB.
      let providerConfirmedNotSuccess = false
      if (verifyProvider && tx.reference_id) {
        try {
          const statusResult = await checkTransactionStatus({ reference_id: tx.reference_id })
          const s = (statusResult?.data?.txn_status || '').toLowerCase()
          const hasUtr = !!statusResult?.data?.utr
          const providerSuccess =
            statusResult?.status === 'SUCCESS' &&
            s.includes('success') &&
            !s.includes('refund') &&
            !s.includes('revers') &&
            !s.includes('fail') &&
            !s.includes('initiat') &&
            !s.includes('pending') &&
            !s.includes('process') &&
            hasUtr

          if (providerSuccess) {
            if (!dryRun) {
              // Reconcile our record to SUCCESS. Already-refunded rows were
              // handled in STEP 1, so any row reaching here is safe to flip
              // regardless of its current status (PENDING or FAILED).
              await supabase
                .from('shadval_settlement')
                .update({
                  status: 'SUCCESS',
                  utr: statusResult.data?.utr || tx.utr || null,
                  status_message: statusResult.data?.status_message || 'Transaction Successful (reconciled)',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', tx.id)
            }
            reconciled++
            results.push({
              ...base,
              target,
              result: 'reconciled_success',
              message: `Provider reports genuine SUCCESS (UTR ${statusResult.data?.utr}) — not refunded.`,
            })
            continue
          }
          providerConfirmedNotSuccess = true
        } catch (e: any) {
          // Provider check failed — fall through and let the admin's manual decision stand.
          console.warn(`[Shadval Refund] Provider status check failed for ${tx.reference_id}:`, e?.message)
        }
      }

      // STEP 3 — Never refund a settlement that is SUCCESS in our DB unless the
      // provider has ACTIVELY confirmed it is not a genuine success. This blocks
      // double-payment when verifyProvider is disabled or the status check threw
      // (both of which would otherwise fall straight through to a refund).
      if (tx.status === 'SUCCESS' && !providerConfirmedNotSuccess) {
        skipped++
        results.push({
          ...base,
          target,
          result: 'skipped_success',
          message:
            'Settlement is SUCCESS — refused to refund without provider confirmation of failure/reversal. Re-run with verifyProvider enabled.',
        })
        continue
      }

      if (dryRun) {
        results.push({ ...base, target: undefined, result: 'refunded', message: 'DRY RUN — would refund' })
        totalRefundedAmount += refundAmount
        refunded++
        continue
      }

      const refund = await refundShadvalSettlement(supabase, tx, { note: `admin manual by ${admin.email}` })

      if (refund.critical) {
        critical++
        await supabase
          .from('shadval_settlement')
          .update({
            status: 'FAILED',
            status_message: `${tx.status_message || ''} [CRITICAL: REFUND_FAILED - Manual review required] (${refund.error})`.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', tx.id)
        results.push({ ...base, target: refund.target, result: 'critical_refund_failed', message: refund.error })
        continue
      }

      // Mark the settlement FAILED + wallet refunded (idempotent update).
      const newMsg = `${tx.status_message || ''} [Wallet refunded]`.trim()
      await supabase
        .from('shadval_settlement')
        .update({ status: 'FAILED', status_message: newMsg, updated_at: new Date().toISOString() })
        .eq('id', tx.id)

      // Fire partner callback (best-effort) so downstream partners learn it failed.
      sendSettlementCallback(tx.retailer_id, { ...tx, status: 'FAILED', status_message: newMsg }).catch(() => {})

      // Audit trail.
      supabase
        .from('admin_audit_log')
        .insert({
          admin_id: admin.id,
          action_type: 'shadval_settlement_refund',
          target_user_id: tx.retailer_id,
          target_user_role: refund.target === 'partner' ? 'partner' : 'retailer',
          wallet_type: 'primary',
          amount: refund.refunded,
          before_balance: 0,
          after_balance: 0,
          ip_address: ipAddress,
          user_agent: request.headers.get('user-agent') || 'unknown',
          remarks: `Shadval settlement manual refund (${refund.alreadyRefunded ? 'already refunded' : 'credited'})`,
          metadata: {
            order_id: tx.order_id,
            reference_id: tx.reference_id,
            target: refund.target,
            db_status_before: tx.status,
          },
        })
        .then(() => {})

      if (refund.alreadyRefunded) {
        alreadyRefunded++
        results.push({ ...base, target: refund.target, result: 'already_refunded', message: 'Wallet was already credited' })
      } else {
        refunded++
        totalRefundedAmount += refund.refunded
        results.push({ ...base, target: refund.target, result: 'refunded', message: `Credited ₹${refund.refunded.toFixed(2)}` })
      }
    }

    if (!dryRun) {
      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, admin, {
        activity_type: 'admin_shadval_bulk_refund',
        activity_category: 'admin',
        reference_table: 'shadval_settlement',
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      dryRun,
      summary: {
        total: identifiers.length,
        refunded,
        already_refunded: alreadyRefunded,
        reconciled_success: reconciled,
        skipped_success: skipped,
        critical_failed: critical,
        not_found: notFound,
        total_refunded_amount: Number(totalRefundedAmount.toFixed(2)),
      },
      results,
    })
  } catch (error: any) {
    console.error('[Shadval Refund] Error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 })
  }
}
