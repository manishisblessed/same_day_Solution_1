/**
 * Get Billers by Category Service
 * SparkUpTech BBPS API: GET /billerId/getList
 * 
 * Fetches available billers for a specific category
 */

import { bbpsClient } from './bbpsClient'
import { chagansPost } from './chagansClient'
import { displayCategoryToChagansKey, ensureChagansCategoryCache } from './chagansCategories'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { getBBPSProvider, isMockMode } from './config'
import { BBPSBiller } from './types'
import { getMockBillersByCategory } from './mocks/getBillersByCategory'

/**
 * Request parameters for getBillersByCategory
 */
export interface GetBillersByCategoryParams {
  category: string
  page?: string
  limit?: number
}

/**
 * Response from BBPS API
 */
interface BBPSBillerListResponse {
  success: boolean
  message?: string
  status?: number
  data?: Array<{
    _id?: string
    blr_id?: string
    blr_name?: string
    blr_category_name?: string
    blr_alias?: string
    blr_coverage?: string
    [key: string]: any
  }>
  meta?: any
}

/**
 * Get billers by category
 * 
 * @param params - Category and pagination parameters
 * @returns Array of billers for the specified category
 * 
 * @example
 * ```typescript
 * const billers = await getBillersByCategory({
 *   category: 'Electricity',
 *   limit: 100
 * })
 * ```
 */
export async function getBillersByCategory(
  params: GetBillersByCategoryParams
): Promise<BBPSBiller[]> {
  const { category, page = '', limit = 50000 } = params
  const reqId = generateReqId()

  // Validate input
  if (!category || category.trim() === '') {
    throw new Error('Category is required')
  }

  // Use mock data if enabled
  if (isMockMode()) {
    logBBPSApiCall('getBillersByCategory', reqId, undefined, 'MOCK')
    return getMockBillersByCategory(category)
  }

  if (getBBPSProvider() === 'chagans') {
    await ensureChagansCategoryCache()
    const categoryKey = displayCategoryToChagansKey(category.trim())
    if (!categoryKey) {
      throw new Error(
        `No Chagans BBPS category mapping for "${category}". Update chagansCategories.ts or use a supported category.`
      )
    }
    const cg = await chagansPost<{
      success: boolean
      category?: string
      categoryName?: string
      data?: Array<{ billerId: string; billerName: string; icon?: string }>
    }>('bbps/getBiller', { categoryKey })

    if (!cg.ok || !cg.data?.success || !Array.isArray(cg.data.data)) {
      logBBPSApiError('getBillersByCategory(chagans)', reqId, cg.error || 'getBiller failed')
      throw new Error(cg.error || 'Failed to fetch billers from Chagans')
    }
    const catLabel = cg.data.categoryName || category.trim()
    const categoryData = cg.data as Required<typeof cg.data>
    return categoryData.data.map((b) => ({
      biller_id: b.billerId,
      biller_name: b.billerName,
      category: catLabel,
      category_name: catLabel,
      is_active: true,
      support_bill_fetch: true,
      paymentMode: 'Cash',
      metadata: { categoryKey: categoryData.category || categoryKey, icon: b.icon, ...b },
    }))
  }

  try {
    // Build endpoint with query parameters
    const endpoint = `/billerId/getList?blr_category_name=${encodeURIComponent(category)}&page=${page}&limit=${limit}`
    
    // Make API request
    const response = await bbpsClient.request<BBPSBillerListResponse>({
      method: 'GET',
      endpoint,
      reqId,
    })

    if (!response.success || !response.data) {
      logBBPSApiError('getBillersByCategory', reqId, response.error || 'Unknown error')
      throw new Error(response.error || 'Failed to fetch billers')
    }

    const apiResponse = response.data

    // Validate response structure
    if (!apiResponse.success || !Array.isArray(apiResponse.data)) {
      throw new Error(apiResponse.message || 'Invalid response format from BBPS API')
    }

    // Transform API response to BBPSBiller format
    const billers: BBPSBiller[] = apiResponse.data.map((biller: any) => ({
      biller_id: biller.blr_id || biller._id || '',
      biller_name: biller.blr_name || '',
      category: biller.blr_category_name,
      category_name: biller.blr_category_name,
      biller_alias: biller.blr_alias,
      is_active: true,
      metadata: {
        _id: biller._id,
        blr_coverage: biller.blr_coverage,
        ...biller,
      },
    }))

    logBBPSApiCall('getBillersByCategory', reqId, undefined, response.status, apiResponse.status?.toString())

    return billers
  } catch (error: any) {
    logBBPSApiError('getBillersByCategory', reqId, error)
    throw error
  }
}

