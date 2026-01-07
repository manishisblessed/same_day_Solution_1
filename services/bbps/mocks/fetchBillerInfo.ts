/**
 * Mock implementation for fetchBillerInfo
 */

import { BBPSBillerInfo } from '../types'

/**
 * Get mock biller information
 */
export function getMockBillerInfo(billerId: string): BBPSBillerInfo {
  // Return mock biller info based on biller ID
  const mockInfo: BBPSBillerInfo = {
    billerId,
    billerName: `Mock Biller ${billerId}`,
    billerCategory: 'Electricity',
    billerInputParams: {
      'Consumer Number': {
        paramName: 'Consumer Number',
        paramType: 'text',
        isMandatory: true,
        validationRegex: '^[0-9]{10}$',
      },
    },
    billerPaymentModes: 'Wallet,UPI,NetBanking',
    amountExactness: 'EXACT',
    supportBillFetch: true,
    supportPartialPayment: false,
    supportAdditionalInfo: false,
    isActive: true,
    coverage: 'All India',
  }

  return mockInfo
}

