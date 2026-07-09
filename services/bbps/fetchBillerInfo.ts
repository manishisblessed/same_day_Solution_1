import { isMockMode } from './config'
import { BBPSBillerInfo } from './types'
import { getMockBillerInfo } from './mocks/fetchBillerInfo'
import { generateReqId, logBBPSApiCall } from './helpers'

export interface FetchBillerInfoParams {
  billerId: string
  skipCache?: boolean
}

export async function fetchBillerInfo(params: FetchBillerInfoParams): Promise<BBPSBillerInfo> {
  const { billerId } = params
  const reqId = generateReqId()

  if (!billerId || billerId.trim() === '') {
    throw new Error('Biller ID is required')
  }

  if (isMockMode()) {
    logBBPSApiCall('fetchBillerInfo', reqId, billerId, 'MOCK')
    return getMockBillerInfo(billerId)
  }

  throw new Error('BBPS provider not configured. Please contact administrator to set up a BBPS provider.')
}
