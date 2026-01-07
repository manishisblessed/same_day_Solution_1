/**
 * Mock implementation for transactionStatus
 */

import { BBPSTransactionStatus } from '../types'

/**
 * Get mock transaction status
 */
export function getMockTransactionStatus(
  transactionId: string
): BBPSTransactionStatus {
  // Simulate different statuses for testing
  const statuses = ['SUCCESS', 'PENDING', 'FAILED']
  const randomStatus = statuses[Math.floor(Math.random() * statuses.length)]

  const transactionStatus: BBPSTransactionStatus = {
    transaction_id: transactionId,
    status: randomStatus,
    payment_status: randomStatus === 'SUCCESS' ? 'completed' : randomStatus.toLowerCase(),
    amount: 1000, // Mock amount
    response_code: randomStatus === 'SUCCESS' ? '000' : '001',
    response_reason: randomStatus,
    txn_reference_id: transactionId,
  }

  return transactionStatus
}

