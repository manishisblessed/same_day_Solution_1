// Server-only module: fraud velocity / anomaly controls for money movement.
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export interface VelocityResult {
  allowed: boolean
  reason?: string
  code?: string
}

/**
 * Defaults are conservative. Override per deployment via env:
 *   PAYOUT_DAILY_AMOUNT_CAP        (default 200000)
 *   PAYOUT_DAILY_COUNT_CAP         (default 50)
 *   NEW_BENEFICIARY_COOLING_MIN    (default 30)  minutes after first save
 */
function num(envKey: string, fallback: number): number {
  const v = parseFloat(process.env[envKey] || '')
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/**
 * Enforce per-retailer daily payout caps (amount + count) over a rolling 24h.
 * Only counts non-failed transactions.
 */
export async function checkPayoutVelocity(params: {
  retailerId: string
  amount: number
}): Promise<VelocityResult> {
  const { retailerId, amount } = params
  const amountCap = num('PAYOUT_DAILY_AMOUNT_CAP', 200_000)
  const countCap = num('PAYOUT_DAILY_COUNT_CAP', 50)

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await getSupabaseAdmin()
      .from('payout_transactions')
      .select('amount, status')
      .eq('retailer_id', retailerId)
      .gte('created_at', since)
      .in('status', ['pending', 'processing', 'success'])

    if (error) {
      console.error('[velocity] payout check failed (BLOCKING for safety):', error.message)
      return { allowed: false, code: 'VELOCITY_CHECK_ERROR', reason: 'Unable to verify transaction limits. Please try again shortly.' }
    }

    const rows = data || []
    const usedAmount = rows.reduce((s, r) => s + parseFloat((r.amount ?? 0).toString()), 0)
    const usedCount = rows.length

    if (usedCount + 1 > countCap) {
      return {
        allowed: false,
        code: 'DAILY_COUNT_CAP',
        reason: `Daily payout count limit reached (${countCap}). Please try again tomorrow or contact support.`,
      }
    }
    if (usedAmount + amount > amountCap) {
      return {
        allowed: false,
        code: 'DAILY_AMOUNT_CAP',
        reason: `Daily payout amount limit of ₹${amountCap.toLocaleString('en-IN')} would be exceeded. Used: ₹${usedAmount.toLocaleString('en-IN')}.`,
      }
    }
    return { allowed: true }
  } catch (e: any) {
    console.error('[velocity] payout check exception (BLOCKING for safety):', e?.message)
    return { allowed: false, code: 'VELOCITY_CHECK_ERROR', reason: 'Unable to verify transaction limits. Please try again shortly.' }
  }
}

/**
 * New-beneficiary cooling period: block transfers to an account that was first
 * saved less than N minutes ago. Classic mule-account / account-takeover guard.
 * Returns allowed=true if the beneficiary is unknown (not saved) so the caller
 * can independently require verification; or if cooling has elapsed.
 */
export async function checkBeneficiaryCooling(params: {
  retailerId: string
  accountNumber: string
  ifscCode: string
}): Promise<VelocityResult> {
  const coolingMin = num('NEW_BENEFICIARY_COOLING_MIN', 30)
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('saved_beneficiaries')
      .select('created_at, is_verified')
      .eq('retailer_id', params.retailerId)
      .eq('account_number', params.accountNumber)
      .eq('ifsc_code', params.ifscCode)
      .maybeSingle()

    if (error || !data) {
      // Not a saved beneficiary — let the verify step decide.
      return { allowed: true }
    }

    const ageMin = (Date.now() - new Date(data.created_at).getTime()) / 60_000
    if (ageMin < coolingMin) {
      const wait = Math.ceil(coolingMin - ageMin)
      return {
        allowed: false,
        code: 'BENEFICIARY_COOLING',
        reason: `This beneficiary was added recently. For your security, transfers are allowed ${wait} minute(s) from now.`,
      }
    }
    return { allowed: true }
  } catch (e: any) {
    console.error('[velocity] beneficiary cooling check exception (BLOCKING for safety):', e?.message)
    return { allowed: false, code: 'COOLING_CHECK_ERROR', reason: 'Unable to verify beneficiary status. Please try again shortly.' }
  }
}
