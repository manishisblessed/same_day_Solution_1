import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { RazorpayTransaction, POSTerminal, WalletLedgerEntry } from '@/types/database.types'

// Lazy initialization - don't create client at module load time
let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL not configured')
    }
    if (!supabaseServiceKey) {
      console.warn('SUPABASE_SERVICE_ROLE_KEY not set. Wallet operations may fail.')
    }
    _supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  }
  return _supabase
}

// Razorpay API configuration
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET

// MDR Configuration (Merchant Discount Rate)
const DEFAULT_MDR_RATE = 0.015 // 1.5% - adjust based on your agreement

/**
 * Calculate MDR and net amount from gross amount
 */
export function calculateMDR(grossAmount: number, mdrRate: number = DEFAULT_MDR_RATE): {
  mdr: number
  netAmount: number
} {
  const mdr = grossAmount * mdrRate
  const netAmount = grossAmount - mdr
  return {
    mdr: Math.round(mdr * 100) / 100, // Round to 2 decimal places
    netAmount: Math.round(netAmount * 100) / 100
  }
}

/**
 * Get POS terminal by TID
 */
export async function getPOSTerminalByTID(tid: string): Promise<POSTerminal | null> {
  const { data, error } = await getSupabase()
    .from('pos_terminals')
    .select('*')
    .eq('tid', tid)
    .eq('status', 'active')
    .single()

  if (error || !data) {
    console.error('Error fetching POS terminal:', error)
    return null
  }

  return data as POSTerminal
}

/**
 * Process Razorpay transaction (from webhook or polling)
 */
export async function processRazorpayTransaction(
  razorpayPaymentId: string,
  paymentData: {
    amount: number
    status: string
    method: string
    terminal_id?: string
    rrn?: string
    auth_code?: string
    created_at: number
    notes?: Record<string, any>
  }
): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  try {
    // Check if transaction already exists
    const { data: existing } = await getSupabase()
      .from('razorpay_transactions')
      .select('id, wallet_credited')
      .eq('razorpay_payment_id', razorpayPaymentId)
      .single()

    if (existing) {
      // Transaction exists, check if we need to update status or credit wallet
      const status = mapRazorpayStatus(paymentData.status)
      
      if (status === 'captured' && !existing.wallet_credited) {
        // Credit wallet if not already credited
        await creditWalletForTransaction(existing.id)
      }

      return { success: true, transactionId: existing.id }
    }

    // Get TID from terminal_id or notes
    const tid = paymentData.terminal_id || paymentData.notes?.tid
    if (!tid) {
      return { success: false, error: 'TID not found in payment data' }
    }

    // Get POS terminal
    const terminal = await getPOSTerminalByTID(tid)
    if (!terminal) {
      return { success: false, error: `POS terminal not found for TID: ${tid}` }
    }

    // Calculate MDR and net amount
    const grossAmount = paymentData.amount / 100 // Razorpay amounts are in paise
    const { mdr, netAmount } = calculateMDR(grossAmount)

    // Map Razorpay status to our status
    const transactionStatus = mapRazorpayStatus(paymentData.status)

    // Insert transaction
    const { data: transaction, error: insertError } = await getSupabase()
      .from('razorpay_transactions')
      .insert({
        razorpay_payment_id: razorpayPaymentId,
        tid: tid,
        rrn: paymentData.rrn,
        retailer_id: terminal.retailer_id,
        distributor_id: terminal.distributor_id,
        master_distributor_id: terminal.master_distributor_id,
        gross_amount: grossAmount,
        mdr: mdr,
        net_amount: netAmount,
        payment_mode: paymentData.method,
        auth_code: paymentData.auth_code,
        status: transactionStatus,
        razorpay_status: paymentData.status,
        transaction_timestamp: new Date(paymentData.created_at * 1000).toISOString(),
        metadata: paymentData.notes || {},
        wallet_credited: false
      })
      .select()
      .single()

    if (insertError || !transaction) {
      console.error('Error inserting transaction:', insertError)
      return { success: false, error: insertError?.message || 'Failed to insert transaction' }
    }

    // Credit wallet if transaction is captured
    if (transactionStatus === 'captured') {
      await creditWalletForTransaction(transaction.id)
    }

    return { success: true, transactionId: transaction.id }
  } catch (error: any) {
    console.error('Error processing Razorpay transaction:', error)
    return { success: false, error: error.message || 'Unknown error' }
  }
}

/**
 * Map Razorpay payment status to our transaction status
 */
function mapRazorpayStatus(razorpayStatus: string): RazorpayTransaction['status'] {
  const statusMap: Record<string, RazorpayTransaction['status']> = {
    'created': 'pending',
    'authorized': 'authorized',
    'captured': 'captured',
    'refunded': 'refunded',
    'partially_refunded': 'partially_refunded',
    'failed': 'failed'
  }

  return statusMap[razorpayStatus.toLowerCase()] || 'pending'
}

/**
 * Map Razorpay POS transaction status to admin-friendly status
 * 
 * STATUS MAPPING RULE (MANDATORY):
 * - AUTHORIZED → CAPTURED
 * - FAILED, VOIDED, REFUNDED → FAILED
 * - Everything else → PENDING
 * 
 * @param payload - Razorpay notification payload
 * @returns Mapped status: 'CAPTURED' | 'FAILED' | 'PENDING'
 */
export function mapTransactionStatus(payload: any): 'CAPTURED' | 'FAILED' | 'PENDING' {
  const rawStatus = (payload.status || '').toUpperCase().trim()
  
  // AUTHORIZED → CAPTURED
  if (rawStatus === 'AUTHORIZED') {
    return 'CAPTURED'
  }
  
  // FAILED, VOIDED, REFUNDED → FAILED
  if (['FAILED', 'VOIDED', 'REFUNDED'].includes(rawStatus)) {
    return 'FAILED'
  }
  
  // Everything else → PENDING
  return 'PENDING'
}

/**
 * Credit wallet for a successful transaction (idempotent)
 */
export async function creditWalletForTransaction(transactionId: string): Promise<boolean> {
  try {
    // Get transaction
    const { data: transaction, error: txError } = await getSupabase()
      .from('razorpay_transactions')
      .select('*')
      .eq('id', transactionId)
      .single()

    if (txError || !transaction) {
      console.error('Error fetching transaction:', txError)
      return false
    }

    // Check if already credited
    if (transaction.wallet_credited) {
      return true // Already credited, idempotent
    }

    // Only credit for captured transactions
    if (transaction.status !== 'captured') {
      return false
    }

    // Call database function to credit wallet (idempotent)
    const { data: ledgerId, error: creditError } = await getSupabase().rpc('credit_wallet', {
      p_retailer_id: transaction.retailer_id,
      p_transaction_id: transactionId,
      p_amount: transaction.net_amount,
      p_description: `POS transaction credit - TID: ${transaction.tid}, RRN: ${transaction.rrn || 'N/A'}`,
      p_reference_id: transaction.razorpay_payment_id || transaction.id
    })

    if (creditError) {
      console.error('Error crediting wallet:', creditError)
      return false
    }

    // Calculate and distribute commissions to distributor and master distributor
    if (transaction.distributor_id || transaction.master_distributor_id) {
      try {
        const { error: commissionError } = await getSupabase().rpc('process_transaction_commission', {
          p_transaction_id: transactionId,
          p_transaction_type: 'pos',
          p_gross_amount: transaction.gross_amount,
          p_retailer_id: transaction.retailer_id,
          p_distributor_id: transaction.distributor_id || null,
          p_master_distributor_id: transaction.master_distributor_id || null
        })

        if (commissionError) {
          console.error('Error processing commission:', commissionError)
          // Don't fail the transaction if commission calculation fails
          // Log for manual review
        }
      } catch (error) {
        console.error('Error in commission calculation:', error)
        // Don't fail the transaction if commission calculation fails
      }
    }

    return true
  } catch (error: any) {
    console.error('Error in creditWalletForTransaction:', error)
    return false
  }
}

/**
 * Fetch transactions from Razorpay API (polling fallback)
 * Note: This requires Razorpay API credentials
 */
export async function fetchTransactionsFromRazorpay(
  fromDate: Date,
  toDate: Date,
  terminalId?: string
): Promise<any[]> {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    console.warn('Razorpay credentials not configured. Polling disabled.')
    return []
  }

  try {
    // Note: This is a placeholder. You'll need to implement actual Razorpay API calls
    // using the Razorpay Node.js SDK or direct API calls
    // Example: const razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
    
    // For now, return empty array - implement based on Razorpay API documentation
    console.log('Polling Razorpay transactions:', { fromDate, toDate, terminalId })
    return []
  } catch (error: any) {
    console.error('Error fetching from Razorpay API:', error)
    return []
  }
}

/**
 * Verify Razorpay webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string
): boolean {
  if (!RAZORPAY_WEBHOOK_SECRET) {
    console.warn('Razorpay webhook secret not configured')
    return false
  }

  try {
    // Use crypto to verify HMAC SHA256 signature
    const crypto = require('crypto')
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex')

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch (error) {
    console.error('Error verifying webhook signature:', error)
    return false
  }
}

/**
 * Get wallet balance for a retailer
 */
export async function getWalletBalance(retailerId: string): Promise<number> {
  try {
    const { data, error } = await getSupabase().rpc('get_wallet_balance', {
      p_retailer_id: retailerId
    })

    if (error) {
      console.error('Error getting wallet balance:', error)
      return 0
    }

    return data || 0
  } catch (error) {
    console.error('Error in getWalletBalance:', error)
    return 0
  }
}

/**
 * Get wallet ledger entries for a retailer
 */
export async function getWalletLedger(
  retailerId: string,
  limit: number = 50,
  offset: number = 0
): Promise<WalletLedgerEntry[]> {
  try {
    const { data, error } = await getSupabase()
      .from('wallet_ledger')
      .select('*')
      .eq('retailer_id', retailerId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching wallet ledger:', error)
      return []
    }

    return (data || []) as WalletLedgerEntry[]
  } catch (error) {
    console.error('Error in getWalletLedger:', error)
    return []
  }
}











