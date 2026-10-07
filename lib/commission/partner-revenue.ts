import type { SupabaseClient } from '@supabase/supabase-js'
import { distributeServiceCommission } from '@/lib/commission/distribute-service-commission'

/**
 * Partner (API) company-revenue booking.
 *
 * Partners have no downline, so md = dt = rt = the partner's EX-GST base charge
 * (zero downline margin) and company revenue = base charge − live vendor cost.
 * GST collected from the partner is a pass-through liability and must never be
 * counted as revenue, so callers must pass the ex-GST base charge.
 *
 * Booking is idempotent per (prefix, refKey): `<PREFIX>-REV-<refKey>` in
 * `wallet_ledger`, so inline booking, status-resolvers and the sweeper can all
 * call it for the same transaction without double-crediting.
 */

export type PartnerRevenueService = 'pay2new' | 'rechargekit' | 'shadval_settlement' | 'payout'

interface ServiceCfg {
  prefix: string
  serviceKind: 'BBPS' | 'PAYOUT'
  category: string | null
}

export const PARTNER_REVENUE_SERVICES: Record<PartnerRevenueService, ServiceCfg> = {
  pay2new: { prefix: 'P2N', serviceKind: 'BBPS', category: 'Credit Card' },
  rechargekit: { prefix: 'RKCC', serviceKind: 'BBPS', category: 'Credit Card' },
  shadval_settlement: { prefix: 'SHADVAL', serviceKind: 'PAYOUT', category: null },
  payout: { prefix: 'PAYOUT', serviceKind: 'PAYOUT', category: null },
}

export interface BookPartnerRevenueInput {
  supabase: SupabaseClient
  service: PartnerRevenueService
  partnerId: string
  refKey: string
  /** Ex-GST base charge the partner paid. */
  baseCharge: number
  /** Bill / transfer amount (used for live vendor-cost lookup). */
  amount: number
  /** Transfer mode for payout-kind services (IMPS/NEFT/...). */
  mode?: string | null
  transactionUuid?: string | null
  remarksSuffix?: string
}

export async function bookPartnerRevenue(input: BookPartnerRevenueInput): Promise<{ errors: string[] }> {
  const cfg = PARTNER_REVENUE_SERVICES[input.service]
  const charge = Math.round((Number(input.baseCharge) || 0) * 100) / 100
  if (!(charge > 0)) return { errors: [] }

  const res = await distributeServiceCommission({
    supabase: input.supabase,
    service: input.service,
    refPrefix: cfg.prefix,
    refKey: input.refKey,
    transactionUuid: input.transactionUuid ?? null,
    totalCharge: charge,
    retailer: { id: input.partnerId, role: 'partner', commission: 0 },
    distributor: null,
    chargeModel: {
      rt_purchase_charge: charge,
      dt_purchase_charge: charge,
      md_purchase_charge: charge,
      company_cost: 0,
      reverify: {
        serviceKind: cfg.serviceKind,
        scopeKey: cfg.serviceKind === 'PAYOUT' ? input.mode || null : null,
        category: cfg.category,
        amount: input.amount,
      },
    },
    remarksSuffix: input.remarksSuffix,
  })
  return { errors: res.errors || [] }
}

/* ------------------------------------------------------------------ */
/* Sweeper: guarantees one revenue entry per successful partner txn    */
/* ------------------------------------------------------------------ */

const GST_DIVISOR = 1.18
const round2 = (n: number) => Math.round(n * 100) / 100

interface Candidate {
  refKey: string
  partnerId: string
  amount: number
  baseCharge: number
  mode?: string | null
  transactionUuid?: string | null
  createdAt: string
}

export interface PartnerRevenueSweepResult {
  service: PartnerRevenueService
  scanned: number
  alreadyBooked: number
  missing: number
  missingBaseCharge: number
  booked: number
  failed: number
  capped: boolean
  sample: Array<{ ref: string; partnerId: string; amount: number; baseCharge: number; createdAt: string }>
}

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const out: T[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/** Resolves whether a partner's BBPS slab is GST-inclusive, with in-memory caches. */
function makeBbpsGstResolver(supabase: SupabaseClient) {
  const schemeByPartner = new Map<string, string | null>()
  const slabsByScheme = new Map<string, any[]>()

  const schemeFor = async (partnerId: string) => {
    if (schemeByPartner.has(partnerId)) return schemeByPartner.get(partnerId)!
    let id: string | null = null
    try {
      const { data } = await (supabase as any).rpc('resolve_scheme_for_user', {
        p_user_id: partnerId,
        p_user_role: 'partner',
        p_service_type: 'bbps',
        p_distributor_id: null,
        p_md_id: null,
      })
      id = data?.[0]?.scheme_id ?? null
    } catch {
      id = null
    }
    schemeByPartner.set(partnerId, id)
    return id
  }

  const slabsFor = async (schemeId: string) => {
    if (slabsByScheme.has(schemeId)) return slabsByScheme.get(schemeId)!
    const { data } = await (supabase as any)
      .from('scheme_bbps_commissions')
      .select('category, min_amount, max_amount, gst_inclusive, rt_purchase_charge, rt_purchase_charge_type, retailer_charge, retailer_charge_type')
      .eq('scheme_id', schemeId)
      .eq('status', 'active')
      .order('min_amount', { ascending: false })
    slabsByScheme.set(schemeId, data || [])
    return data || []
  }

  /**
   * Derive the ex-GST base charge from the TOTAL charge debited. The slab's
   * gst_inclusive flag may have been edited after the transaction, so the flag is
   * only a fallback: first match the total against the slab's base (no GST) or
   * base + 18% (GST).
   */
  return async (partnerId: string, amount: number, category: string, total: number): Promise<number> => {
    const schemeId = await schemeFor(partnerId)
    if (!schemeId) return total
    const slabs = (await slabsFor(schemeId)).filter(
      (s: any) => Number(s.min_amount) <= amount && Number(s.max_amount) >= amount
    )
    const best =
      slabs.find((s: any) => {
        const sc = s.category
        return !sc || sc === '' || sc.toLowerCase() === 'all' || sc.toLowerCase() === 'all categories' || sc === category
      }) || slabs[0]
    if (!best) return total

    const rtPc = Number(best.rt_purchase_charge) || 0
    const raw = rtPc > 0 ? rtPc : Number(best.retailer_charge) || 0
    const type = rtPc > 0 ? best.rt_purchase_charge_type || 'flat' : best.retailer_charge_type
    const slabBase = type === 'percentage' ? round2((amount * raw) / 100) : raw
    if (slabBase > 0) {
      if (Math.abs(total - slabBase) <= 0.02) return total
      if (Math.abs(round2(slabBase * GST_DIVISOR) - total) <= 0.02) return slabBase
    }
    return best.gst_inclusive ? round2(total / GST_DIVISOR) : total
  }
}

function parseDebitDescription(desc: string | null): { amount: number; charge: number } | null {
  const m = desc?.match(/₹([\d.]+)\s*\+\s*₹([\d.]+)\s*charge/)
  if (!m) return null
  return { amount: parseFloat(m[1]), charge: parseFloat(m[2]) }
}

/**
 * Derive the ex-GST Settlement-2 base charge from the stored total `charges`
 * (which includes GST only when the partner's slab was GST-inclusive).
 */
export async function deriveSettlementBaseCharge(
  supabase: SupabaseClient,
  partnerId: string,
  amount: number,
  mode: string,
  totalCharge: number
): Promise<number> {
  try {
    const { resolveShadvalCharge } = await import('@/lib/shadval-charge')
    const { getShadvalSlabGstInclusive } = await import('@/lib/scheme-gst')
    const live = await resolveShadvalCharge(supabase, partnerId, amount, mode)
    if (live.baseCharge > 0) {
      if (Math.abs(live.baseCharge - totalCharge) <= 0.02) return live.baseCharge
      if (Math.abs(round2(live.baseCharge * GST_DIVISOR) - totalCharge) <= 0.02) return live.baseCharge
    }
    if (live.schemeId && (await getShadvalSlabGstInclusive(supabase, live.schemeId, amount, mode))) {
      return round2(totalCharge / GST_DIVISOR)
    }
  } catch {
    /* fall through */
  }
  return totalCharge
}

/** Book revenue for a resolved (SUCCESS) partner Settlement-2 row. Idempotent. */
export async function bookPartnerSettlementRevenue(
  supabase: SupabaseClient,
  tx: { id: string; retailer_id: string; reference_id: string; amount: number | string; charges: number | string; mode: string }
): Promise<void> {
  const total = Number(tx.charges) || 0
  if (!(total > 0)) return
  const amount = Number(tx.amount)
  const baseCharge = await deriveSettlementBaseCharge(supabase, tx.retailer_id, amount, tx.mode, total)
  const r = await bookPartnerRevenue({
    supabase,
    service: 'shadval_settlement',
    partnerId: tx.retailer_id,
    refKey: tx.reference_id,
    baseCharge,
    amount,
    mode: tx.mode,
    transactionUuid: tx.id,
    remarksSuffix: `on ₹${amount} partner transfer`,
  })
  if (r.errors.length) console.error('[Partner Settlement Revenue] errors:', r.errors)
}

async function collectLedgerCandidates(
  supabase: SupabaseClient,
  service: 'pay2new' | 'rechargekit',
  from: string,
  to: string
): Promise<Candidate[]> {
  const rows = await fetchAll<any>((a, b) =>
    supabase
      .from('partner_wallet_ledger')
      .select('id, partner_id, reference_id, description, status, created_at')
      .eq('service_type', service)
      .eq('transaction_type', 'DEBIT')
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: true })
      .range(a, b)
  )

  const succeeded = rows.filter((r) => {
    if ((r.status || '').toLowerCase() === 'failed') return false
    if ((r.status || '').toLowerCase() === 'pending') return false
    const d = r.description || ''
    // Pay2New: provider order id is stamped into the description only on success.
    // Rechargekit: ledger status flips to SUCCESS (TxnID is stamped on provider reply).
    return service === 'pay2new' ? /OrderID:/.test(d) : (r.status || '').toUpperCase() === 'SUCCESS'
  })

  // Drop anything already refunded.
  const refunded = new Set<string>()
  for (const part of chunk(succeeded.map((r) => `REFUND_${r.reference_id}`), 150)) {
    const { data } = await supabase.from('partner_wallet_ledger').select('reference_id').in('reference_id', part)
    for (const d of data || []) refunded.add((d as any).reference_id)
  }

  const isGst = service === 'pay2new' ? makeBbpsGstResolver(supabase) : null
  const out: Candidate[] = []
  for (const r of succeeded) {
    if (refunded.has(`REFUND_${r.reference_id}`)) continue
    const parsed = parseDebitDescription(r.description)
    if (!parsed || !(parsed.charge > 0)) continue
    // Rechargekit partner route always adds GST; Pay2New only when the slab is GST-inclusive.
    const base =
      service === 'rechargekit'
        ? round2(parsed.charge / GST_DIVISOR)
        : await isGst!(r.partner_id, parsed.amount, 'Credit Card', parsed.charge)
    out.push({
      refKey: r.reference_id,
      partnerId: r.partner_id,
      amount: parsed.amount,
      baseCharge: base,
      createdAt: r.created_at,
    })
  }
  return out
}

async function collectSettlementCandidates(supabase: SupabaseClient, from: string, to: string): Promise<Candidate[]> {
  const rows = await fetchAll<any>((a, b) =>
    supabase
      .from('shadval_settlement')
      .select('id, retailer_id, reference_id, amount, charges, mode, status, created_at')
      .eq('status', 'SUCCESS')
      .like('reference_id', 'PSV2_%')
      .gt('charges', 0)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: true })
      .range(a, b)
  )
  return rows.map((r) => ({
    refKey: r.reference_id,
    partnerId: r.retailer_id,
    amount: Number(r.amount),
    // Stored `charges` is the total debited (base + GST when slab is GST-inclusive).
    baseCharge: 0,
    mode: r.mode,
    transactionUuid: r.id,
    createdAt: r.created_at,
    _total: Number(r.charges),
  })) as any
}

async function collectPayoutCandidates(supabase: SupabaseClient, from: string, to: string): Promise<Candidate[]> {
  const rows = await fetchAll<any>((a, b) =>
    supabase
      .from('payout_transactions')
      .select('id, partner_id, client_ref_id, amount, charges, transfer_mode, status, created_at')
      .not('partner_id', 'is', null)
      .eq('status', 'success')
      .gt('charges', 0)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: true })
      .range(a, b)
  )
  return rows.map((r) => ({
    refKey: r.client_ref_id,
    partnerId: r.partner_id,
    amount: Number(r.amount),
    // Partner payout route always adds 18% GST on top of the base charge.
    baseCharge: round2(Number(r.charges) / GST_DIVISOR),
    mode: r.transfer_mode,
    transactionUuid: r.id,
    createdAt: r.created_at,
  }))
}

export async function sweepPartnerRevenue(opts: {
  supabase: SupabaseClient
  services?: PartnerRevenueService[]
  from: string
  to?: string
  dryRun: boolean
  /** Max revenue entries to write per service in one run. */
  maxBook?: number
}): Promise<PartnerRevenueSweepResult[]> {
  const { supabase } = opts
  const to = opts.to || new Date().toISOString()
  const services = opts.services?.length
    ? opts.services
    : (Object.keys(PARTNER_REVENUE_SERVICES) as PartnerRevenueService[])
  const maxBook = opts.maxBook ?? 5000
  const results: PartnerRevenueSweepResult[] = []

  for (const service of services) {
    const cfg = PARTNER_REVENUE_SERVICES[service]
    let candidates: Candidate[]
    if (service === 'pay2new' || service === 'rechargekit') {
      candidates = await collectLedgerCandidates(supabase, service, opts.from, to)
    } else if (service === 'shadval_settlement') {
      candidates = await collectSettlementCandidates(supabase, opts.from, to)
    } else {
      candidates = await collectPayoutCandidates(supabase, opts.from, to)
    }

    // Already-booked check against the revenue ledger.
    const booked = new Set<string>()
    for (const part of chunk(candidates.map((c) => `${cfg.prefix}-REV-${c.refKey}`), 150)) {
      const { data } = await supabase.from('wallet_ledger').select('reference_id').in('reference_id', part)
      for (const d of data || []) booked.add((d as any).reference_id)
    }

    if (service === 'shadval_settlement') {
      for (const c of candidates as any[]) {
        if (booked.has(`${cfg.prefix}-REV-${c.refKey}`)) continue
        c.baseCharge = await deriveSettlementBaseCharge(supabase, c.partnerId, c.amount, c.mode, c._total)
      }
    }

    const missing = candidates.filter((c) => c.baseCharge > 0 && !booked.has(`${cfg.prefix}-REV-${c.refKey}`))
    const res: PartnerRevenueSweepResult = {
      service,
      scanned: candidates.length,
      alreadyBooked: candidates.filter((c) => booked.has(`${cfg.prefix}-REV-${c.refKey}`)).length,
      missing: missing.length,
      missingBaseCharge: round2(missing.reduce((s, c) => s + c.baseCharge, 0)),
      booked: 0,
      failed: 0,
      capped: false,
      sample: missing.slice(0, 5).map((c) => ({
        ref: c.refKey,
        partnerId: c.partnerId,
        amount: c.amount,
        baseCharge: c.baseCharge,
        createdAt: c.createdAt,
      })),
    }

    if (!opts.dryRun) {
      const todo = missing.slice(0, maxBook)
      res.capped = missing.length > todo.length
      for (const group of chunk(todo, 5)) {
        await Promise.all(
          group.map(async (c) => {
            try {
              const r = await bookPartnerRevenue({
                supabase,
                service,
                partnerId: c.partnerId,
                refKey: c.refKey,
                baseCharge: c.baseCharge,
                amount: c.amount,
                mode: c.mode,
                transactionUuid: c.transactionUuid,
                remarksSuffix: `on ₹${c.amount} partner txn (sync)`,
              })
              if (r.errors.length) res.failed++
              else res.booked++
            } catch {
              res.failed++
            }
          })
        )
      }
    }
    results.push(res)
  }
  return results
}
