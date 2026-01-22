/**
 * Mock implementation for getBillersByCategoryAndChannel
 */

import { BBPSBiller } from '../types'

/**
 * Helper to create credit card biller with standard metadata
 */
function createCreditCardBiller(billerId: string, billerName: string): BBPSBiller {
  return {
    biller_id: billerId,
    biller_name: billerName,
    category: 'Credit Card',
    category_name: 'Credit Card',
    is_active: true,
    support_bill_fetch: true,
    support_partial_payment: true,
    amount_exactness: 'INEXACT',
    params: ['Last 4 digits of Credit Card Number', 'Registered Mobile Number'],
    metadata: {
      _id: `mock_${billerId}`,
      billerId: billerId,
      billerName: billerName,
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
  }
}

/**
 * Mock billers by category and payment channel
 */
const MOCK_BILLERS: Record<string, BBPSBiller[]> = {
  'Credit Card': [
    createCreditCardBiller('AUBA00000NAT3Q', 'AU Bank Credit Card'),
    createCreditCardBiller('AXIS00000NATKF', 'Axis Bank Credit Card'),
    createCreditCardBiller('BANK00026NATRG', 'Bank of India Credit Card'),
    createCreditCardBiller('BANK00000NAT0Q', 'Bank of Maharashtra Credit Card'),
    createCreditCardBiller('BANK00000NATKB', 'BoB Credit Card'),
    createCreditCardBiller('CANA00000NATDO', 'Canara Credit Card'),
    createCreditCardBiller('CUBC00000NATGR', 'CUB Credit Card'),
    createCreditCardBiller('DBSB00000NATPR', 'DBS Bank Credit Card'),
    createCreditCardBiller('DCBB00017NATCL', 'DCB Bank Credit Card'),
    createCreditCardBiller('DHAN00000NAT6X', 'Dhanlaxmi Bank Limited'),
    createCreditCardBiller('EDGE00000NATWS', 'Edge CSB Bank RuPay Credit Card'),
    createCreditCardBiller('ESAF00000NATPB', 'ESAF Bank Credit Card'),
    createCreditCardBiller('FEDE00000NATDL', 'Federal Bank Credit Card'),
    createCreditCardBiller('HDFC00000NATBH', 'HDFC Bank Pixel Credit Card'),
    createCreditCardBiller('HDFC00000NATW1', 'HDFC Credit Card'),
    createCreditCardBiller('HSBC00000NAT4M', 'HSBC Credit Card'),
    createCreditCardBiller('ICIC00000NATSI', 'ICICI Credit card'),
    createCreditCardBiller('IDBI00000NAT7G', 'IDBI Bank Credit Card'),
    createCreditCardBiller('IDFC00000NATFQ', 'IDFC FIRST Bank Credit Card'),
    createCreditCardBiller('INDI00000NATFA', 'Indian bank credit card'),
    createCreditCardBiller('INDU00000NATL1', 'IndusInd Credit Card'),
    createCreditCardBiller('IOBC00000NATI3', 'IOB Credit Card'),
    createCreditCardBiller('KOTA00000NATED', 'Kotak Mahindra Bank Credit Card'),
    createCreditCardBiller('ONEB00000NATS1', 'One - BOBCARD Credit Card'),
    createCreditCardBiller('INDI00000NAT8I', 'One - Indian Bank Credit Card'),
    createCreditCardBiller('SOUT00000NAT68', 'One - South Indian Bank Credit Card'),
    createCreditCardBiller('PUNJ00000NATEY', 'Punjab National Bank Credit Card'),
    createCreditCardBiller('RBLB00000NATN3', 'RBL Bank Credit Card'),
    createCreditCardBiller('SARA00000NAT16', 'Saraswat Co-Operative Bank Ltd'),
    createCreditCardBiller('SBIC00000NATDN', 'SBI Card'),
    createCreditCardBiller('SBMB00000NATX5', 'SBM Bank India Limited'),
    createCreditCardBiller('SURY00000NATNX', 'Suryoday Small Finance Bank Credit Card'),
    createCreditCardBiller('UNIO00000NATG9', 'Union Bank of India Credit Card'),
    createCreditCardBiller('YESB00000NAT8U', 'Yes Bank Credit Card'),
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

