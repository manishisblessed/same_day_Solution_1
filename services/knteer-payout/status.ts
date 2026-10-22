/**
 * Knteer Solution — Status Enquiry
 * POST /payout/statusenquiry   (⚠️ no /v1/ prefix)
 *
 * StatusId:  3=PENDING  4=SUCCESS  5=FAILED  6=FAILED+REFUNDED_BY_PROVIDER
 */

import { knteerClient } from './client'
import { KnteerStatusResponse, KnteerInternalStatus } from './types'
import { generateRefId } from './auth'
import { isKnteerMockMode } from './config'

export function mapStatusId(statusId: number): KnteerInternalStatus {
  if (statusId === 4) return 'success'
  if (statusId === 3) return 'pending'
  return 'failed'            // 5 or 6
}

export async function checkKnteerStatus(partnerTransId: string): Promise<{
  success: boolean
  status?: KnteerInternalStatus
  status_id?: number
  knteer_trans_id?: string
  utr?: string
  amount?: number
  beneficiary_name?: string
  account_number?: string
  ifsc?: string
  /** true when Knteer already refunded the money (StatusId 6) */
  provider_refunded?: boolean
  error?: string
}> {
  if (!partnerTransId) return { success: false, error: 'partnerTransId required' }

  if (isKnteerMockMode()) {
    return {
      success: true, status: 'success', status_id: 4,
      knteer_trans_id: `KSPH_MOCK_${Date.now()}`,
      utr: `UTR${Date.now()}`, amount: 100,
    }
  }

  const refId = generateRefId()
  const res = await knteerClient.request<KnteerStatusResponse>({
    method: 'POST',
    endpoint: '/payout/statusenquiry',
    body: { partnerTranId: partnerTransId } as Record<string, unknown>, // ⚠️ no 's'
    refId,
  })

  if (!res.success || !res.data) {
    return { success: false, error: res.error || 'Status request failed' }
  }

  const d = res.data

  // code 205 = Record Not Found (legitimate — txn too new or wrong ID)
  if (!d.status && d.code === 205) {
    return { success: true, status: 'pending', error: 'Record not found at provider yet' }
  }

  if (!d.data) {
    return { success: false, error: d.message || 'No status data' }
  }

  const item = d.data
  const statusId = item.StatusId
  const status = mapStatusId(statusId)

  return {
    success: true,
    status,
    status_id: statusId,
    knteer_trans_id: item.transId,
    utr: item.utr || undefined,
    amount: item.amount,
    beneficiary_name: item.beneficiaryName,
    account_number: item.accountNumber,
    ifsc: item.ifsc,
    provider_refunded: statusId === 6,
  }
}
