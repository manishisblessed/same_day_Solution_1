/**
 * Mock implementation for fetchBill
 */

import { BBPSBillDetails } from '../types'

/**
 * Get mock bill details
 */
export function getMockBillDetails(
  billerId: string,
  consumerNumber: string,
  inputParams?: Array<{ paramName: string; paramValue: string | number }>
): BBPSBillDetails {
  // Generate realistic mock bill data
  const mockAmounts = [500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 567657, 898988.4]
  const randomAmount = mockAmounts[Math.floor(Math.random() * mockAmounts.length)]

  const today = new Date()
  const dueDate = new Date(today)
  dueDate.setDate(today.getDate() + Math.floor(Math.random() * 30) + 1) // 1-30 days from now

  const billDate = new Date(today)
  billDate.setDate(today.getDate() - Math.floor(Math.random() * 15)) // 0-15 days ago

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

  // Generate additional info based on biller type
  let additionalInfo: Array<{ infoName: string; infoValue: string }> = []
  
  if (billerId.includes('CREDIT') || billerId.includes('CC') || billerId.includes('AXIS') || billerId.includes('AUBA')) {
    // Credit Card specific additional info
    const minPayable = Math.floor(randomAmount * 0.05 * 100) / 100
    additionalInfo = [
      {
        infoName: 'Minimum Payable Amount',
        infoValue: minPayable.toFixed(2),
      },
      {
        infoName: 'Total Due Amount',
        infoValue: randomAmount.toFixed(2),
      },
    ]
  }

  const billDetails: BBPSBillDetails = {
    biller_id: billerId,
    consumer_number: consumerNumber,
    bill_amount: randomAmount,
    due_date: dueDate.toISOString().split('T')[0],
    bill_date: billDate.toISOString().split('T')[0],
    bill_number: `66954352601075454${Math.floor(Math.random() * 1000)}`,
    consumer_name: `A${'X'.repeat(3)}`, // Masked name like "AXXXX"
    additional_info: {
      mock: true,
      generated_at: new Date().toISOString(),
      responseCode: '000',
      inputParams: {
        input: responseInputParams,
      },
      billerResponse: {
        billAmount: String(randomAmount),
        billDate: billDate.toISOString().split('T')[0],
        billNumber: `66954352601075454${Math.floor(Math.random() * 1000)}`,
        billPeriod: 'NA',
        customerName: `A${'X'.repeat(3)}`,
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

