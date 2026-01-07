/**
 * BBPS Services - Main Export
 * 
 * Central export point for all BBPS API services
 * 
 * MOCK vs LIVE Toggle:
 * - Set USE_BBPS_MOCK=true to use mock services
 * - Set USE_BBPS_MOCK=false or unset to use live BBPS API
 * - Default: LIVE (false)
 */

// Configuration and helpers
export * from './config'
export * from './helpers'
export * from './bbpsClient'
export * from './types'

// Import both implementations
import { getBillersByCategoryAndChannel as getBillersByCategoryAndChannelLive } from './getBillersByCategoryAndChannel'
import { getMockBillersByCategoryAndChannel } from './mocks/getBillersByCategoryAndChannel'
import type { GetBillersByCategoryAndChannelParams } from './getBillersByCategoryAndChannel'

// API Services
export { getBillersByCategory } from './getBillersByCategory'
export type { GetBillersByCategoryParams } from './getBillersByCategory'

/**
 * Unified getBillersByCategoryAndChannel function
 * Toggles between MOCK and LIVE based on USE_BBPS_MOCK environment variable
 * 
 * This is the ONLY place where the MOCK/LIVE toggle is implemented
 */
export async function getBillersByCategoryAndChannel(
  params: GetBillersByCategoryAndChannelParams
) {
  // Check environment variable - this is the ONLY toggle point
  const useMock = process.env.USE_BBPS_MOCK === 'true'
  
  if (useMock) {
    // Mock implementation
    console.log('🧪 BBPS MOCK API CALLED: getBillersByCategoryAndChannel', {
      fieldValue: params.fieldValue,
      paymentChannelName1: params.paymentChannelName1,
      paymentChannelName2: params.paymentChannelName2,
      paymentChannelName3: params.paymentChannelName3,
      timestamp: new Date().toISOString(),
    })
    return getMockBillersByCategoryAndChannel(
      params.fieldValue,
      params.paymentChannelName1,
      params.paymentChannelName2,
      params.paymentChannelName3
    )
  } else {
    // Live implementation
    console.log('🔥 BBPS LIVE API CALLED: getBillersByCategoryAndChannel', {
      fieldValue: params.fieldValue,
      paymentChannelName1: params.paymentChannelName1,
      paymentChannelName2: params.paymentChannelName2,
      paymentChannelName3: params.paymentChannelName3,
      timestamp: new Date().toISOString(),
    })
    return getBillersByCategoryAndChannelLive(params)
  }
}

// Export types
export type { GetBillersByCategoryAndChannelParams }

export { fetchBillerInfo } from './fetchBillerInfo'
export type { FetchBillerInfoParams } from './fetchBillerInfo'

export { fetchBill } from './fetchBill'
export type { FetchBillParams } from './fetchBill'

export { payRequest } from './payRequest'
export type { PayRequestParams } from './payRequest'

export { transactionStatus } from './transactionStatus'
export type { TransactionStatusParams } from './transactionStatus'

export { complaintRegistration } from './complaintRegistration'
export type { ComplaintRegistrationParams } from './complaintRegistration'

export { complaintTracking } from './complaintTracking'
export type { ComplaintTrackingParams } from './complaintTracking'

