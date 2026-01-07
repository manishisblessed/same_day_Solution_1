/**
 * Mock implementation for payRequest
 */

import { BBPSPaymentRequest, BBPSPaymentResponse } from '../types'

/**
 * Get mock payment response
 */
export function getMockPayRequest(
  paymentRequest: BBPSPaymentRequest
): BBPSPaymentResponse {
  // Simulate 90% success rate for testing
  const shouldSucceed = Math.random() > 0.1

  const txnId = `TXN-${Date.now()}-${Math.floor(Math.random() * 100000)}`

  if (shouldSucceed) {
    return {
      success: true,
      transaction_id: txnId,
      agent_transaction_id: paymentRequest.agent_transaction_id,
      status: 'success',
      payment_status: 'completed',
      bill_amount: paymentRequest.amount,
      amount_paid: paymentRequest.amount,
      reqId: paymentRequest.reqId,
    }
  } else {
    return {
      success: false,
      error_code: 'PAYMENT_FAILED',
      error_message: 'Mock payment failure (10% chance for testing)',
      agent_transaction_id: paymentRequest.agent_transaction_id,
      status: 'failed',
      payment_status: 'failed',
      reqId: paymentRequest.reqId,
    }
  }
}

