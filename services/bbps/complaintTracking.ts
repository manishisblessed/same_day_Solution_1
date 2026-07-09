import { isMockMode } from './config'
import { BBPSComplaintTracking } from './types'
import { getMockComplaintTracking } from './mocks/complaintTracking'
import { generateReqId, logBBPSApiCall } from './helpers'

export interface ComplaintTrackingParams {
  complaintId: string
  complaintType?: string
}

export async function complaintTracking(params: ComplaintTrackingParams): Promise<BBPSComplaintTracking> {
  const { complaintId, complaintType = 'Service' } = params
  const reqId = generateReqId()

  if (!complaintId || complaintId.trim() === '') {
    throw new Error('Complaint ID is required')
  }

  if (isMockMode()) {
    logBBPSApiCall('complaintTracking', reqId, undefined, 'MOCK')
    return getMockComplaintTracking(complaintId, complaintType)
  }

  return {
    complaint_id: complaintId,
    status: 'NOT_AVAILABLE',
    description: 'BBPS provider not configured. Please contact administrator.',
  }
}
