import { isMockMode } from './config'
import { BBPSPaymentRequest, BBPSPaymentResponse } from './types'
import { getMockPayRequest } from './mocks/payRequest'
import { generateReqId, logBBPSApiCall } from './helpers'

export interface PayRequestParams {
  billerId: string
  billerName?: string
  consumerNumber: string
  amount: number
  agentTransactionId: string
  inputParams?: Array<{ paramName: string; paramValue: string | number }>
  name?: string
  subServiceName: string
  initChannel?: string
  mac?: string
  custConvFee?: number
  billerAdhoc?: boolean
  paymentInfo?: Array<{ infoName: string; infoValue: string }>
  paymentMode?: string
  quickPay?: string
  splitPay?: string
  reqId?: string
  customerMobileNumber?: string
  customerPan?: string
  billNumber?: string
  billerResponse?: Record<string, any>
  additionalInfo?: Array<{ infoName: string; infoValue: string }>
  customerName?: string
  customerEmail?: string
  customerMobile?: string
  upiId?: string
}

export async function payRequest(params: PayRequestParams): Promise<BBPSPaymentResponse> {
  const { billerId, consumerNumber, amount, agentTransactionId } = params
  const reqId = params.reqId || generateReqId()

  if (!billerId?.trim()) throw new Error('Biller ID is required')
  if (!consumerNumber?.trim()) throw new Error('Consumer number is required')
  if (!amount || amount <= 0) throw new Error('Amount must be greater than 0')
  if (!agentTransactionId?.trim()) throw new Error('Agent transaction ID is required')

  if (isMockMode()) {
    logBBPSApiCall('payRequest', reqId, billerId, 'MOCK')
    const mockPayment: BBPSPaymentRequest = {
      biller_id: billerId,
      consumer_number: consumerNumber,
      amount,
      agent_transaction_id: agentTransactionId,
      reqId,
    }
    return getMockPayRequest(mockPayment)
  }

  return {
    success: false,
    error_message: 'BBPS provider not configured. Please contact administrator to set up a BBPS provider.',
    agent_transaction_id: agentTransactionId,
    reqId,
  }
}
