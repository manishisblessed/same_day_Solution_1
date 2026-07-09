import { isMockMode } from './config'
import { BBPSTransactionStatus } from './types'
import { getMockTransactionStatus } from './mocks/transactionStatus'
import { generateReqId, logBBPSApiCall } from './helpers'

export interface TransactionStatusParams {
  transactionId: string
  trackType?: 'TRANS_REF_ID' | 'AGENT_TXN_ID' | string
}

export async function transactionStatus(params: TransactionStatusParams): Promise<BBPSTransactionStatus> {
  const { transactionId } = params
  const reqId = generateReqId()

  if (!transactionId || transactionId.trim() === '') {
    throw new Error('Transaction ID is required')
  }

  if (isMockMode()) {
    logBBPSApiCall('transactionStatus', reqId, undefined, 'MOCK')
    return getMockTransactionStatus(transactionId)
  }

  return {
    transaction_id: transactionId,
    status: 'NOT_AVAILABLE',
    payment_status: 'BBPS provider not configured. Please contact administrator.',
    response_code: 'N/A',
    response_reason: 'No BBPS provider is currently configured.',
    txn_reference_id: transactionId,
    reqId,
  }
}
