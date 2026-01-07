/**
 * Mock implementation for fetchBill
 */

import { BBPSBillDetails } from '../types'

/**
 * Get mock bill details
 */
export function getMockBillDetails(
  billerId: string,
  consumerNumber: string
): BBPSBillDetails {
  // Generate realistic mock bill data
  const mockAmounts = [500, 750, 1000, 1250, 1500, 2000, 2500, 3000]
  const randomAmount = mockAmounts[Math.floor(Math.random() * mockAmounts.length)]

  const today = new Date()
  const dueDate = new Date(today)
  dueDate.setDate(today.getDate() + Math.floor(Math.random() * 30) + 1) // 1-30 days from now

  const billDate = new Date(today)
  billDate.setDate(today.getDate() - Math.floor(Math.random() * 15)) // 0-15 days ago

  const billDetails: BBPSBillDetails = {
    biller_id: billerId,
    consumer_number: consumerNumber,
    bill_amount: randomAmount,
    due_date: dueDate.toISOString().split('T')[0],
    bill_date: billDate.toISOString().split('T')[0],
    bill_number: `BILL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    consumer_name: `Consumer ${consumerNumber.slice(-4)}`,
    additional_info: {
      mock: true,
      generated_at: new Date().toISOString(),
      bill_period: `${billDate.toISOString().split('T')[0]} to ${dueDate.toISOString().split('T')[0]}`,
    },
  }

  return billDetails
}

