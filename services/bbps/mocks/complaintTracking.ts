/**
 * Mock implementation for complaintTracking
 */

import { BBPSComplaintTracking } from '../types'

/**
 * Get mock complaint tracking response
 */
export function getMockComplaintTracking(
  complaintId: string,
  complaintType: string
): BBPSComplaintTracking {
  // Simulate different complaint statuses
  const statuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']
  const randomStatus = statuses[Math.floor(Math.random() * statuses.length)]

  const complaintTracking: BBPSComplaintTracking = {
    complaint_id: complaintId,
    status: randomStatus,
    complaint_type: complaintType,
    description: 'Mock complaint description',
    resolution: randomStatus === 'RESOLVED' ? 'Complaint resolved successfully' : undefined,
  }

  return complaintTracking
}

