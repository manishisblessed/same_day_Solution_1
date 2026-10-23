/**
 * Knteer Solution Payout API — Types
 */

// ─── Common ──────────────────────────────────────────────────────────────────

export interface KnteerBaseResponse {
  status: boolean
  code: number
  message: string
}

// ─── Wallet Balance ───────────────────────────────────────────────────────────

export interface KnteerBalanceResponse extends KnteerBaseResponse {
  UsableWallet?: number
  CollectionWallet?: number
  Balance?: number
}

// ─── Beneficiary ─────────────────────────────────────────────────────────────

export interface KnteerAddBeneRequest {
  email: string
  mobile: string
  beneName: string
  accountNumber: string
  bankName: string
  ifsc: string
}

export interface KnteerAddBeneResponse extends KnteerBaseResponse {
  data?: {
    beneCode: string
  }
}

// ─── Do Transaction ───────────────────────────────────────────────────────────

export interface KnteerDoTransactionRequest {
  beneCode: string
  email: string
  mobile: string
  beneName: string
  accountNumber: string
  bankName: string
  ifsc: string
  paymentMode: 'IMPS' | 'NEFT'
  amount: string           // sent as string per API spec
  latitude: string
  longitude: string
  partnerTransId: string
  remark: string
}

/**
 * StatusId mapping:
 *  3 = PENDING
 *  4 = SUCCESS  (UTR present)
 *  5 = FAILED   (UTR absent)
 *  6 = FAILED + REFUNDED by Knteer
 */
export interface KnteerTransactionItem {
  StatusId: number
  partnerTransId: string
  transId: string          // Knteer's internal ID, e.g. KSPH01035852600003
  amount?: number
  utr?: string             // empty string when pending/failed
  mobile?: string
  accountNumber?: string
  ifsc?: string
  beneficiaryName?: string
}

export interface KnteerDoTransactionResponse extends KnteerBaseResponse {
  List?: KnteerTransactionItem[]
}

// ─── Status Enquiry ───────────────────────────────────────────────────────────

export interface KnteerStatusRequest {
  partnerTranId: string    // ⚠️  no trailing 's' — Knteer's field name
}

export interface KnteerStatusResponse extends KnteerBaseResponse {
  data?: KnteerTransactionItem | null
}

// ─── Internal mapped status ───────────────────────────────────────────────────

export type KnteerInternalStatus = 'pending' | 'success' | 'failed'

export interface KnteerTransferResult {
  success: boolean
  status?: KnteerInternalStatus
  knteer_trans_id?: string    // transId from Knteer
  partner_trans_id?: string
  utr?: string
  amount?: number
  status_id?: number
  /** true when Knteer already refunded on its side (StatusId 6) */
  provider_refunded?: boolean
  /** true when outcome is ambiguous (codes 314, network errors) — do NOT auto-refund */
  is_indeterminate?: boolean
  error?: string
}
