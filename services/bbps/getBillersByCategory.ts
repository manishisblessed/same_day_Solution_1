import { isMockMode } from './config'
import { BBPSBiller } from './types'
import { getMockBillersByCategory } from './mocks/getBillersByCategory'
import { generateReqId, logBBPSApiCall } from './helpers'

export interface GetBillersByCategoryParams {
  category: string
  page?: string
  limit?: number
}

export async function getBillersByCategory(params: GetBillersByCategoryParams): Promise<BBPSBiller[]> {
  const { category } = params
  const reqId = generateReqId()

  if (!category || category.trim() === '') {
    throw new Error('Category is required')
  }

  if (isMockMode()) {
    logBBPSApiCall('getBillersByCategory', reqId, undefined, 'MOCK')
    return getMockBillersByCategory(category)
  }

  throw new Error('BBPS provider not configured. Please contact administrator to set up a BBPS provider.')
}
