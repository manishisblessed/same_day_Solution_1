import { isMockMode } from './config'
import { BBPSBiller } from './types'
import { generateReqId, logBBPSApiCall } from './helpers'

export interface GetBillersByCategoryAndChannelParams {
  fieldValue: string
  paymentChannelName1?: string
  paymentChannelName2?: string
  paymentChannelName3?: string
}

export async function getBillersByCategoryAndChannel(
  params: GetBillersByCategoryAndChannelParams
): Promise<BBPSBiller[]> {
  const { fieldValue } = params
  const reqId = generateReqId()

  if (!fieldValue || fieldValue.trim() === '') {
    throw new Error('fieldValue (category) is required')
  }

  if (isMockMode()) {
    logBBPSApiCall('getBillersByCategoryAndChannel', reqId, undefined, 'MOCK')
    return []
  }

  throw new Error('BBPS provider not configured. Please contact administrator to set up a BBPS provider.')
}
