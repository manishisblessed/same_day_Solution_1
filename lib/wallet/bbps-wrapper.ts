/**
 * BBPS Wallet Integration Wrapper
 * 
 * This wrapper integrates limits checking and unified ledger
 * AROUND the existing BBPS implementation.
 * DO NOT modify existing BBPS API logic.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { checkAllLimits } from '@/lib/limits/enforcement'

// Lazy initialization - don't create client at module load time
let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not configured')
    }
    _supabase = createClient(supabaseUrl, supabaseServiceKey)
  }
  return _supabase
}

export interface BBPSWalletPreDebitResult {
  allowed: boolean
  reason?: string
  ledger_id?: string
}

/**
 * Pre-debit PRIMARY wallet before BBPS payment
 * Checks limits and freezes before debiting
 */
export async function preDebitWalletForBBPS(
  user_id: string,
  user_role: string,
  amount: number,
  transaction_id: string,
  reference_id: string,
  description: string
): Promise<BBPSWalletPreDebitResult> {
  try {
    // Check if wallet is frozen
    const { data: wallet } = await getSupabase()
      .from('wallets')
      .select('is_frozen, balance')
      .eq('user_id', user_id)
      .eq('wallet_type', 'primary')
      .single()

    if (!wallet) {
      // Ensure wallet exists
      await getSupabase().rpc('ensure_wallet', {
        p_user_id: user_id,
        p_user_role: user_role,
        p_wallet_type: 'primary'
      })
    }

    if (wallet?.is_frozen) {
      return {
        allowed: false,
        reason: 'Wallet is frozen. Cannot process BBPS payment.'
      }
    }

    // Check limits
    const limitCheck = await checkAllLimits(
      user_id,
      user_role,
      'primary',
      amount,
      'bbps'
    )

    if (!limitCheck.allowed) {
      return {
        allowed: false,
        reason: limitCheck.reason || 'Transaction limit exceeded'
      }
    }

    // Check balance
    const { data: balance } = await getSupabase().rpc('get_wallet_balance_v2', {
      p_user_id: user_id,
      p_wallet_type: 'primary'
    })

    if ((balance || 0) < amount) {
      return {
        allowed: false,
        reason: `Insufficient balance. Available: ₹${balance || 0}, Required: ₹${amount}`
      }
    }

    // Debit wallet using unified ledger
    const { data: ledgerId, error: ledgerError } = await getSupabase().rpc('add_ledger_entry', {
      p_user_id: user_id,
      p_user_role: user_role,
      p_wallet_type: 'primary',
      p_fund_category: 'bbps',
      p_service_type: 'bbps',
      p_tx_type: 'BBPS_DEBIT',
      p_credit: 0,
      p_debit: amount,
      p_reference_id: reference_id,
      p_transaction_id: transaction_id,
      p_status: 'pending', // Will be updated to completed on success
      p_remarks: description
    })

    if (ledgerError) {
      console.error('Error debiting wallet for BBPS:', ledgerError)
      return {
        allowed: false,
        reason: 'Failed to debit wallet'
      }
    }

    return {
      allowed: true,
      ledger_id: ledgerId
    }
  } catch (error: any) {
    console.error('Error in preDebitWalletForBBPS:', error)
    return {
      allowed: false,
      reason: error.message || 'Failed to process wallet debit'
    }
  }
}

/**
 * Handle BBPS payment success - update ledger status
 */
export async function handleBBPSSuccess(
  transaction_id: string,
  ledger_id: string
): Promise<boolean> {
  try {
    // Update ledger status to completed
    const { error } = await getSupabase()
      .from('wallet_ledger')
      .update({ status: 'completed' })
      .eq('id', ledger_id)

    if (error) {
      console.error('Error updating ledger status:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error in handleBBPSSuccess:', error)
    return false
  }
}

/**
 * Handle BBPS payment failure - reverse the debit
 */
export async function handleBBPSFailure(
  user_id: string,
  user_role: string,
  transaction_id: string,
  ledger_id: string,
  amount: number,
  reason: string
): Promise<boolean> {
  try {
    // Update original ledger entry status to failed
    await getSupabase()
      .from('wallet_ledger')
      .update({ status: 'failed' })
      .eq('id', ledger_id)

    // Reverse the debit - credit wallet
    const { error: reversalError } = await getSupabase().rpc('add_ledger_entry', {
      p_user_id: user_id,
      p_user_role: user_role,
      p_wallet_type: 'primary',
      p_fund_category: 'bbps',
      p_service_type: 'bbps',
      p_tx_type: 'BBPS_REFUND',
      p_credit: amount,
      p_debit: 0,
      p_reference_id: `REVERSAL_${transaction_id}_${Date.now()}`,
      p_transaction_id: transaction_id,
      p_status: 'completed',
      p_remarks: `BBPS payment failed - ${reason}`
    })

    if (reversalError) {
      console.error('Error reversing BBPS debit:', reversalError)
      return false
    }

    return true
  } catch (error) {
    console.error('Error in handleBBPSFailure:', error)
    return false
  }
}

