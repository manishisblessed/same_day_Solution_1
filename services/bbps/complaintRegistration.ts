/**
 * Complaint Registration Service
 * SparkUpTech BBPS API: POST /complaintRegistration
 * 
 * Registers a complaint for a BBPS transaction
 */

import { bbpsClient } from './bbpsClient'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { isMockMode } from './config'
import { BBPSComplaintRequest, BBPSComplaintResponse } from './types'
import { getMockComplaintRegistration } from './mocks/complaintRegistration'

/**
 * Request parameters for complaintRegistration
 */
export interface ComplaintRegistrationParams {
  transactionId: string
  complaintType: string
  description: string
  complaintDisposition?: string
}

/**
 * Response from BBPS API
 */
interface BBPSComplaintRegistrationResponse {
  success: boolean
  status?: string
  message?: string
  data?: {
    complaintAssigned?: string
    complaintId?: string
    responseCode?: string
    responseReason?: string
    transactionDetails?: string
    txnRefId?: string
    [key: string]: any
  }
}

/**
 * Register complaint
 * 
 * @param params - Complaint registration parameters
 * @returns Complaint registration response
 * 
 * @example
 * ```typescript
 * const complaint = await complaintRegistration({
 *   transactionId: 'CC014110BAAE00054718',
 *   complaintType: 'Transaction',
 *   description: 'Amount deducted multiple times',
 *   complaintDisposition: 'Amount deducted multiple times'
 * })
 * ```
 */
export async function complaintRegistration(
  params: ComplaintRegistrationParams
): Promise<BBPSComplaintResponse> {
  const {
    transactionId,
    complaintType,
    description,
    complaintDisposition = 'Amount deducted multiple times',
  } = params
  const reqId = generateReqId()

  // Validate input
  if (!transactionId || transactionId.trim() === '') {
    throw new Error('Transaction ID is required')
  }
  if (!complaintType || complaintType.trim() === '') {
    throw new Error('Complaint type is required')
  }
  if (!description || description.trim() === '') {
    throw new Error('Complaint description is required')
  }

  // Use mock data if enabled
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

  try {
    // Prepare request body
    const requestBody = {
      reqData: {
        complaintRegistrationReq: {
          complaintType,
          txnRefId: transactionId,
          complaintDesc: description,
          complaintDisposition,
        },
      },
    }

    // Make API request
    // Endpoint: /api/ba/complaintRegistration
    const response = await bbpsClient.request<BBPSComplaintRegistrationResponse>({
      method: 'POST',
      endpoint: '/complaintRegistration',
      body: requestBody,
      reqId,
    })

    if (!response.success || !response.data) {
      logBBPSApiError('complaintRegistration', reqId, response.error || 'Unknown error')
      return {
        success: false,
        error_code: 'COMPLAINT_FAILED',
        error_message: response.error || 'Failed to register complaint',
        transaction_id: transactionId,
      }
    }

    const apiResponse = response.data

    // Check if complaint was registered successfully
    if (!apiResponse.success) {
      return {
        success: false,
        error_code: apiResponse.data?.responseCode || 'COMPLAINT_FAILED',
        error_message: apiResponse.message || 'Failed to register complaint',
        transaction_id: transactionId,
      }
    }

    // Transform successful response - handle new response structure
    const complaintResponse: BBPSComplaintResponse = {
      success: true,
      complaint_id: apiResponse.data?.complaintId,
      transaction_id: transactionId,
      status: apiResponse.status || 'success',
      message: apiResponse.message || 'Complaint registered successfully',
      // Include additional fields from new response format
      complaint_assigned: apiResponse.data?.complaintAssigned,
      response_code: apiResponse.data?.responseCode,
      response_reason: apiResponse.data?.responseReason,
      transaction_details: apiResponse.data?.transactionDetails,
    }

    logBBPSApiCall(
      'complaintRegistration',
      reqId,
      undefined,
      response.status,
      apiResponse.data?.responseCode
    )

    return complaintResponse
  } catch (error: any) {
    logBBPSApiError('complaintRegistration', reqId, error)
    return {
      success: false,
      error_message: error.message || 'Failed to register complaint',
      transaction_id: transactionId,
    }
  }
}

