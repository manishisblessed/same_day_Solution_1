/**
 * Get Billers by Category and Payment Channel Service
 * SparkUpTech BBPS API: POST /billerInfo/getDataBybillerCategory
 * 
 * Fetches available billers for a specific category filtered by payment channels
 */

import { bbpsClient } from './bbpsClient'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { BBPSBiller } from './types'

/**
 * Request parameters for getBillersByCategoryAndChannel
 */
export interface GetBillersByCategoryAndChannelParams {
  fieldValue: string // Category name (e.g., "Credit Card")
  paymentChannelName1?: string // First payment channel (e.g., "INT")
  paymentChannelName2?: string // Second payment channel (e.g., "AGT")
  paymentChannelName3?: string // Third payment channel (optional)
}

/**
 * Response from BBPS API
 */
interface BBPSBillerListByCategoryResponse {
  success: boolean
  msg?: string
  message?: string
  data?: Array<{
    _id?: string
    billerId?: string
    billerName?: string
    billerCategory?: string
    billerAdhoc?: string
    billerCoverage?: string
    billerFetchRequirement?: string
    billerPaymentExactness?: string
    billerSupportBillValidation?: string
    supportPendingStatus?: string
    supportDeemed?: string
    billerTimeout?: string
    billerAdditionalInfo?: any
    billerAmountOptions?: string
    billerPaymentModes?: any
    billerDescription?: string
    rechargeAmountInValidationRequest?: string
    billerInputParams?: any
    paramInfo?: any[]
    billerPaymentChannels?: any
    paymentChanel?: any
    mobPaymentChanel?: any
    location?: any
    icon?: string
    is_active?: boolean
    [key: string]: any
  }>
}

/**
 * Get billers by category and payment channels
 * 
 * @param params - Category and payment channel parameters
 * @returns Array of billers for the specified category filtered by payment channels
 * 
 * @example
 * ```typescript
 * const billers = await getBillersByCategoryAndChannel({
 *   fieldValue: 'Credit Card',
 *   paymentChannelName1: 'INT',
 *   paymentChannelName2: 'AGT',
 *   paymentChannelName3: ''
 * })
 * ```
 */
export async function getBillersByCategoryAndChannel(
  params: GetBillersByCategoryAndChannelParams
): Promise<BBPSBiller[]> {
  const { fieldValue, paymentChannelName1, paymentChannelName2, paymentChannelName3 } = params
  const reqId = generateReqId()

  // Validate input
  if (!fieldValue || fieldValue.trim() === '') {
    throw new Error('fieldValue (category) is required')
  }

  // This is the LIVE implementation - mock toggle is handled in index.ts
  try {
    // Prepare request body
    const requestBody = {
      fieldValue: fieldValue.trim(),
      paymentChannelName1: paymentChannelName1 || '',
      paymentChannelName2: paymentChannelName2 || '',
      paymentChannelName3: paymentChannelName3 || '',
    }

    // Make API request
    const response = await bbpsClient.request<BBPSBillerListByCategoryResponse>({
      method: 'POST',
      endpoint: '/billerInfo/getDataBybillerCategory',
      body: requestBody,
      reqId,
    })

    if (!response.success || !response.data) {
      logBBPSApiError('getBillersByCategoryAndChannel', reqId, response.error || 'Unknown error')
      throw new Error(response.error || 'Failed to fetch billers')
    }

    const apiResponse = response.data

    // Validate response structure
    if (!apiResponse.success || !Array.isArray(apiResponse.data)) {
      throw new Error(apiResponse.msg || apiResponse.message || 'Invalid response format from BBPS API')
    }

    // Transform API response to BBPSBiller format
    const billers: BBPSBiller[] = apiResponse.data.map((biller: any) => ({
      biller_id: biller.billerId || biller._id || '',
      biller_name: biller.billerName || '',
      category: biller.billerCategory || fieldValue,
      category_name: biller.billerCategory || fieldValue,
      biller_alias: biller.billerAlias,
      is_active: biller.is_active !== false,
      amount_exactness: biller.billerPaymentExactness 
        ? (biller.billerPaymentExactness.toUpperCase() as 'EXACT' | 'INEXACT' | 'ANY')
        : undefined,
      support_bill_fetch: biller.billerFetchRequirement === 'MANDATORY' || biller.billerSupportBillValidation === 'SUPPORTED',
      support_partial_payment: biller.billerPaymentExactness?.toLowerCase().includes('below') || false,
      paymentMode: 'Cash', // Fixed value: "Cash" for now as per requirement
      metadata: {
        _id: biller._id,
        billerAdhoc: biller.billerAdhoc,
        billerCoverage: biller.billerCoverage,
        billerFetchRequirement: biller.billerFetchRequirement,
        billerSupportBillValidation: biller.billerSupportBillValidation,
        supportPendingStatus: biller.supportPendingStatus,
        supportDeemed: biller.supportDeemed,
        billerAdditionalInfo: biller.billerAdditionalInfo,
        billerAmountOptions: biller.billerAmountOptions,
        billerPaymentModes: biller.billerPaymentModes,
        billerInputParams: biller.billerInputParams,
        paramInfo: biller.paramInfo,
        billerPaymentChannels: biller.billerPaymentChannels,
        paymentChanel: biller.paymentChanel,
        mobPaymentChanel: biller.mobPaymentChanel,
        location: biller.location,
        icon: biller.icon,
        ...biller,
      },
    }))

    logBBPSApiCall('getBillersByCategoryAndChannel', reqId, undefined, response.status, apiResponse.success ? 'SUCCESS' : 'FAILED')

    return billers
  } catch (error: any) {
    logBBPSApiError('getBillersByCategoryAndChannel', reqId, error)
    throw error
  }
}

