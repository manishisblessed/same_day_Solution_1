/**
 * Complaint Tracking Service
 * SparkUpTech BBPS API: POST /complaintTracking
 * 
 * Tracks the status of a registered complaint
 */

import { bbpsClient } from './bbpsClient'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { isMockMode } from './config'
import { BBPSComplaintTracking } from './types'
import { getMockComplaintTracking } from './mocks/complaintTracking'

/**
 * Request parameters for complaintTracking
 */
export interface ComplaintTrackingParams {
  complaintId: string
  complaintType?: string
}

/**
 * Response from BBPS API
 */
interface BBPSComplaintTrackingResponse {
  success: boolean
  status?: string
  message?: string
  data?: {
    complaintId?: string
    complaintType?: string
    status?: string
    description?: string
    resolution?: string
    [key: string]: any
  }
}

/**
 * Track complaint status
 * 
 * @param params - Complaint ID and type
 * @returns Complaint tracking information
 * 
 * @example
 * ```typescript
 * const complaintStatus = await complaintTracking({
 *   complaintId: 'CC0125126291941',
 *   complaintType: 'Service'
 * })
 * ```
 */
export async function complaintTracking(
  params: ComplaintTrackingParams
): Promise<BBPSComplaintTracking> {
  const { complaintId, complaintType = 'Service' } = params
  const reqId = generateReqId()

  // Validate input
  if (!complaintId || complaintId.trim() === '') {
    throw new Error('Complaint ID is required')
  }

  // Use mock data if enabled
  if (isMockMode()) {
    logBBPSApiCall('complaintTracking', reqId, undefined, 'MOCK')
    return getMockComplaintTracking(complaintId, complaintType)
  }

  try {
    // Prepare request body
    const requestBody = {
      reqData: {
        complaintTrackingReq: {
          complaintType,
          complaintId,
        },
      },
    }

    // Make API request
    const response = await bbpsClient.request<BBPSComplaintTrackingResponse>({
      method: 'POST',
      endpoint: '/complaintTracking',
      body: requestBody,
      reqId,
    })

    if (!response.success || !response.data) {
      logBBPSApiError('complaintTracking', reqId, response.error || 'Unknown error')
      throw new Error(response.error || 'Failed to track complaint')
    }

    const apiResponse = response.data

    // Validate response structure
    if (!apiResponse.success) {
      throw new Error(apiResponse.message || 'Failed to track complaint')
    }

    // Transform API response to BBPSComplaintTracking format
    const complaintData = apiResponse.data || {}
    const complaintTracking: BBPSComplaintTracking = {
      complaint_id: complaintData.complaintId || complaintId,
      status: complaintData.status || 'UNKNOWN',
      complaint_type: complaintData.complaintType || complaintType,
      description: complaintData.description,
      resolution: complaintData.resolution,
      ...complaintData,
    }

    logBBPSApiCall(
      'complaintTracking',
      reqId,
      undefined,
      response.status,
      apiResponse.status
    )

    return complaintTracking
  } catch (error: any) {
    logBBPSApiError('complaintTracking', reqId, error)
    throw error
  }
}

