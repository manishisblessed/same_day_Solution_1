/**
 * Pay2New (BBPS-2) status-probe evidence recorder.
 *
 * WHY: Pay2New is the authoritative source of truth for a credit-card bill
 * payment. Every money decision we make (refund, clawback, mark terminal) is
 * based on a status probe. If Pay2New later CONTRADICTS a verdict we acted on
 * (e.g. we refunded on a "failed"/"no transaction found", then it settles to
 * SUCCESS), we must be able to prove exactly what Pay2New told us and when — in
 * order to claim the recovery from them. `pay2newCheckStatus` already returns the
 * raw vendor payload; this module PERSISTS it (append-only) so the evidence
 * trail exists for every probe, from every source.
 *
 * Use `checkStatusWithLog` everywhere a status is probed instead of calling
 * `pay2newCheckStatus` directly.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { pay2newCheckStatus, type CheckStatusParams } from '@/services/pay2new'

/** Who triggered the probe — so the audit trail is attributable. */
export type Pay2NewProbeSource =
  | 'pay'
  | 'status_api'
  | 'recon'
  | 'direct_recon'
  | 'false_refund_cron'
  | 'clawback_cron'
  | 'admin'
  | 'monitor'

export type Pay2NewProbeResult = Awaited<ReturnType<typeof pay2newCheckStatus>>

export interface Pay2NewProbeWithEvidence extends Pay2NewProbeResult {
  /** PK of the pay2new_status_log row created for this probe (null if logging failed). */
  evidenceId: number | null
}

/**
 * Persist a single status probe as immutable evidence. Returns the new row id.
 * Never throws — evidence logging must not break the calling flow.
 */
export async function recordPay2NewStatus(
  supabase: SupabaseClient,
  requestId: string,
  probedBy: Pay2NewProbeSource,
  result: Pay2NewProbeResult
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('pay2new_status_log')
      .insert({
        request_id: requestId,
        probed_by: probedBy,
        parsed_status: result.success ? (result.status ?? 'PENDING') : 'UNREACHABLE',
        provider_success: result.success ?? null,
        not_found: result.notFound ?? false,
        order_id: result.order_id ?? null,
        operator_reference: result.operator_reference ?? null,
        amount:
          result.amount !== undefined && result.amount !== null
            ? Number(result.amount)
            : null,
        error: result.error ?? null,
        raw_response: (result.raw as unknown as Record<string, unknown>) ?? null,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[Pay2New Evidence] failed to record status log:', error.message)
      return null
    }
    return (data as { id: number }).id
  } catch (e: any) {
    console.error('[Pay2New Evidence] record error:', e?.message)
    return null
  }
}

/**
 * Probe Pay2New AND persist the raw result as evidence in one call. Also keeps
 * the projection's `vendor_last_status` / `vendor_last_checked_at` fresh (best
 * effort). Drop-in replacement for `pay2newCheckStatus`.
 */
export async function checkStatusWithLog(
  supabase: SupabaseClient,
  params: CheckStatusParams,
  probedBy: Pay2NewProbeSource
): Promise<Pay2NewProbeWithEvidence> {
  const result = await pay2newCheckStatus(params)
  const evidenceId = await recordPay2NewStatus(supabase, params.request_id, probedBy, result)

  // Best-effort freshness stamp on the projection (never blocks / throws).
  try {
    await supabase
      .from('pay2new_payments')
      .update({
        vendor_last_status: result.success ? (result.status ?? 'PENDING') : 'UNREACHABLE',
        vendor_last_checked_at: new Date().toISOString(),
      })
      .eq('request_id', params.request_id)
  } catch {
    /* projection row may not exist yet (direct/retailer flow) — ignore */
  }

  return { ...result, evidenceId }
}
