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
      params: ['Last 4 Digits of Credit Card', 'Registered Mobile No'],
      metadata: {
        _id: '692edf133269075fe515431c',
        billerId: 'AUBA00000NAT3Q',
        billerName: 'AU Bank Credit Card',
        billerCategory: 'Credit Card',
        billerAdhoc: 'true',
        billerCoverage: 'IND',
        billerFetchRequirement: 'MANDATORY',
        billerPaymentExactness: '',
        billerSupportBillValidation: 'NOT_SUPPORTED',
        supportPendingStatus: 'No',
        supportDeemed: 'Yes',
        billerTimeout: '',
        billerAdditionalInfo: {
          paramInfo: [
            { paramName: 'Minimum Due Amount' },
            { paramName: 'Unbilled Amount' },
            { paramName: 'Current Outstanding Amount' },
          ],
        },
        billerAmountOptions: 'BASE_BILL_AMOUNT,,,',
        billerPaymentModes: {
          paymentModeInfo: [
            { paymentMode: 'Internet Banking', minAmount: '100', maxAmount: '99999999900' },
            { paymentMode: 'Debit Card', minAmount: '100', maxAmount: '99999999900' },
            { paymentMode: 'IMPS', minAmount: '100', maxAmount: '99999999900' },
            { paymentMode: 'Cash', minAmount: '100', maxAmount: '99999999900' },
            { paymentMode: 'UPI', minAmount: '100', maxAmount: '99999999900' },
            { paymentMode: 'NEFT', minAmount: '100', maxAmount: '99999999900' },
            { paymentMode: 'AEPS', minAmount: '100', maxAmount: '99999999900' },
            { paymentMode: 'Account Transfer', minAmount: '100', maxAmount: '99999999900' },
          ],
        },
        billerDescription: '',
        rechargeAmountInValidationRequest: '',
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
        billerPaymentChannels: {
          paymentChannelInfo: [
            { paymentChannelName: 'INT', minAmount: '100', maxAmount: '99999999900' },
            { paymentChannelName: 'INTB', minAmount: '100', maxAmount: '99999999900' },
            { paymentChannelName: 'MOB', minAmount: '100', maxAmount: '99999999900' },
            { paymentChannelName: 'MOBB', minAmount: '100', maxAmount: '99999999900' },
            { paymentChannelName: 'POS', minAmount: '100', maxAmount: '99999999900' },
            { paymentChannelName: 'MPOS', minAmount: '100', maxAmount: '99999999900' },
            { paymentChannelName: 'ATM', minAmount: '100', maxAmount: '99999999900' },
            { paymentChannelName: 'BNKBRNCH', minAmount: '100', maxAmount: '99999999900' },
            { paymentChannelName: 'KIOSK', minAmount: '100', maxAmount: '99999999900' },
            { paymentChannelName: 'AGT', minAmount: '100', maxAmount: '99999999900' },
            { paymentChannelName: 'BSC', minAmount: '100', maxAmount: '99999999900' },
          ],
        },
        paymentChanel: {
          paymentChannelName: 'AGT',
          minAmount: '100',
          maxAmount: '99999999900',
        },
        mobPaymentChanel: {
          paymentChannelName: 'MOB',
          minAmount: '100',
          maxAmount: '99999999900',
        },
        location: {
          country: 'IND',
          state: null,
          city: null,
        },
        icon: '',
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
      params: ['Last 4 digits of Credit Card Number', 'Registered Mobile Number'],
      metadata: {
        _id: '692edf133269075fe5154362',
        billerId: 'AXIS00000NATKF',
        billerName: 'Axis Bank Credit Card',
        billerCategory: 'Credit Card',
        billerAdhoc: 'false',
        billerCoverage: 'IND',
        billerFetchRequirement: 'MANDATORY',
        billerPaymentExactness: 'Exact and below',
        billerSupportBillValidation: 'NOT_SUPPORTED',
        supportPendingStatus: 'No',
        supportDeemed: 'Yes',
        billerTimeout: '',
        billerAdditionalInfo: {
          paramInfo: [
            { paramName: 'Total Due Amount' },
            { paramName: 'Minimum Payable Amount' },
          ],
        },
        billerAmountOptions: '|BASE_BILL_AMOUNT,,,',
        billerPaymentModes: {
          paymentModeInfo: [
            { paymentMode: 'Internet Banking', minAmount: '100', maxAmount: '99999900' },
            { paymentMode: 'Debit Card', minAmount: '100', maxAmount: '99999900' },
            { paymentMode: 'IMPS', minAmount: '100', maxAmount: '99999900' },
            { paymentMode: 'Cash', minAmount: '100', maxAmount: '99999900' },
            { paymentMode: 'UPI', minAmount: '100', maxAmount: '99999900' },
            { paymentMode: 'NEFT', minAmount: '100', maxAmount: '99999900' },
            { paymentMode: 'AEPS', minAmount: '100', maxAmount: '99999900' },
            { paymentMode: 'Account Transfer', minAmount: '100', maxAmount: '99999900' },
            { paymentMode: 'Bharat QR', minAmount: '100', maxAmount: '99999900' },
            { paymentMode: 'USSD', minAmount: '100', maxAmount: '99999900' },
          ],
        },
        billerDescription: '',
        rechargeAmountInValidationRequest: '',
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
        billerPaymentChannels: {
          paymentChannelInfo: [
            { paymentChannelName: 'INT', minAmount: '100', maxAmount: '99999900' },
            { paymentChannelName: 'INTB', minAmount: '100', maxAmount: '99999900' },
            { paymentChannelName: 'MOB', minAmount: '100', maxAmount: '99999900' },
            { paymentChannelName: 'MOBB', minAmount: '100', maxAmount: '99999900' },
            { paymentChannelName: 'POS', minAmount: '100', maxAmount: '99999900' },
            { paymentChannelName: 'MPOS', minAmount: '100', maxAmount: '99999900' },
            { paymentChannelName: 'ATM', minAmount: '100', maxAmount: '99999900' },
            { paymentChannelName: 'BNKBRNCH', minAmount: '100', maxAmount: '99999900' },
            { paymentChannelName: 'KIOSK', minAmount: '100', maxAmount: '99999900' },
            { paymentChannelName: 'AGT', minAmount: '100', maxAmount: '99999900' },
            { paymentChannelName: 'BSC', minAmount: '100', maxAmount: '99999900' },
          ],
        },
        paymentChanel: {
          paymentChannelName: 'AGT',
          minAmount: '100',
          maxAmount: '99999900',
        },
        mobPaymentChanel: {
          paymentChannelName: 'MOB',
          minAmount: '100',
          maxAmount: '99999900',
        },
        location: {
          country: 'IND',
          state: null,
          city: null,
        },
        icon: '',
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

