/**
 * Mock implementation for fetchBill
 */

import { BBPSBillDetails } from '../types'

/**
 * Generate a consistent hash from a string for stable mock data
 */
function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

/**
 * Get mock bill details with realistic, stable data based on inputs
 */
export function getMockBillDetails(
  billerId: string,
  consumerNumber: string,
  inputParams?: Array<{ paramName: string; paramValue: string | number }>
): BBPSBillDetails {
  // Create a stable seed from the input for consistent data
  const seed = hashCode(billerId + consumerNumber + (inputParams?.[0]?.paramValue || ''))
  
  // Generate consistent amount based on seed (realistic range 1000-50000)
  const baseAmount = 1000 + (seed % 49000)
  // Round to nearest 100 for cleaner amounts
  const billAmount = Math.round(baseAmount / 100) * 100
  
  // Generate consistent dates
  const today = new Date()
  // Bill date: 1-5 days ago (based on seed)
  const billDaysAgo = 1 + (seed % 5)
  const billDate = new Date(today)
  billDate.setDate(today.getDate() - billDaysAgo)
  
  // Due date: 5-15 days from today (based on seed)
  const dueDaysAhead = 5 + (seed % 11)
  const dueDate = new Date(today)
  dueDate.setDate(today.getDate() + dueDaysAhead)

  // Build inputParams response (masked values)
  let responseInputParams: Array<{ paramName: string; paramValue: string }> = []
  
  if (inputParams && inputParams.length > 0) {
    responseInputParams = inputParams.map(param => {
      const paramValueStr = String(param.paramValue)
      if (paramValueStr.length > 4) {
        return {
          paramName: param.paramName,
          paramValue: `${paramValueStr.slice(0, 2)}XX${paramValueStr.slice(-2)}`,
        }
      } else if (paramValueStr.length >= 2) {
        return {
          paramName: param.paramName,
          paramValue: `0${paramValueStr.slice(-2)}XX`,
        }
      } else {
        return {
          paramName: param.paramName,
          paramValue: `0${paramValueStr}XX`,
        }
      }
    })
  } else if (consumerNumber && consumerNumber.trim() && consumerNumber !== 'N/A') {
    responseInputParams = [
      {
        paramName: 'Consumer Number',
        paramValue: consumerNumber.length >= 2
          ? `${consumerNumber.slice(0, 2)}XX${consumerNumber.slice(-2)}`
          : `${consumerNumber}XX`,
      },
    ]
  }

  // Generate realistic customer names based on seed (masked format like real BBPS)
  const firstNames = ['Manish', 'Rahul', 'Priya', 'Amit', 'Neha', 'Vikram', 'Anjali', 'Sanjay', 'Deepika', 'Rajesh']
  const lastNames = ['Kumar', 'Shah', 'Singh', 'Sharma', 'Gupta', 'Patel', 'Verma', 'Jain', 'Mehta', 'Agarwal']
  const firstName = firstNames[seed % firstNames.length]
  const lastName = lastNames[(seed >> 4) % lastNames.length]
  const fullName = `${firstName} ${lastName}`
  
  // Mask the name like real BBPS does (show first 2-3 chars, mask middle)
  const maskedName = fullName.length > 4 
    ? `${fullName.slice(0, 3)}${'*'.repeat(Math.min(fullName.length - 4, 6))}${fullName.slice(-2)}`
    : fullName

  // Generate consistent bill number
  const billNumber = `${669543526 + (seed % 10000)}${1075454 + (seed % 1000)}`

  // Generate additional info based on biller type
  let additionalInfo: Array<{ infoName: string; infoValue: string }> = []
  
  if (billerId.includes('CREDIT') || billerId.includes('CC') || billerId.includes('AXIS') || billerId.includes('AUBA')) {
    // Credit Card specific additional info
    const minPayable = Math.floor(billAmount * 0.05 * 100) / 100
    additionalInfo = [
      {
        infoName: 'Minimum Payable Amount',
        infoValue: minPayable.toFixed(2),
      },
      {
        infoName: 'Total Due Amount',
        infoValue: billAmount.toFixed(2),
      },
    ]
  }

  const billDetails: BBPSBillDetails = {
    biller_id: billerId,
    consumer_number: consumerNumber,
    bill_amount: billAmount,
    due_date: dueDate.toISOString().split('T')[0],
    bill_date: billDate.toISOString().split('T')[0],
    bill_number: billNumber,
    consumer_name: maskedName,
    additional_info: {
      mock: true,
      generated_at: new Date().toISOString(),
      responseCode: '000',
      inputParams: {
        input: responseInputParams,
      },
      billerResponse: {
        billAmount: String(billAmount),
        billDate: billDate.toISOString().split('T')[0],
        billNumber: billNumber,
        billPeriod: 'NA',
        customerName: maskedName,
        dueDate: dueDate.toISOString().split('T')[0],
      },
      additionalInfo: additionalInfo.length > 0 ? {
        info: additionalInfo,
      } : undefined,
      bill_period: `${billDate.toISOString().split('T')[0]} to ${dueDate.toISOString().split('T')[0]}`,
    },
  }

  return billDetails
}

