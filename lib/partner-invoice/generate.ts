import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { validatePartnerTxnForSettlement } from '@/lib/partner-settlement'
import { calculatePartnerMDR } from '@/lib/mdr-scheme/settlement.service'

export interface InvoiceBreakdownRow {
  payment_mode: string
  card_type: string
  card_brand: string
  txn_count: number
  gross: number
  mdr: number
  net: number
}

export interface InvoiceComputation {
  partner_id: string
  period_start: string
  period_end: string
  transaction_value: number
  txn_count: number
  service_charge: number
  net_payable: number
  breakdown: InvoiceBreakdownRow[]
}

const PAGE = 1000

/**
 * Aggregate a partner's settleable POS business over a period into invoice
 * totals plus a per (mode / card_type / brand) breakdown.
 *
 * MDR (service charge) preference per transaction:
 *   1. stored partner_mdr_amount when already computed (settled txns)
 *   2. freshly computed via calculatePartnerMDR at the txn's settlement type
 *
 * Deducted-at-source model: net = gross - mdr.
 */
export async function computePartnerInvoice(
  partnerId: string,
  periodStart: string,
  periodEnd: string
): Promise<InvoiceComputation> {
  const supabase = getSupabaseAdmin()

  // Inclusive end-of-day for the period end date
  const startISO = new Date(`${periodStart}T00:00:00.000Z`).toISOString()
  const endISO = new Date(`${periodEnd}T23:59:59.999Z`).toISOString()

  const groups = new Map<string, InvoiceBreakdownRow>()
  let totalGross = 0
  let totalMdr = 0
  let totalCount = 0

  let from = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('razorpay_pos_transactions')
      .select(
        'id, txn_id, amount, gross_amount, partner_mdr_amount, partner_net_amount, ' +
          'payment_mode, card_type, card_brand, merchant_slug, display_status, txn_type, ' +
          'settlement_type, transaction_time, created_at'
      )
      .eq('partner_id', partnerId)
      .gte('transaction_time', startISO)
      .lte('transaction_time', endISO)
      .order('transaction_time', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(`Failed to load partner transactions: ${error.message}`)
    const rows = (data as any[]) || []
    if (rows.length === 0) break

    for (const tx of rows) {
      const gate = validatePartnerTxnForSettlement({
        display_status: tx.display_status,
        txn_type: tx.txn_type,
        gross_amount: tx.gross_amount,
        amount: tx.amount,
      })
      if (!gate.ok) continue

      const gross = parseFloat(String(tx.gross_amount ?? tx.amount ?? 0))
      if (!(gross > 0)) continue

      // Prefer the MDR already charged; otherwise compute it fresh.
      let mdr = tx.partner_mdr_amount != null ? parseFloat(String(tx.partner_mdr_amount)) : NaN
      if (!(mdr >= 0)) {
        const settlementType = tx.settlement_type === 'T0' ? 'T0' : 'T1'
        const mdrResult = await calculatePartnerMDR(
          partnerId,
          gross,
          settlementType,
          tx.payment_mode || 'CARD',
          tx.card_type || undefined,
          tx.card_brand || undefined,
          tx.merchant_slug || null
        )
        mdr = mdrResult.success ? mdrResult.partner_fee || 0 : 0
      }

      const net = Math.max(gross - mdr, 0)

      totalGross += gross
      totalMdr += mdr
      totalCount += 1

      const mode = (tx.payment_mode || 'UNKNOWN').toUpperCase()
      const cardType = (tx.card_type || '-').toUpperCase()
      const brand = (tx.card_brand || '-').toUpperCase()
      const key = `${mode}|${cardType}|${brand}`
      const row = groups.get(key)
      if (row) {
        row.txn_count += 1
        row.gross += gross
        row.mdr += mdr
        row.net += net
      } else {
        groups.set(key, {
          payment_mode: mode,
          card_type: cardType,
          card_brand: brand,
          txn_count: 1,
          gross,
          mdr,
          net,
        })
      }
    }

    if (rows.length < PAGE) break
    from += PAGE
  }

  const round = (n: number) => Math.round(n * 100) / 100
  const breakdown = Array.from(groups.values())
    .map((r) => ({
      ...r,
      gross: round(r.gross),
      mdr: round(r.mdr),
      net: round(r.net),
    }))
    .sort((a, b) => b.gross - a.gross)

  const transactionValue = round(totalGross)
  const serviceCharge = round(totalMdr)

  return {
    partner_id: partnerId,
    period_start: periodStart,
    period_end: periodEnd,
    transaction_value: transactionValue,
    txn_count: totalCount,
    service_charge: serviceCharge,
    net_payable: round(transactionValue - serviceCharge),
    breakdown,
  }
}

/** Build a human-friendly invoice number like INV-JMPNEXTGEN-2026-08. */
export function buildInvoiceNumber(partnerName: string, periodStart: string): string {
  const slug = (partnerName || 'PARTNER')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10) || 'PARTNER'
  const d = new Date(`${periodStart}T00:00:00.000Z`)
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  return `INV-${slug}-${ym}`
}
