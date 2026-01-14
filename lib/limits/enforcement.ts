import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export interface LimitCheckResult {
  allowed: boolean
  reason?: string
  limit_amount?: number
  used_amount?: number
  remaining_amount?: number
}

/**
 * Check per-transaction limit
 */
export async function checkPerTransactionLimit(
  user_id: string,
  user_role: string,
  wallet_type: 'primary' | 'aeps',
  amount: number
): Promise<LimitCheckResult> {
  const { data: limit } = await supabase
    .from('user_limits')
    .select('limit_amount, is_enabled, is_overridden')
    .eq('user_id', user_id)
    .eq('user_role', user_role)
    .eq('wallet_type', wallet_type)
    .eq('limit_type', 'per_transaction')
    .single()

  if (!limit || !limit.is_enabled || limit.is_overridden) {
    return { allowed: true }
  }

  const limitAmount = parseFloat(limit.limit_amount.toString())

  if (amount > limitAmount) {
    return {
      allowed: false,
      reason: `Transaction amount exceeds per-transaction limit. Limit: ₹${limitAmount}, Requested: ₹${amount}`,
      limit_amount: limitAmount,
      used_amount: amount,
      remaining_amount: limitAmount - amount
    }
  }

  return { allowed: true, limit_amount: limitAmount }
}

/**
 * Check daily transaction limit
 */
export async function checkDailyTransactionLimit(
  user_id: string,
  user_role: string,
  wallet_type: 'primary' | 'aeps',
  amount: number
): Promise<LimitCheckResult> {
  const { data: limit } = await supabase
    .from('user_limits')
    .select('limit_amount, is_enabled, is_overridden')
    .eq('user_id', user_id)
    .eq('user_role', user_role)
    .eq('wallet_type', wallet_type)
    .eq('limit_type', 'daily_transaction')
    .single()

  if (!limit || !limit.is_enabled || limit.is_overridden) {
    return { allowed: true }
  }

  // Get today's transaction total
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStart = today.toISOString()

  const { data: todayTransactions } = await supabase
    .from('wallet_ledger')
    .select('debit')
    .eq('user_id', user_id)
    .eq('wallet_type', wallet_type)
    .eq('status', 'completed')
    .gte('created_at', todayStart)

  const todayTotal = (todayTransactions || []).reduce(
    (sum, t) => sum + parseFloat((t.debit || 0).toString()),
    0
  )

  const limitAmount = parseFloat(limit.limit_amount.toString())

  if (todayTotal + amount > limitAmount) {
    return {
      allowed: false,
      reason: `Daily transaction limit exceeded. Limit: ₹${limitAmount}, Used: ₹${todayTotal}, Requested: ₹${amount}`,
      limit_amount: limitAmount,
      used_amount: todayTotal,
      remaining_amount: limitAmount - todayTotal
    }
  }

  return {
    allowed: true,
    limit_amount: limitAmount,
    used_amount: todayTotal,
    remaining_amount: limitAmount - todayTotal
  }
}

/**
 * Check BBPS limit slabs
 */
export async function checkBBPSLimitSlab(amount: number): Promise<LimitCheckResult> {
  const { data: slab } = await supabase
    .from('bbps_limit_slabs')
    .select('min_amount, max_amount, is_enabled')
    .lte('min_amount', amount)
    .gte('max_amount', amount)
    .eq('is_enabled', true)
    .single()

  if (!slab) {
    return {
      allowed: false,
      reason: `BBPS payment amount ₹${amount} is not within any enabled limit slab. Max enabled: ₹49,999`
    }
  }

  return { allowed: true }
}

/**
 * Check all limits for a transaction
 */
export async function checkAllLimits(
  user_id: string,
  user_role: string,
  wallet_type: 'primary' | 'aeps',
  amount: number,
  service_type?: 'bbps' | 'aeps' | 'settlement' | 'pos'
): Promise<LimitCheckResult> {
  // Check per-transaction limit
  const perTxCheck = await checkPerTransactionLimit(user_id, user_role, wallet_type, amount)
  if (!perTxCheck.allowed) {
    return perTxCheck
  }

  // Check daily transaction limit (for debits)
  if (wallet_type === 'primary' && service_type !== 'settlement') {
    const dailyCheck = await checkDailyTransactionLimit(user_id, user_role, wallet_type, amount)
    if (!dailyCheck.allowed) {
      return dailyCheck
    }
  }

  // Check BBPS limit slabs if BBPS transaction
  if (service_type === 'bbps') {
    const bbpsCheck = await checkBBPSLimitSlab(amount)
    if (!bbpsCheck.allowed) {
      return bbpsCheck
    }
  }

  return { allowed: true }
}

