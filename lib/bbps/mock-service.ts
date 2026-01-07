/**
 * Mock BBPS Service for Local Development
 * This service provides mock data when BBPS_API_USE_MOCK=true
 */

import { BBPSBiller, BBPSBillDetails, BBPSPaymentRequest, BBPSPaymentResponse } from './service'

// Mock billers data by category
const MOCK_BILLERS: Record<string, BBPSBiller[]> = {
  'Electricity': [
    { biller_id: 'ELEC001', biller_name: 'BSES Yamuna Power Limited', category: 'Electricity', category_name: 'Electricity', is_active: true, support_bill_fetch: true },
    { biller_id: 'ELEC002', biller_name: 'BSES Rajdhani Power Limited', category: 'Electricity', category_name: 'Electricity', is_active: true, support_bill_fetch: true },
    { biller_id: 'ELEC003', biller_name: 'Tata Power Delhi Distribution', category: 'Electricity', category_name: 'Electricity', is_active: true, support_bill_fetch: true },
    { biller_id: 'ELEC004', biller_name: 'Maharashtra State Electricity Distribution', category: 'Electricity', category_name: 'Electricity', is_active: true, support_bill_fetch: true },
  ],
  'Mobile Prepaid': [
    { biller_id: 'MOB001', biller_name: 'Airtel Prepaid', category: 'Mobile Prepaid', category_name: 'Mobile Prepaid', is_active: true, support_bill_fetch: false },
    { biller_id: 'MOB002', biller_name: 'Vodafone Idea Prepaid', category: 'Mobile Prepaid', category_name: 'Mobile Prepaid', is_active: true, support_bill_fetch: false },
    { biller_id: 'MOB003', biller_name: 'Jio Prepaid', category: 'Mobile Prepaid', category_name: 'Mobile Prepaid', is_active: true, support_bill_fetch: false },
    { biller_id: 'MOB004', biller_name: 'BSNL Prepaid', category: 'Mobile Prepaid', category_name: 'Mobile Prepaid', is_active: true, support_bill_fetch: false },
  ],
  'Water': [
    { biller_id: 'WAT001', biller_name: 'Delhi Jal Board', category: 'Water', category_name: 'Water', is_active: true, support_bill_fetch: true },
    { biller_id: 'WAT002', biller_name: 'Mumbai Municipal Corporation Water', category: 'Water', category_name: 'Water', is_active: true, support_bill_fetch: true },
  ],
  'Gas': [
    { biller_id: 'GAS001', biller_name: 'Indane Gas', category: 'Gas', category_name: 'Gas', is_active: true, support_bill_fetch: true },
    { biller_id: 'GAS002', biller_name: 'Bharat Gas', category: 'Gas', category_name: 'Gas', is_active: true, support_bill_fetch: true },
    { biller_id: 'GAS003', biller_name: 'HP Gas', category: 'Gas', category_name: 'Gas', is_active: true, support_bill_fetch: true },
  ],
  'DTH': [
    { biller_id: 'DTH001', biller_name: 'Tata Sky', category: 'DTH', category_name: 'DTH', is_active: true, support_bill_fetch: true },
    { biller_id: 'DTH002', biller_name: 'Dish TV', category: 'DTH', category_name: 'DTH', is_active: true, support_bill_fetch: true },
    { biller_id: 'DTH003', biller_name: 'Airtel Digital TV', category: 'DTH', category_name: 'DTH', is_active: true, support_bill_fetch: true },
  ],
}

// Default mock billers for categories not in the list
const DEFAULT_MOCK_BILLERS: BBPSBiller[] = [
  { biller_id: 'MOCK001', biller_name: 'Mock Biller 1', category: 'Other', category_name: 'Other', is_active: true, support_bill_fetch: true },
  { biller_id: 'MOCK002', biller_name: 'Mock Biller 2', category: 'Other', category_name: 'Other', is_active: true, support_bill_fetch: true },
]

/**
 * Get mock billers for a category
 */
export function getMockBillers(category?: string): BBPSBiller[] {
  if (category && MOCK_BILLERS[category]) {
    return MOCK_BILLERS[category]
  }
  return DEFAULT_MOCK_BILLERS
}

/**
 * Get all mock billers across all categories
 */
export function getAllMockBillers(): BBPSBiller[] {
  const allBillers: BBPSBiller[] = []
  Object.values(MOCK_BILLERS).forEach(billers => {
    allBillers.push(...billers)
  })
  return allBillers
}

/**
 * Get mock biller information
 * Matches real BBPS API response structure
 */
export function getMockBillerInfo(billerId: string): any {
  // Find biller in mock data
  for (const billers of Object.values(MOCK_BILLERS)) {
    const biller = billers.find(b => b.biller_id === billerId)
    if (biller) {
      return {
        billerId: biller.biller_id,
        billerName: biller.biller_name,
        category: biller.category_name,
        supportBillFetch: biller.support_bill_fetch,
        supportPartialPayment: false,
        amountExactness: 'ANY',
        params: ['Consumer Number'],
        // Additional fields that real API might return
        isActive: true,
        coverage: 'All India',
      }
    }
  }
  
  // Return default if not found
  return {
    billerId: billerId,
    billerName: 'Mock Biller',
    category: 'Other',
    supportBillFetch: true,
    supportPartialPayment: false,
    amountExactness: 'ANY',
    params: ['Consumer Number'],
    isActive: true,
  }
}

/**
 * Fetch mock bill details
 * Matches real BBPS API response structure
 */
export function getMockBillDetails(
  billerId: string,
  consumerNumber: string
): BBPSBillDetails {
  // 🚀 Generate request ID for consistency
  const requestId = `REQ-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  
  // Generate mock bill data (realistic amounts)
  const mockAmounts = [500, 750, 1000, 1250, 1500, 2000, 2500, 3000]
  const randomAmount = mockAmounts[Math.floor(Math.random() * mockAmounts.length)]
  
  const today = new Date()
  const dueDate = new Date(today)
  dueDate.setDate(today.getDate() + Math.floor(Math.random() * 30) + 1) // 1-30 days from now
  
  const billDate = new Date(today)
  billDate.setDate(today.getDate() - Math.floor(Math.random() * 15)) // 0-15 days ago

  // Response structure matching real BBPS API
  return {
    biller_id: billerId,
    consumer_number: consumerNumber,
    bill_amount: randomAmount,
    due_date: dueDate.toISOString().split('T')[0],
    bill_date: billDate.toISOString().split('T')[0],
    bill_number: `BILL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    consumer_name: `Consumer ${consumerNumber.slice(-4)}`,
    additional_info: {
      request_id: requestId,
      mock: true,
      generated_at: new Date().toISOString(),
      // Additional fields that real API might return
      bill_period: `${billDate.toISOString().split('T')[0]} to ${dueDate.toISOString().split('T')[0]}`,
    },
  }
}

/**
 * Mock bill payment
 * Matches real BBPS API response structure
 */
export function mockPayBill(
  paymentRequest: BBPSPaymentRequest
): BBPSPaymentResponse {
  // Simulate API delay (500ms - 1.5s)
  const delay = 500 + Math.random() * 1000
  // Simulate 90% success rate for testing
  const shouldSucceed = Math.random() > 0.1
  
  // 🚀 Generate request ID for consistency
  const requestId = `MOCK-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  const txnId = `TXN-${Date.now()}-${Math.floor(Math.random() * 100000)}`
  
  if (shouldSucceed) {
    // Success response matching real BBPS API structure
    return {
      success: true,
      transaction_id: txnId,
      agent_transaction_id: paymentRequest.agent_transaction_id,
      status: 'success',
      payment_status: 'completed',
      bill_amount: paymentRequest.amount,
      amount_paid: paymentRequest.amount,
    }
  } else {
    // Failure response matching real BBPS API error structure
    return {
      success: false,
      error_code: 'PAYMENT_FAILED',
      error_message: 'Mock payment failure (10% chance for testing)',
      agent_transaction_id: paymentRequest.agent_transaction_id,
      status: 'failed',
      payment_status: 'failed',
    }
  }
}

/**
 * Mock transaction status
 * Matches real BBPS API response structure
 */
export function getMockTransactionStatus(transactionId: string): BBPSPaymentResponse {
  // 🚀 Include request ID for consistency
  return {
    success: true,
    transaction_id: transactionId,
    status: 'success',
    payment_status: 'completed',
    // Additional fields that real API might return
    bill_amount: 0, // Will be populated from transaction record
    amount_paid: 0, // Will be populated from transaction record
  }
}

