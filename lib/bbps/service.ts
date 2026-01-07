import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseServiceKey) {
  console.warn('SUPABASE_SERVICE_ROLE_KEY not set. BBPS operations may fail.')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

// BBPS API Configuration
const BBPS_API_BASE_URL = process.env.BBPS_API_BASE_URL || 'https://api.sparkuptech.in/api/ba'
const BBPS_PARTNER_ID = process.env.BBPS_PARTNER_ID || process.env.BBPS_CLIENT_ID || ''
const BBPS_CONSUMER_KEY = process.env.BBPS_CONSUMER_KEY || ''
const BBPS_CONSUMER_SECRET = process.env.BBPS_CONSUMER_SECRET || ''

// Environment detection
const NODE_ENV = process.env.NODE_ENV || 'development'
const APP_ENV = process.env.APP_ENV || NODE_ENV // dev, uat, prod

// 🔐 SAFETY BLOCK: Prevent real BBPS API calls in DEV environment
// Only check at runtime, not during build
function checkSafetyGuard() {
  // Skip safety check during build
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return
  }
  
  // Skip if we're in a build context (Next.js sets this)
  if (typeof window === 'undefined' && process.env.NEXT_PHASE) {
    return
  }
  
  if (
    APP_ENV === 'dev' &&
    process.env.BBPS_USE_MOCK !== 'true'
  ) {
    throw new Error(
      '🚨 SAFETY BLOCK: Real BBPS API cannot run in DEV environment. ' +
      'Set BBPS_USE_MOCK=true for local development or APP_ENV=uat/prod for real API calls.'
    )
  }
}

// Mock mode configuration
// Use mock data if:
// 1. Explicitly set BBPS_USE_MOCK=true
// 2. In local dev (NODE_ENV=development) and BBPS_FORCE_REAL_API is not set
const USE_MOCK_DATA = 
  process.env.BBPS_USE_MOCK === 'true' ||
  (APP_ENV === 'dev' && process.env.BBPS_FORCE_REAL_API !== 'true')

// Import mock service
let mockService: any = null

// 🧪 Log active mode ONCE at startup (not on every request or during build)
// Use a global flag that persists across module reloads
declare global {
  var __BBPS_MODE_LOGGED__: boolean | undefined
}

function logBBPSMode() {
  // Only log once per process, and only in runtime (not during build)
  if (typeof window === 'undefined' && !global.__BBPS_MODE_LOGGED__) {
    // Check if we're in a build context (Next.js sets this)
    const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build'
    
    if (!isBuildTime) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('🔧 BBPS Service Configuration:')
      console.log({
        APP_ENV: APP_ENV,
        NODE_ENV: NODE_ENV,
        BBPS_USE_MOCK: process.env.BBPS_USE_MOCK,
        BBPS_FORCE_REAL_API: process.env.BBPS_FORCE_REAL_API,
        MODE: USE_MOCK_DATA ? 'MOCK' : 'REAL API',
      })
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      global.__BBPS_MODE_LOGGED__ = true
    }
  }
}

if (USE_MOCK_DATA) {
  try {
    mockService = require('./mock-service')
  } catch (e) {
    console.warn('Mock service not available')
  }
}

// Log mode when service is first used (lazy initialization)
// This ensures it only logs at runtime, not during build

// Payout API Configuration
const PAYOUT_API_BASE_URL = process.env.PAYOUT_API_BASE_URL || ''
const PAYOUT_API_KEY = process.env.PAYOUT_API_KEY || ''
const PAYOUT_API_SECRET = process.env.PAYOUT_API_SECRET || ''

// Types
export interface BBPSBiller {
  biller_id: string
  biller_name: string
  category?: string
  category_name?: string
  biller_alias?: string
  is_active?: boolean
  params?: string[]
  amount_exactness?: 'EXACT' | 'INEXACT' | 'ANY'
  support_bill_fetch?: boolean
  support_partial_payment?: boolean
  support_additional_info?: boolean
  metadata?: Record<string, any>
}

export interface BBPSBillDetails {
  biller_id: string
  consumer_number: string
  bill_amount: number
  due_date?: string
  bill_date?: string
  bill_number?: string
  consumer_name?: string
  additional_info?: Record<string, any>
}

export interface BBPSPaymentRequest {
  biller_id: string
  consumer_number: string
  amount: number
  agent_transaction_id: string
  additional_info?: Record<string, any>
}

export interface BBPSPaymentResponse {
  success: boolean
  transaction_id?: string
  agent_transaction_id?: string
  status?: string
  payment_status?: string
  error_code?: string
  error_message?: string
  bill_amount?: number
  amount_paid?: number
}

/**
 * Generate authentication headers for BBPS API
 * Based on SparkUpTech BBPS API documentation
 * Required headers: partnerid, consumerkey, consumersecret
 */
function getBBPSHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'partnerid': BBPS_PARTNER_ID,
    'consumerkey': BBPS_CONSUMER_KEY,
    'consumersecret': BBPS_CONSUMER_SECRET,
  }
}

/**
 * Fetch all available billers from BBPS API by category
 * Based on SparkUpTech BBPS API: GET billerId/getList
 * Uses mock data in dev environment
 */
export async function fetchBBPSBillers(category?: string): Promise<BBPSBiller[]> {
  // 🔐 Check safety guard (runtime only)
  checkSafetyGuard()
  
  // 🧪 Log mode on first use (runtime only)
  logBBPSMode()
  
  // Use mock data in dev/local environment
  if (USE_MOCK_DATA && mockService) {
    const mockBillers = category ? mockService.getMockBillers(category) : mockService.getAllMockBillers()
    
    // Also try to get from cache and merge
    if (category) {
      const { data: cachedBillers } = await supabase
        .from('bbps_billers')
        .select('*')
        .eq('is_active', true)
        .eq('category_name', category)
        .order('biller_name', { ascending: true })
      
      if (cachedBillers && cachedBillers.length > 0) {
        // Merge mock and cached, prioritizing cached
        const cachedMap = new Map(cachedBillers.map(b => [b.biller_id, b]))
        mockBillers.forEach((mock: BBPSBiller) => {
          if (!cachedMap.has(mock.biller_id)) {
            cachedBillers.push({
              biller_id: mock.biller_id,
              biller_name: mock.biller_name,
              category: mock.category,
              category_name: mock.category_name,
              is_active: mock.is_active,
              support_bill_fetch: mock.support_bill_fetch,
            })
          }
        })
        return transformCachedBillers(cachedBillers)
      }
    }
    
    return mockBillers
  }

  try {
    // First, try to get from cache (database) if category matches
    if (category) {
      const { data: cachedBillers } = await supabase
        .from('bbps_billers')
        .select('*')
        .eq('is_active', true)
        .eq('category_name', category)
        .order('biller_name', { ascending: true })

      // If we have cached billers and cache is recent (less than 24 hours), return cached
      if (cachedBillers && cachedBillers.length > 0) {
        const oldestCache = cachedBillers[0]?.updated_at
        if (oldestCache) {
          const cacheAge = Date.now() - new Date(oldestCache).getTime()
          const maxCacheAge = 24 * 60 * 60 * 1000 // 24 hours
          if (cacheAge < maxCacheAge) {
            return transformCachedBillers(cachedBillers)
          }
        }
      }
    }

    // Fetch from BBPS API
    if (!BBPS_API_BASE_URL || !BBPS_PARTNER_ID || !BBPS_CONSUMER_KEY || !BBPS_CONSUMER_SECRET) {
      // In local dev, if credentials not set, try to use cached data
      if (USE_MOCK_DATA) {
        console.warn('BBPS API credentials not configured. Using cached data only.')
        const { data: cachedBillers } = await supabase
          .from('bbps_billers')
          .select('*')
          .eq('is_active', true)
          .eq('category_name', category)
          .order('biller_name', { ascending: true })
        
        if (cachedBillers && cachedBillers.length > 0) {
          return transformCachedBillers(cachedBillers)
        }
        throw new Error('BBPS API credentials not configured and no cached data available')
      }
      throw new Error('BBPS API credentials not configured')
    }

    // Build URL with category parameter
    // Category is required for this API
    if (!category) {
      throw new Error('Category is required to fetch billers')
    }
    
    const url = `${BBPS_API_BASE_URL}/billerId/getList?blr_category_name=${encodeURIComponent(category)}&page=&limit=50000`
    
    console.log('BBPS API Request:', {
      url,
      category,
      isLocalDev: APP_ENV === 'dev',
      useMockData: USE_MOCK_DATA,
      headers: {
        'partnerid': BBPS_PARTNER_ID ? 'Set' : 'Not set',
        'consumerkey': BBPS_CONSUMER_KEY ? 'Set' : 'Not set',
        'consumersecret': BBPS_CONSUMER_SECRET ? 'Set' : 'Not set',
      },
    })

    // In local dev, if IP might not be whitelisted, try API but fallback gracefully
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: getBBPSHeaders(),
      })
    } catch (fetchError: any) {
      // Network error - likely IP not whitelisted in local dev
      if (USE_MOCK_DATA && (fetchError.message.includes('ECONNREFUSED') || fetchError.message.includes('timeout'))) {
        console.warn('BBPS API connection failed (likely IP not whitelisted). Using cached data.')
        const { data: cachedBillers } = await supabase
          .from('bbps_billers')
          .select('*')
          .eq('is_active', true)
          .eq('category_name', category)
          .order('biller_name', { ascending: true })
        
        if (cachedBillers && cachedBillers.length > 0) {
          return transformCachedBillers(cachedBillers)
        }
        throw new Error('BBPS API connection failed and no cached data available. Deploy to EC2 or use SSH tunnel for local development.')
      }
      throw fetchError
    }
    
    // Log API response details (only in development for debugging)
    if (process.env.NODE_ENV === 'development') {
      console.log('BBPS API Response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      })
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error('BBPS API Error Response:', errorText)
      
      // If unauthorized (401/403) in local dev, likely IP not whitelisted
      if (USE_MOCK_DATA && (response.status === 401 || response.status === 403)) {
        console.warn('BBPS API returned unauthorized (likely IP not whitelisted). Using cached data.')
        const { data: cachedBillers } = await supabase
          .from('bbps_billers')
          .select('*')
          .eq('is_active', true)
          .eq('category_name', category)
          .order('biller_name', { ascending: true })
        
        if (cachedBillers && cachedBillers.length > 0) {
          return transformCachedBillers(cachedBillers)
        }
        throw new Error('BBPS API IP not whitelisted and no cached data available. Deploy to EC2 or use SSH tunnel for local development.')
      }
      
      throw new Error(`BBPS API error: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    
    // Transform response based on SparkUpTech API structure
    // Response format: { success, message, status, data: [{ _id, blr_id, blr_name, blr_category_name, ... }], meta: {...} }
    if (!data.success || !data.data || !Array.isArray(data.data)) {
      throw new Error(data.message || 'Failed to fetch billers from BBPS API')
    }

    // Transform API response to our BBPSBiller format
    const billers: BBPSBiller[] = data.data.map((biller: any) => ({
      biller_id: biller.blr_id || biller._id,
      biller_name: biller.blr_name,
      category: biller.blr_category_name,
      category_name: biller.blr_category_name,
      biller_alias: biller.blr_alias,
      is_active: true,
      metadata: {
        _id: biller._id,
        blr_coverage: biller.blr_coverage,
        created_at: biller.created_at,
        created_by: biller.created_by,
      },
    }))

    // Cache billers in database
    if (billers.length > 0) {
      await cacheBillers(billers)
    }

    return billers
  } catch (error: any) {
    console.error('Error fetching BBPS billers:', error)
    
    // Fallback to cached billers even if stale
    let query = supabase
      .from('bbps_billers')
      .select('*')
      .eq('is_active', true)
    
    // Filter by category if provided
    if (category) {
      query = query.eq('category_name', category)
    }
    
    const { data: cachedBillers } = await query.order('biller_name', { ascending: true })

    if (cachedBillers && cachedBillers.length > 0) {
      console.log(`Returning ${cachedBillers.length} cached billers for category: ${category}`)
      return transformCachedBillers(cachedBillers)
    }

    // If no cached billers and it's a credentials error, provide helpful message
    if (error.message?.includes('credentials not configured')) {
      throw new Error('BBPS API credentials not configured. Please set BBPS_PARTNER_ID (or BBPS_CLIENT_ID), BBPS_CONSUMER_KEY, and BBPS_CONSUMER_SECRET in your environment variables.')
    }

    throw error
  }
}

/**
 * Transform cached billers from database format
 */
function transformCachedBillers(cachedBillers: any[]): BBPSBiller[] {
  return cachedBillers.map(b => ({
    biller_id: b.biller_id,
    biller_name: b.biller_name,
    category: b.category,
    category_name: b.category_name,
    biller_alias: b.biller_alias,
    is_active: b.is_active,
    params: b.params,
    amount_exactness: b.amount_exactness as any,
    support_bill_fetch: b.support_bill_fetch,
    support_partial_payment: b.support_partial_payment,
    support_additional_info: b.support_additional_info,
    metadata: b.metadata,
  }))
}

/**
 * Cache billers in database
 */
async function cacheBillers(billers: BBPSBiller[]): Promise<void> {
  try {
    for (const biller of billers) {
      await supabase
        .from('bbps_billers')
        .upsert({
          biller_id: biller.biller_id,
          biller_name: biller.biller_name,
          category: biller.category,
          category_name: biller.category_name,
          biller_alias: biller.biller_alias,
          is_active: biller.is_active ?? true,
          params: biller.params || [],
          amount_exactness: biller.amount_exactness,
          support_bill_fetch: biller.support_bill_fetch ?? true,
          support_partial_payment: biller.support_partial_payment ?? false,
          support_additional_info: biller.support_additional_info ?? false,
          metadata: biller.metadata || {},
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'biller_id',
        })
    }
  } catch (error) {
    console.error('Error caching billers:', error)
  }
}

/**
 * Fetch biller information from BBPS API
 * POST /api/ba/bbps/fetchbillerInfo
 * Request body: { billerIds: string }
 */
export async function fetchBillerInfo(billerId: string): Promise<any> {
  // 🔐 Check safety guard (runtime only)
  checkSafetyGuard()
  
  // 🧪 Log mode on first use (runtime only)
  logBBPSMode()
  
  // Use mock data in dev/local environment
  if (USE_MOCK_DATA && mockService) {
    return mockService.getMockBillerInfo(billerId)
  }

  try {
    if (!BBPS_API_BASE_URL || !BBPS_PARTNER_ID || !BBPS_CONSUMER_KEY || !BBPS_CONSUMER_SECRET) {
      throw new Error('BBPS API credentials not configured')
    }

    const url = `${BBPS_API_BASE_URL}/bbps/fetchbillerInfo`
    const requestBody = {
      billerIds: billerId,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: getBBPSHeaders(),
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || `BBPS API error: ${response.statusText}`)
    }

    const data = await response.json()
    
    // Response format: { success, status, message, data: [{ billerId, billerName, ... }] }
    if (!data.success || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error(data.message || 'Biller information not found')
    }

    return data.data[0] // Return first biller info
  } catch (error: any) {
    console.error('Error fetching biller info:', error)
    throw error
  }
}

/**
 * Fetch bill details from BBPS API
 * POST /api/ba/bbps/fetchBill
 * Request body: { ip, initChannel, mac, billerId, inputParams: [{ paramName, paramValue }] }
 * Uses mock data in dev environment
 */
export async function fetchBillDetails(
  billerId: string,
  consumerNumber: string,
  additionalParams?: Record<string, any>
): Promise<BBPSBillDetails> {
  // 🔐 Check safety guard (runtime only)
  checkSafetyGuard()
  
  // 🧪 Log mode on first use (runtime only)
  logBBPSMode()
  
  // Use mock data in dev/local environment
  if (USE_MOCK_DATA && mockService) {
    return mockService.getMockBillDetails(billerId, consumerNumber)
  }

  try {
    if (!BBPS_API_BASE_URL || !BBPS_PARTNER_ID || !BBPS_CONSUMER_KEY || !BBPS_CONSUMER_SECRET) {
      throw new Error('BBPS API credentials not configured')
    }

    const url = `${BBPS_API_BASE_URL}/bbps/fetchBill`
    
    // Build inputParams array from additionalParams or use consumerNumber as default
    const inputParams: Array<{ paramName: string; paramValue: string | number }> = []
    
    if (additionalParams && Object.keys(additionalParams).length > 0) {
      // If additionalParams provided, convert to inputParams array format
      Object.entries(additionalParams).forEach(([key, value]) => {
        inputParams.push({
          paramName: key,
          paramValue: value,
        })
      })
    } else {
      // Default: use consumerNumber as a single parameter
      // Common parameter names: "Consumer Number", "Customer Number", "Account Number"
      inputParams.push({
        paramName: 'Consumer Number',
        paramValue: consumerNumber,
      })
    }

    const requestBody = {
      ip: additionalParams?.ip || '127.0.0.1',
      initChannel: additionalParams?.initChannel || 'AGT',
      mac: additionalParams?.mac || '01-23-45-67-89-ab',
      billerId: billerId,
      inputParams: inputParams,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: getBBPSHeaders(),
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || `BBPS API error: ${response.statusText}`)
    }

    const data = await response.json()
    
    // Response format: { success, status, message, data: { responseCode, billerResponse: { billAmount, dueDate, ... }, ... }, reqId }
    if (!data.success || !data.data) {
      throw new Error(data.message || 'Failed to fetch bill details')
    }

    const billerResponse = data.data.billerResponse || {}
    
    // Transform response based on SparkUpTech API structure
    return {
      biller_id: billerId,
      consumer_number: consumerNumber,
      bill_amount: parseFloat(billerResponse.billAmount || billerResponse.amount || '0'),
      due_date: billerResponse.dueDate || billerResponse.due_date,
      bill_date: billerResponse.billDate || billerResponse.bill_date,
      bill_number: billerResponse.billNumber || billerResponse.bill_number,
      consumer_name: billerResponse.customerName || billerResponse.customer_name || billerResponse.consumerName,
      additional_info: {
        ...data.data,
        reqId: data.reqId,
        responseCode: data.data.responseCode,
        amountOptions: billerResponse.amountOptions,
        billPeriod: billerResponse.billPeriod,
      },
    }
  } catch (error: any) {
    console.error('Error fetching bill details:', error)
    throw error
  }
}

/**
 * Pay bill through BBPS API
 * POST /api/ba/bbps/payRequest
 * Request body: { name, sub_service_name, initChannel, amount, billerId, inputParams, mac, custConvFee, billerAdhoc, paymentInfo, paymentMode, quickPay, splitPay, additionalInfo, billerResponse, reqId }
 * Uses mock data in dev environment
 */
export async function payBill(
  paymentRequest: BBPSPaymentRequest,
  retailerId: string
): Promise<BBPSPaymentResponse> {
  // 🔐 Check safety guard (runtime only)
  checkSafetyGuard()
  
  // 🧪 Log mode on first use (runtime only)
  logBBPSMode()
  
  // Use mock data in dev/local environment
  if (USE_MOCK_DATA && mockService) {
    // Simulate network delay (500ms - 1.5s like real API)
    const delay = 500 + Math.random() * 1000
    await new Promise(resolve => setTimeout(resolve, delay))
    return mockService.mockPayBill(paymentRequest)
  }

  try {
    if (!BBPS_API_BASE_URL || !BBPS_PARTNER_ID || !BBPS_CONSUMER_KEY || !BBPS_CONSUMER_SECRET) {
      throw new Error('BBPS API credentials not configured')
    }

    const url = `${BBPS_API_BASE_URL}/bbps/payRequest`
    
    // Build inputParams array from additional_info
    const inputParams: Array<{ paramName: string; paramValue: string | number }> = []
    if (paymentRequest.additional_info?.inputParams && Array.isArray(paymentRequest.additional_info.inputParams)) {
      inputParams.push(...paymentRequest.additional_info.inputParams)
    } else if (paymentRequest.additional_info) {
      // Convert additional_info object to inputParams array
      Object.entries(paymentRequest.additional_info).forEach(([key, value]) => {
        if (key !== 'inputParams' && key !== 'billerResponse' && key !== 'ip' && key !== 'initChannel' && key !== 'mac') {
          inputParams.push({
            paramName: key,
            paramValue: value,
          })
        }
      })
    }

    // Generate reqId if not provided
    const reqId = paymentRequest.additional_info?.reqId || generateReqId()

    const requestBody = {
      name: paymentRequest.additional_info?.name || 'Utility',
      sub_service_name: paymentRequest.additional_info?.sub_service_name || 'BBPS Bill payment',
      initChannel: paymentRequest.additional_info?.initChannel || 'AGT',
      amount: paymentRequest.amount.toString(),
      billerId: paymentRequest.biller_id,
      inputParams: inputParams.length > 0 ? inputParams : [
        {
          paramName: 'Consumer Number',
          paramValue: paymentRequest.consumer_number,
        }
      ],
      mac: paymentRequest.additional_info?.mac || '01-23-45-67-89-ab',
      custConvFee: paymentRequest.additional_info?.custConvFee || '0.00',
      billerAdhoc: paymentRequest.additional_info?.billerAdhoc || '0.00',
      paymentInfo: paymentRequest.additional_info?.paymentInfo || [],
      paymentMode: paymentRequest.additional_info?.paymentMode || 'Wallet',
      quickPay: paymentRequest.additional_info?.quickPay || 'Y',
      splitPay: paymentRequest.additional_info?.splitPay || 'N',
      additionalInfo: paymentRequest.additional_info?.additionalInfo || {},
      billerResponse: paymentRequest.additional_info?.billerResponse || {},
      reqId: reqId,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: getBBPSHeaders(),
      body: JSON.stringify(requestBody),
    })

    const data = await response.json()

    // Response format: { success, status, data: { responseCode, responseReason, txnRefId, requestId, ... } }
    if (!response.ok || !data.success || data.status !== 'success') {
      return {
        success: false,
        error_code: data.data?.responseCode || data.error_code || data.errorCode || data.status?.toString(),
        error_message: data.data?.responseReason || data.message || data.error_message || data.errorMessage || 'Payment failed',
        agent_transaction_id: paymentRequest.agent_transaction_id,
      }
    }

    // Transform successful response
    const responseData = data.data || {}
    return {
      success: true,
      transaction_id: responseData.txnRefId || responseData.transaction_id || responseData.transactionId,
      agent_transaction_id: paymentRequest.agent_transaction_id,
      status: responseData.responseCode === '000' ? 'success' : 'failed',
      payment_status: responseData.responseReason || responseData.status || 'SUCCESS',
      bill_amount: parseFloat(responseData.RespAmount || responseData.bill_amount || paymentRequest.amount.toString()),
      amount_paid: parseFloat(responseData.RespAmount || responseData.amount_paid || paymentRequest.amount.toString()),
    }
  } catch (error: any) {
    console.error('Error paying bill:', error)
    return {
      success: false,
      error_message: error.message || 'Payment failed',
      agent_transaction_id: paymentRequest.agent_transaction_id,
    }
  }
}

/**
 * Generate unique request ID for BBPS API
 */
function generateReqId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Get BBPS transaction status
 * POST /api/ba/bbps/transactionStatus
 * Request body: { reqData: { transactionStatusReq: { trackValue, trackType } }, reqId }
 * Uses mock data in dev environment
 */
export async function getBBPSTransactionStatus(
  transactionId: string,
  trackType: string = 'TRANS_REF_ID'
): Promise<BBPSPaymentResponse> {
  // 🔐 Check safety guard (runtime only)
  checkSafetyGuard()
  
  // 🧪 Log mode on first use (runtime only)
  logBBPSMode()
  
  // Use mock data in dev/local environment
  if (USE_MOCK_DATA && mockService) {
    return mockService.getMockTransactionStatus(transactionId)
  }

  try {
    if (!BBPS_API_BASE_URL || !BBPS_PARTNER_ID || !BBPS_CONSUMER_KEY || !BBPS_CONSUMER_SECRET) {
      throw new Error('BBPS API credentials not configured')
    }

    const url = `${BBPS_API_BASE_URL}/bbps/transactionStatus`
    const requestBody = {
      reqData: {
        transactionStatusReq: {
          trackValue: transactionId,
          trackType: trackType,
        }
      },
      reqId: generateReqId(),
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: getBBPSHeaders(),
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || `BBPS API error: ${response.statusText}`)
    }

    const data = await response.json()

    // Response format: { success, status, message, data: { responseCode, responseReason, txnList: { ... }, statusRequestId } }
    if (!data.success || !data.data) {
      throw new Error(data.message || 'Failed to fetch transaction status')
    }

    const txnList = data.data.txnList || {}
    const isSuccess = data.data.responseCode === '000' && txnList.txnStatus === 'SUCCESS'

    return {
      success: isSuccess,
      transaction_id: txnList.txnReferenceId || transactionId,
      agent_transaction_id: transactionId,
      status: txnList.txnStatus || data.data.responseReason || 'UNKNOWN',
      payment_status: txnList.txnStatus || data.data.responseReason || 'UNKNOWN',
      error_code: data.data.responseCode !== '000' ? data.data.responseCode : undefined,
      error_message: data.data.responseReason !== 'SUCCESS' ? data.data.responseReason : undefined,
    }
  } catch (error: any) {
    console.error('Error fetching transaction status:', error)
    throw error
  }
}

/**
 * Register a complaint
 * POST /api/ba/complaintRegistration
 * Request body: { reqData: { complaintRegistrationReq: { complaintType, txnRefId, complaintDesc, complaintDisposition } } }
 */
export async function registerComplaint(
  complaintData: {
    transaction_id: string
    complaint_type: string
    description: string
    complaint_disposition?: string
  }
): Promise<any> {
  // 🔐 Check safety guard (runtime only)
  checkSafetyGuard()
  
  // 🧪 Log mode on first use (runtime only)
  logBBPSMode()
  
  try {
    if (!BBPS_API_BASE_URL || !BBPS_PARTNER_ID || !BBPS_CONSUMER_KEY || !BBPS_CONSUMER_SECRET) {
      throw new Error('BBPS API credentials not configured')
    }

    const url = `${BBPS_API_BASE_URL}/complaintRegistration`
    const requestBody = {
      reqData: {
        complaintRegistrationReq: {
          complaintType: complaintData.complaint_type || 'Transaction',
          txnRefId: complaintData.transaction_id,
          complaintDesc: complaintData.description,
          complaintDisposition: complaintData.complaint_disposition || 'Amount deducted multiple times',
        }
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: getBBPSHeaders(),
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || `BBPS API error: ${response.statusText}`)
    }

    const data = await response.json()

    // Response format: { success, status, message, data: { complaintId, responseCode, responseReason, ... } }
    if (!data.success) {
      throw new Error(data.message || 'Failed to register complaint')
    }

    return data
  } catch (error: any) {
    console.error('Error registering complaint:', error)
    throw error
  }
}

/**
 * Track complaint status
 * POST /api/ba/complaintTracking
 * Request body: { reqData: { complaintTrackingReq: { complaintType, complaintId } } }
 */
export async function trackComplaint(
  complaintId: string,
  complaintType: string = 'Service'
): Promise<any> {
  // 🔐 Check safety guard (runtime only)
  checkSafetyGuard()
  
  // 🧪 Log mode on first use (runtime only)
  logBBPSMode()
  
  try {
    if (!BBPS_API_BASE_URL || !BBPS_PARTNER_ID || !BBPS_CONSUMER_KEY || !BBPS_CONSUMER_SECRET) {
      throw new Error('BBPS API credentials not configured')
    }

    const url = `${BBPS_API_BASE_URL}/complaintTracking`
    const requestBody = {
      reqData: {
        complaintTrackingReq: {
          complaintType: complaintType,
          complaintId: complaintId,
        }
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: getBBPSHeaders(),
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || `BBPS API error: ${response.statusText}`)
    }

    const data = await response.json()

    // Response format: { success, status, message, data: { ... } }
    if (!data.success) {
      throw new Error(data.message || 'Failed to track complaint')
    }

    return data
  } catch (error: any) {
    console.error('Error tracking complaint:', error)
    throw error
  }
}

/**
 * Generate unique agent transaction ID
 */
export function generateAgentTransactionId(retailerId: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `BBPS-${retailerId}-${timestamp}-${random}`
}

