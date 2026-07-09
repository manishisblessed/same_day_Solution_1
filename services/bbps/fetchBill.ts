import { isMockMode } from './config'
import { BBPSBillDetails } from './types'
import { getMockBillDetails } from './mocks/fetchBill'
import { generateReqId, logBBPSApiCall } from './helpers'

export interface FetchBillParams {
  billerId: string
  consumerNumber: string
  enquiryId?: string
  inputParams?: Array<{ paramName: string; paramValue: string | number }>
  ip?: string
  initChannel?: string
  mac?: string
  paymentInfo?: Array<{ infoName: string; infoValue: string }>
  paymentMode?: string
}

export async function fetchBill(params: FetchBillParams): Promise<BBPSBillDetails> {
  const { billerId, consumerNumber, inputParams } = params
  const reqId = generateReqId()

  if (!billerId || billerId.trim() === '') {
    throw new Error('Biller ID is required')
  }

  if (isMockMode()) {
    logBBPSApiCall('fetchBill', reqId, billerId, 'MOCK')
    const mockBill = getMockBillDetails(billerId, consumerNumber, inputParams)
    return { ...mockBill, reqId }
  }

  throw new Error('BBPS provider not configured. Please contact administrator to set up a BBPS provider.')
}

export type { BBPSBillDetails }
