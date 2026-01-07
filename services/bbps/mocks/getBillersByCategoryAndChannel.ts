/**
 * Mock implementation for getBillersByCategoryAndChannel
 */

import { BBPSBiller } from '../types'

/**
 * Mock billers by category and payment channel
 */
const MOCK_BILLERS: Record<string, BBPSBiller[]> = {
  'Credit Card': [
    {
      biller_id: 'AUBA00000NAT3Q',
      biller_name: 'AU Bank Credit Card',
      category: 'Credit Card',
      category_name: 'Credit Card',
      is_active: true,
      support_bill_fetch: true,
      support_partial_payment: false,
      amount_exactness: undefined,
      metadata: {
        billerAdhoc: 'true',
        billerCoverage: 'IND',
        billerFetchRequirement: 'MANDATORY',
        billerSupportBillValidation: 'NOT_SUPPORTED',
        supportPendingStatus: 'No',
        supportDeemed: 'Yes',
        billerInputParams: {
          paramInfo: [
            {
              paramName: 'Last 4 Digits of Credit Card',
              dataType: 'NUMERIC',
              isOptional: 'false',
              minLength: '4',
              maxLength: '4',
              regEx: '^[0-9]{4}$',
              visibility: 'true',
            },
            {
              paramName: 'Registered Mobile No',
              dataType: 'NUMERIC',
              isOptional: 'false',
              minLength: '10',
              maxLength: '10',
              regEx: '^[6-9][0-9]{9}$',
              visibility: 'true',
            },
          ],
        },
      },
    },
    {
      biller_id: 'AXIS00000NATKF',
      biller_name: 'Axis Bank Credit Card',
      category: 'Credit Card',
      category_name: 'Credit Card',
      is_active: true,
      support_bill_fetch: true,
      support_partial_payment: true,
      amount_exactness: 'INEXACT',
      metadata: {
        billerAdhoc: 'false',
        billerCoverage: 'IND',
        billerFetchRequirement: 'MANDATORY',
        billerPaymentExactness: 'Exact and below',
        billerSupportBillValidation: 'NOT_SUPPORTED',
        supportPendingStatus: 'No',
        supportDeemed: 'Yes',
        billerInputParams: {
          paramInfo: [
            {
              paramName: 'Last 4 digits of Credit Card Number',
              dataType: 'NUMERIC',
              isOptional: 'false',
              minLength: '4',
              maxLength: '4',
              regEx: '^[0-9]{4}$',
              visibility: 'true',
            },
            {
              paramName: 'Registered Mobile Number',
              dataType: 'NUMERIC',
              isOptional: 'false',
              minLength: '10',
              maxLength: '10',
              regEx: '^[5-9][0-9]{9}$',
              visibility: 'true',
            },
          ],
        },
      },
    },
  ],
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
 * Get mock billers by category and payment channel
 * Filters billers based on payment channels if provided
 */
export function getMockBillersByCategoryAndChannel(
  category: string,
  paymentChannelName1?: string,
  paymentChannelName2?: string,
  paymentChannelName3?: string
): BBPSBiller[] {
  let billers: BBPSBiller[] = []

  if (MOCK_BILLERS[category]) {
    billers = MOCK_BILLERS[category]
  } else {
    billers = DEFAULT_MOCK_BILLERS
  }

  // In mock mode, we return all billers for the category
  // In real implementation, the API would filter by payment channels
  // For now, we just return the billers for the category
  // Payment channel filtering would be handled by the API

  return billers
}

