import type { SupabaseClient } from '@supabase/supabase-js'

export interface SettlementAlertInput {
  retailerId: string
  txnId: string
  amount: number
  reason: string
  details?: Record<string, any>
}

/**
 * Records a settlement failure so admins see it on the T+1 Settlement
 * dashboard instead of the transaction silently staying unsettled.
 * Repeat failures for the same txn refresh last_seen_at on the open alert.
 * Never throws — alerting must not break the settlement run itself.
 */
export async function raiseSettlementAlert(
  supabase: SupabaseClient,
  input: SettlementAlertInput
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('settlement_alerts')
      .select('id')
      .eq('txn_id', input.txnId)
      .eq('status', 'open')
      .maybeSingle()

    if (existing) {
      await supabase
        .from('settlement_alerts')
        .update({ last_seen_at: new Date().toISOString(), reason: input.reason })
        .eq('id', existing.id)
    } else {
      await supabase.from('settlement_alerts').insert({
        alert_type: 'MDR_RATE_MISSING',
        retailer_id: input.retailerId,
        txn_id: input.txnId,
        amount: input.amount,
        reason: input.reason,
        details: input.details || null,
      })
    }
  } catch (err: any) {
    console.error('[SettlementAlert] Failed to raise alert:', err.message)
  }
}

/**
 * Auto-resolves open alerts for transactions that eventually settled
 * (e.g. after the admin added the missing MDR rate).
 */
export async function resolveSettlementAlerts(
  supabase: SupabaseClient,
  txnIds: string[],
  resolvedBy = 'auto-settled'
): Promise<void> {
  if (txnIds.length === 0) return
  try {
    await supabase
      .from('settlement_alerts')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy,
      })
      .in('txn_id', txnIds)
      .eq('status', 'open')
  } catch (err: any) {
    console.error('[SettlementAlert] Failed to resolve alerts:', err.message)
  }
}
