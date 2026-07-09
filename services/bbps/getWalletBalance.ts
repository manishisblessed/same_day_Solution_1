import { isMockMode } from './config'

export async function getBBPSWalletBalance(): Promise<{
  success: boolean
  balance?: number
  lien?: number
  error?: string
  routeNotFound?: boolean
}> {
  if (isMockMode()) {
    return { success: true, balance: 10000, lien: 0 }
  }

  return {
    success: false,
    error: 'BBPS provider not configured. Please contact administrator to set up a BBPS provider.',
  }
}
