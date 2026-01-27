/**
 * Get Bank List
 * SparkUpTech Express Pay Payout API: POST /bankList
 */

import { payoutClient } from './payoutClient'
import { BankListResponse, PayoutBank } from './types'
import { isPayoutMockMode } from './config'

// Cache bank list for 24 hours
let cachedBankList: PayoutBank[] | null = null
let cacheTimestamp: number = 0
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Get list of banks available for payout
 * 
 * @param options - Filter options
 * @returns List of banks
 */
export async function getBankList(options?: {
  impsOnly?: boolean
  neftOnly?: boolean
  popularOnly?: boolean
  searchQuery?: string
  useCache?: boolean
}): Promise<{
  success: boolean
  banks?: PayoutBank[]
  total?: number
  imps_enabled?: number
  neft_enabled?: number
  error?: string
}> {
  const { impsOnly, neftOnly, popularOnly, searchQuery, useCache = true } = options || {}

  // Check cache
  if (useCache && cachedBankList && Date.now() - cacheTimestamp < CACHE_DURATION) {
    let filteredBanks = [...cachedBankList]
    
    // Apply filters
    if (impsOnly) filteredBanks = filteredBanks.filter(b => b.isIMPS)
    if (neftOnly) filteredBanks = filteredBanks.filter(b => b.isNEFT)
    if (popularOnly) filteredBanks = filteredBanks.filter(b => b.isPopular)
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filteredBanks = filteredBanks.filter(b => 
        b.bankName.toLowerCase().includes(query) ||
        b.code?.toLowerCase().includes(query) ||
        b.ifsc?.toLowerCase().includes(query)
      )
    }

    return {
      success: true,
      banks: filteredBanks,
      total: filteredBanks.length,
      imps_enabled: filteredBanks.filter(b => b.isIMPS).length,
      neft_enabled: filteredBanks.filter(b => b.isNEFT).length,
    }
  }

  // Mock mode
  if (isPayoutMockMode()) {
    const mockBanks: PayoutBank[] = [
      { id: 1, bankName: 'State Bank of India', code: 'SBI', bankType: 'PSB', ifsc: 'SBIN0001234', iin: 608100, isIMPS: true, isNEFT: true, isACVerification: true, isPopular: true },
      { id: 2, bankName: 'HDFC Bank', code: 'HDFC', bankType: 'Private', ifsc: 'HDFC0001234', iin: 607152, isIMPS: true, isNEFT: true, isACVerification: true, isPopular: true },
      { id: 3, bankName: 'ICICI Bank', code: 'ICICI', bankType: 'Private', ifsc: 'ICIC0001234', iin: 508534, isIMPS: true, isNEFT: true, isACVerification: true, isPopular: true },
      { id: 4, bankName: 'Axis Bank', code: 'AXIS', bankType: 'Private', ifsc: 'UTIB0001234', iin: 607105, isIMPS: true, isNEFT: true, isACVerification: true, isPopular: true },
      { id: 5, bankName: 'Punjab National Bank', code: 'PNB', bankType: 'PSB', ifsc: 'PUNB0001234', iin: 607027, isIMPS: true, isNEFT: true, isACVerification: true, isPopular: true },
    ]
    return {
      success: true,
      banks: mockBanks,
      total: mockBanks.length,
      imps_enabled: mockBanks.filter(b => b.isIMPS).length,
      neft_enabled: mockBanks.filter(b => b.isNEFT).length,
    }
  }

  try {
    const response = await payoutClient.request<BankListResponse>({
      method: 'POST',
      endpoint: '/bankList',
    })

    if (!response.success || !response.data) {
      return {
        success: false,
        error: response.error || 'Failed to fetch bank list',
      }
    }

    const apiResponse = response.data

    if (!apiResponse.success) {
      return {
        success: false,
        error: apiResponse.message || 'Failed to fetch bank list',
      }
    }

    let banks = apiResponse.data || []
    
    // Update cache
    cachedBankList = banks
    cacheTimestamp = Date.now()

    // Apply filters
    if (impsOnly) banks = banks.filter(b => b.isIMPS)
    if (neftOnly) banks = banks.filter(b => b.isNEFT)
    if (popularOnly) banks = banks.filter(b => b.isPopular)
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      banks = banks.filter(b => 
        b.bankName.toLowerCase().includes(query) ||
        b.code?.toLowerCase().includes(query) ||
        b.ifsc?.toLowerCase().includes(query)
      )
    }

    return {
      success: true,
      banks,
      total: banks.length,
      imps_enabled: banks.filter(b => b.isIMPS).length,
      neft_enabled: banks.filter(b => b.isNEFT).length,
    }
  } catch (error: any) {
    console.error('Error fetching bank list:', error)
    return {
      success: false,
      error: error.message || 'Failed to fetch bank list',
    }
  }
}

/**
 * Clear bank list cache
 */
export function clearBankListCache(): void {
  cachedBankList = null
  cacheTimestamp = 0
}

