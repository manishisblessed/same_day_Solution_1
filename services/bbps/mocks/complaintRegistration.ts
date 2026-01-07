/**
 * Mock implementation for complaintRegistration
 */

import { BBPSComplaintRequest, BBPSComplaintResponse } from '../types'

/**
 * Get mock complaint registration response
 */
export function getMockComplaintRegistration(
  complaint: BBPSComplaintRequest
): BBPSComplaintResponse {
  const complaintId = `COMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`

  return {
    success: true,
    complaint_id: complaintId,
    transaction_id: complaint.transaction_id,
    status: 'success',
    message: 'Complaint registered successfully',
  }
}

