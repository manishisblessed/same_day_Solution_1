/**
 * Fetch Biller Info Service
 * SparkUpTech BBPS API: POST /bbps/fetchbillerInfo
 * 
 * Fetches detailed information about a specific biller
 */

import { bbpsClient } from './bbpsClient'
import { chagansPost } from './chagansClient'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { getBBPSProvider, isMockMode } from './config'
import { BBPSBillerInfo } from './types'
import { getMockBillerInfo } from './mocks/fetchBillerInfo'

/**
 * Request parameters for fetchBillerInfo
 */
export interface FetchBillerInfoParams {
  billerId: string
}

/**
 * Response from BBPS API
 */
interface BBPSBillerInfoResponse {
  success: boolean
  status?: string
  message?: string
  data?: Array<{
    billerId?: string
    billerName?: string
    billerCategory?: string
    billerInputParams?: Record<string, any>
    billerPaymentModes?: string
    amountExactness?: string
    supportBillFetch?: boolean
    supportPartialPayment?: boolean
    supportAdditionalInfo?: boolean
    [key: string]: any
  }>
}

// Server-side cache: paramInfo rarely changes; avoids repeated round-trips to Chagans/SparkUp
const FIELD_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const billerFieldCache = new Map<string, { data: BBPSBillerInfo; ts: number }>()

function getCachedFields(billerId: string): BBPSBillerInfo | null {
  const entry = billerFieldCache.get(billerId)
  if (!entry) return null
  if (Date.now() - entry.ts > FIELD_CACHE_TTL_MS) {
    billerFieldCache.delete(billerId)
    return null
  }
  return entry.data
}

function setCachedFields(billerId: string, data: BBPSBillerInfo) {
  billerFieldCache.set(billerId, { data, ts: Date.now() })
  // Cap cache size at 500 billers
  if (billerFieldCache.size > 500) {
    const oldest = billerFieldCache.keys().next().value
    if (oldest) billerFieldCache.delete(oldest)
  }
}

export async function fetchBillerInfo(
  params: FetchBillerInfoParams
): Promise<BBPSBillerInfo> {
  const { billerId } = params
  const reqId = generateReqId()

  // Validate input
  if (!billerId || billerId.trim() === '') {
    throw new Error('Biller ID is required')
  }

  // Use mock data if enabled
  if (isMockMode()) {
    logBBPSApiCall('fetchBillerInfo', reqId, billerId, 'MOCK')
    return getMockBillerInfo(billerId)
  }

  // Return cached field definitions (enquiryId will be refreshed by fetchBill anyway)
  const cached = getCachedFields(billerId)
  if (cached) {
    logBBPSApiCall('fetchBillerInfo', reqId, billerId, 'CACHE')
    return cached
  }

  if (getBBPSProvider() === 'chagans') {
    const cg = await chagansPost<{
      success: boolean
      data?: {
        requiredFields?: Array<{
          paramName: string
          dataType?: string
          isOptional?: string
          minLength?: string
          maxLength?: string
        }>
        billerName?: string
        billerId?: string
        billerCategory?: string
        isFetchSupported?: boolean
        billerPaymentExactness?: string
      }
      enquiryId?: string
      message?: string
    }>('bbps/getBillerField', { billerId })

    if (!cg.ok || !cg.data?.success) {
      logBBPSApiError('fetchBillerInfo(chagans)', reqId, cg.error || 'getBillerField failed', billerId)
      throw new Error(cg.error || 'Failed to fetch biller fields from Chagans')
    }

    const d = cg.data.data
    const required = d?.requiredFields || []
    const paramInfo = required.map((f) => ({
      paramName: f.paramName,
      dataType: f.dataType,
      isOptional: f.isOptional === 'true',
      minLength: f.minLength,
      maxLength: f.maxLength,
    }))

    let amountExactness: 'EXACT' | 'INEXACT' | 'ANY' | undefined
    const ex = (d?.billerPaymentExactness || '').toLowerCase()
    if (ex.includes('exact')) amountExactness = 'EXACT'
    else if (ex.includes('inexact') || ex.includes('above')) amountExactness = 'INEXACT'

    const billerInfo: BBPSBillerInfo = {
      billerId: d?.billerId || billerId,
      billerName: d?.billerName || '',
      billerCategory: d?.billerCategory || undefined,
      billerInputParams: { paramInfo },
      supportBillFetch: d?.isFetchSupported !== false,
      amountExactness,
      enquiryId: cg.data.enquiryId,
    }

    logBBPSApiCall('fetchBillerInfo(chagans)', reqId, billerId, 200)
    setCachedFields(billerId, billerInfo)
    return billerInfo
  }

  try {
    // Prepare request body
    const requestBody = {
      billerIds: billerId,
    }

    // Make API request
    const response = await bbpsClient.request<BBPSBillerInfoResponse>({
      method: 'POST',
      endpoint: '/bbps/fetchbillerInfo',
      body: requestBody,
      reqId,
      billerId,
    })

    if (!response.success || !response.data) {
      logBBPSApiError('fetchBillerInfo', reqId, response.error || 'Unknown error', billerId)
      throw new Error(response.error || 'Failed to fetch biller info')
    }

    const apiResponse = response.data

    // Validate response structure
    if (!apiResponse.success || !Array.isArray(apiResponse.data) || apiResponse.data.length === 0) {
      throw new Error(apiResponse.message || 'Biller information not found')
    }

    // Transform API response to BBPSBillerInfo format
    const billerData = apiResponse.data[0]
    
    // Validate and cast amountExactness
    let amountExactness: 'EXACT' | 'INEXACT' | 'ANY' | undefined = undefined
    if (billerData.amountExactness) {
      const exactness = billerData.amountExactness as string
      if (exactness === 'EXACT' || exactness === 'INEXACT' || exactness === 'ANY') {
        amountExactness = exactness as 'EXACT' | 'INEXACT' | 'ANY'
      }
    }
    
    // Extract additional fields from billerData, excluding amountExactness
    const { amountExactness: _, ...restBillerData } = billerData
    
    const billerInfo: BBPSBillerInfo = {
      billerId: billerData.billerId || billerId,
      billerName: billerData.billerName || '',
      billerCategory: billerData.billerCategory,
      billerInputParams: billerData.billerInputParams,
      billerPaymentModes: billerData.billerPaymentModes,
      amountExactness,
      supportBillFetch: billerData.supportBillFetch,
      supportPartialPayment: billerData.supportPartialPayment,
      supportAdditionalInfo: billerData.supportAdditionalInfo,
      ...restBillerData,
    }

    logBBPSApiCall(
      'fetchBillerInfo',
      reqId,
      billerId,
      response.status,
      apiResponse.status
    )

    setCachedFields(billerId, billerInfo)
    return billerInfo
  } catch (error: any) {
    logBBPSApiError('fetchBillerInfo', reqId, error, billerId)
    throw error
  }
}

