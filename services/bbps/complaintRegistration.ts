import { isMockMode } from './config'
import { BBPSComplaintRequest, BBPSComplaintResponse } from './types'
import { getMockComplaintRegistration } from './mocks/complaintRegistration'
import { generateReqId, logBBPSApiCall } from './helpers'

export interface ComplaintRegistrationParams {
  transactionId: string
  complaintType: string
  description: string
  complaintDisposition?: string
}

export async function complaintRegistration(params: ComplaintRegistrationParams): Promise<BBPSComplaintResponse> {
  const { transactionId, complaintType, description, complaintDisposition = 'Amount deducted multiple times' } = params
  const reqId = generateReqId()

  if (!transactionId?.trim()) throw new Error('Transaction ID is required')
  if (!complaintType?.trim()) throw new Error('Complaint type is required')
  if (!description?.trim()) throw new Error('Complaint description is required')

  if (isMockMode()) {
    logBBPSApiCall('complaintRegistration', reqId, undefined, 'MOCK')
    const mockComplaint: BBPSComplaintRequest = {
      transaction_id: transactionId,
      complaint_type: complaintType,
      description,
      complaint_disposition: complaintDisposition,
    }
    return getMockComplaintRegistration(mockComplaint)
  }

  return {
    success: false,
    transaction_id: transactionId,
    error_code: 'NOT_CONFIGURED',
    error_message: 'BBPS provider not configured. Please contact administrator.',
  }
}
