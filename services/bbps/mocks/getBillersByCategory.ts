/**
 * Mock implementation for getBillersByCategory
 */

import { BBPSBiller } from '../types'

/**
 * Mock billers by category
 */
const MOCK_BILLERS: Record<string, BBPSBiller[]> = {
  Electricity: [
    {
      biller_id: 'AEML00000NATD1',
      biller_name: 'AEML SEEPZ Limited',
      category: 'Electricity',
      category_name: 'Electricity',
      is_active: true,
      support_bill_fetch: true,
      support_partial_payment: false,
      amount_exactness: 'EXACT',
    },
    {
      biller_id: 'ELEC002',
      biller_name: 'BSES Rajdhani Power Limited',
      category: 'Electricity',
      category_name: 'Electricity',
      is_active: true,
      support_bill_fetch: true,
      support_partial_payment: true,
      amount_exactness: 'INEXACT',
    },
    {
      biller_id: 'ELEC003',
      biller_name: 'Tata Power Delhi Distribution',
      category: 'Electricity',
      category_name: 'Electricity',
      is_active: true,
      support_bill_fetch: true,
      support_partial_payment: false,
      amount_exactness: 'EXACT',
    },
  ],
  'Mobile Prepaid': [
    {
      biller_id: 'MOB001',
      biller_name: 'Airtel Prepaid',
      category: 'Mobile Prepaid',
      category_name: 'Mobile Prepaid',
      is_active: true,
      support_bill_fetch: false,
    },
    {
      biller_id: 'MOB002',
      biller_name: 'Vodafone Idea Prepaid',
      category: 'Mobile Prepaid',
      category_name: 'Mobile Prepaid',
      is_active: true,
      support_bill_fetch: false,
    },
  ],
  Water: [
    {
      biller_id: 'WAT001',
      biller_name: 'Delhi Jal Board',
      category: 'Water',
      category_name: 'Water',
      is_active: true,
      support_bill_fetch: true,
    },
  ],
  Gas: [
    {
      biller_id: 'GAS001',
      biller_name: 'Indane Gas',
      category: 'Gas',
      category_name: 'Gas',
      is_active: true,
      support_bill_fetch: true,
    },
  ],
  DTH: [
    {
      biller_id: 'DTH001',
      biller_name: 'Tata Sky',
      category: 'DTH',
      category_name: 'DTH',
      is_active: true,
      support_bill_fetch: true,
    },
  ],
}

/**
 * Default mock billers
 */
const DEFAULT_MOCK_BILLERS: BBPSBiller[] = [
  {
    biller_id: 'MOCK001',
    biller_name: 'Mock Biller 1',
    category: 'Other',
    category_name: 'Other',
    is_active: true,
    support_bill_fetch: true,
  },
]

/**
 * Get mock billers by category
 */
export function getMockBillersByCategory(category: string): BBPSBiller[] {
  if (MOCK_BILLERS[category]) {
    return MOCK_BILLERS[category]
  }
  return DEFAULT_MOCK_BILLERS
}

