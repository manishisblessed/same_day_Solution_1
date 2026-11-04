/**
 * Knteer Solution — Beneficiary Management
 * POST /payout/v1/add-bene
 *
 * Knteer requires a beneCode before every transaction.
 * We cache it in knteer_beneficiaries to avoid repeated registrations.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { knteerClient } from './client'
import { KnteerAddBeneRequest, KnteerAddBeneResponse } from './types'
import { generateRefId } from './auth'
import { isKnteerMockMode } from './config'

export interface BeneDetails {
  email: string
  mobile: string
  beneName: string
  accountNumber: string
  bankName: string
  ifsc: string
  // Verification metadata (optional — set by accounts route)
  isBankVerified?: boolean
  verifiedAt?: string
  verifiedNameAtBank?: string
  verificationUtr?: string
  verificationOrderid?: string
  disclaimerAccepted?: boolean
  disclaimerAcceptedAt?: string
}

const IFSC_BANK_NAMES: Record<string, string> = {
  UTIB: 'Axis Bank',
  HDFC: 'HDFC Bank',
  SBIN: 'State Bank of India',
  ICIC: 'ICICI Bank',
  KKBK: 'Kotak Mahindra Bank',
  PUNB: 'Punjab National Bank',
  CNRB: 'Canara Bank',
  BARB: 'Bank of Baroda',
  BKID: 'Bank of India',
  IDIB: 'Indian Bank',
  IOBA: 'Indian Overseas Bank',
  UBIN: 'Union Bank of India',
  CBIN: 'Central Bank of India',
  UCBA: 'UCO Bank',
  PSIB: 'Punjab & Sind Bank',
  YESB: 'Yes Bank',
  INDB: 'IndusInd Bank',
  FDRL: 'Federal Bank',
  RATN: 'RBL Bank',
  IDFB: 'IDFC FIRST Bank',
  AUBL: 'AU Small Finance Bank',
  MAHB: 'Bank of Maharashtra',
  JSBP: 'Janata Sahakari Bank',
}

/** Knteer rejects 4-letter IFSC prefixes as bankName. Always send a real bank name. */
export function resolveBankName(ifsc: string, provided?: string): string {
  const trimmed = (provided || '').trim()
  if (trimmed.length >= 6) return trimmed
  const prefix = (ifsc || '').substring(0, 4).toUpperCase()
  return IFSC_BANK_NAMES[prefix] || `${prefix} Bank`
}

/** Strip titles / punctuation so Knteer add-bene accepts the name. */
export function sanitizeBeneName(name: string): string {
  return (name || '')
    .replace(/\b(mrs|mr|ms|smt|shri|miss|m\/s|dr)\b\.?/gi, '')
    .replace(/[^A-Za-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractBeneCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const d = payload as Record<string, any>
  return d.data?.beneCode || d.data?.BeneCode || d.beneCode || d.BeneCode || undefined
}

/**
 * Get or create a Knteer beneCode for the given account.
 * Cached per (retailer_id, accountNumber, ifsc) in knteer_beneficiaries.
 */
export async function getOrCreateBeneCode(
  supabase: SupabaseClient,
  retailerId: string,
  details: BeneDetails
): Promise<{ success: boolean; beneCode?: string; error?: string; isNew?: boolean }> {
  const { accountNumber, ifsc, email, mobile } = details
  const beneName = sanitizeBeneName(details.beneName) || details.beneName
  const bankName = resolveBankName(ifsc, details.bankName)

  // 1. Check cache (this retailer first, then any row for same account+ifsc)
  if (!isKnteerMockMode()) {
    const { data: cached } = await supabase
      .from('knteer_beneficiaries')
      .select('bene_code')
      .eq('retailer_id', retailerId)
      .eq('account_number', accountNumber)
      .eq('ifsc_code', ifsc)
      .eq('is_active', true)
      .maybeSingle()

    if (cached?.bene_code) {
      console.log('[Knteer] beneCode cache hit:', { beneCode: cached.bene_code, accountNumber: accountNumber.slice(-4) })
      return { success: true, beneCode: cached.bene_code, isNew: false }
    }

    const { data: reused } = await supabase
      .from('knteer_beneficiaries')
      .select('bene_code')
      .eq('account_number', accountNumber)
      .eq('ifsc_code', ifsc)
      .not('bene_code', 'is', null)
      .limit(1)
      .maybeSingle()

    if (reused?.bene_code) {
      console.log('[Knteer] beneCode reused from existing row:', { beneCode: reused.bene_code, accountNumber: accountNumber.slice(-4) })
      return persistBene(supabase, retailerId, { ...details, beneName, bankName }, reused.bene_code, false)
    }
  }

  // 2. Call add-bene (retry once with sanitized name if first attempt fails)
  const callAddBene = async (name: string) => {
    const refId = generateRefId()
    const req: KnteerAddBeneRequest = { email, mobile, beneName: name, accountNumber, bankName, ifsc }
    return knteerClient.request<KnteerAddBeneResponse>({
      method: 'POST',
      endpoint: '/payout/v1/add-bene',
      body: req as unknown as Record<string, unknown>,
      refId,
    })
  }

  let res = await callAddBene(beneName)
  let beneCode = extractBeneCode(res.data)

  if (!beneCode && beneName !== details.beneName) {
    res = await callAddBene(details.beneName.trim())
    beneCode = extractBeneCode(res.data)
  }

  if (!beneCode) {
    const msg = (res.data as any)?.message || res.error || 'Beneficiary registration failed'
    console.error('[Knteer] add-bene failed:', { msg, httpStatus: res.httpStatus, data: res.data })
    return { success: false, error: msg }
  }

  return persistBene(supabase, retailerId, { ...details, beneName, bankName }, beneCode, true)
}

async function persistBene(
  supabase: SupabaseClient,
  retailerId: string,
  details: BeneDetails,
  beneCode: string,
  isNew: boolean
): Promise<{ success: boolean; beneCode?: string; error?: string; isNew?: boolean }> {
  const { error: upsertError } = await supabase
    .from('knteer_beneficiaries')
    .upsert(
      {
        retailer_id: retailerId,
        account_number: details.accountNumber,
        ifsc_code: details.ifsc,
        bene_code: beneCode,
        bene_name: details.beneName,
        bank_name: details.bankName,
        email: details.email,
        mobile: details.mobile,
        is_active: true,
        updated_at: new Date().toISOString(),
        ...(details.isBankVerified !== undefined && { is_bank_verified: details.isBankVerified }),
        ...(details.verifiedAt && { verified_at: details.verifiedAt }),
        ...(details.verifiedNameAtBank && { verified_name_at_bank: details.verifiedNameAtBank }),
        ...(details.verificationUtr && { verification_utr: details.verificationUtr }),
        ...(details.verificationOrderid && { verification_orderid: details.verificationOrderid }),
        ...(details.disclaimerAccepted !== undefined && { disclaimer_accepted: details.disclaimerAccepted }),
        ...(details.disclaimerAcceptedAt && { disclaimer_accepted_at: details.disclaimerAcceptedAt }),
      },
      { onConflict: 'retailer_id,account_number,ifsc_code' }
    )

  if (upsertError) {
    console.error('[Knteer] bene cache upsert failed:', upsertError.message)
  }

  console.log('[Knteer] beneCode persisted:', { beneCode, accountNumber: details.accountNumber.slice(-4), isNew })
  return { success: true, beneCode, isNew }
}
