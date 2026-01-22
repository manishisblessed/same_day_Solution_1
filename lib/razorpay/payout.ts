/**
 * Razorpay Payout Service
 * Handles bank account payouts via RazorpayX API
 */

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET

interface PayoutRequest {
  account_number: string
  fund_account_id?: string
  amount: number // in paise
  currency: string
  mode: 'NEFT' | 'IMPS' | 'RTGS'
  purpose: string
  queue_if_low_balance?: boolean
  reference_id: string
  narration?: string
  notes?: Record<string, any>
}

interface PayoutResponse {
  success: boolean
  payout_id?: string
  status?: string
  failure_reason?: string
  error?: string
}

/**
 * Create a payout using RazorpayX API
 * Note: This requires RazorpayX account and fund account setup
 */
export async function createPayout(
  request: PayoutRequest
): Promise<PayoutResponse> {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    console.error('Razorpay credentials not configured')
    return {
      success: false,
      error: 'Razorpay credentials not configured'
    }
  }

  try {
    // Convert amount to paise (Razorpay expects amounts in smallest currency unit)
    const amountInPaise = Math.round(request.amount * 100)

    // Prepare payout payload
    const payoutPayload: any = {
      account_number: request.account_number,
      amount: amountInPaise,
      currency: request.currency || 'INR',
      mode: request.mode || 'NEFT',
      purpose: request.purpose || 'payout',
      queue_if_low_balance: request.queue_if_low_balance !== false, // Default to true
      reference_id: request.reference_id,
    }

    if (request.fund_account_id) {
      payoutPayload.fund_account_id = request.fund_account_id
    }

    if (request.narration) {
      payoutPayload.narration = request.narration
    }

    if (request.notes) {
      payoutPayload.notes = request.notes
    }

    // Make API call to RazorpayX
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')
    
    const response = await fetch('https://api.razorpay.com/v1/payouts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: JSON.stringify(payoutPayload)
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Razorpay payout API error:', data)
      return {
        success: false,
        failure_reason: data.error?.description || data.error?.message || 'Payout API error',
        error: data.error?.code || 'PAYOUT_FAILED'
      }
    }

    // Success response
    return {
      success: true,
      payout_id: data.id,
      status: data.status,
    }
  } catch (error: any) {
    console.error('Error creating Razorpay payout:', error)
    return {
      success: false,
      error: error.message || 'Unknown error',
      failure_reason: 'Network or API error'
    }
  }
}

/**
 * Get payout status from RazorpayX API
 */
export async function getPayoutStatus(payoutId: string): Promise<PayoutResponse> {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return {
      success: false,
      error: 'Razorpay credentials not configured'
    }
  }

  try {
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')
    
    const response = await fetch(`https://api.razorpay.com/v1/payouts/${payoutId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`
      }
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error?.description || 'Failed to fetch payout status'
      }
    }

    return {
      success: true,
      payout_id: data.id,
      status: data.status,
    }
  } catch (error: any) {
    console.error('Error fetching payout status:', error)
    return {
      success: false,
      error: error.message || 'Unknown error'
    }
  }
}

/**
 * Create payout for settlement
 * This is a convenience function that formats the settlement data for payout
 */
export async function createSettlementPayout(
  settlement: {
    id: string
    amount: number
    net_amount: number
    bank_account_number: string
    bank_ifsc: string
    bank_account_name: string
  }
): Promise<PayoutResponse> {
  return createPayout({
    account_number: settlement.bank_account_number,
    amount: settlement.net_amount, // Use net amount (after charge deduction)
    currency: 'INR',
    mode: 'NEFT', // Default to NEFT, can be made configurable
    purpose: 'payout',
    queue_if_low_balance: true,
    reference_id: `SETTLE_${settlement.id}`,
    narration: `Settlement payout - ${settlement.bank_account_name}`,
    notes: {
      settlement_id: settlement.id,
      bank_ifsc: settlement.bank_ifsc,
      bank_account_name: settlement.bank_account_name
    }
  })
}

