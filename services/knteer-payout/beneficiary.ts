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
  const { accountNumber, ifsc, beneName, email, mobile, bankName } = details

  // 1. Check cache
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
  }

  // 2. Call add-bene
  const refId = generateRefId()
  const req: KnteerAddBeneRequest = { email, mobile, beneName, accountNumber, bankName, ifsc }

  const res = await knteerClient.request<KnteerAddBeneResponse>({
    method: 'POST',
    endpoint: '/payout/v1/add-bene',
    body: req as unknown as Record<string, unknown>,
    refId,
  })

  if (!res.success || !res.data) {
    return { success: false, error: res.error || 'add-bene request failed' }
  }

  const d = res.data
  if (!d.status || !d.data?.beneCode) {
    return { success: false, error: d.message || 'Beneficiary registration failed' }
  }

  const beneCode = d.data.beneCode

  // 3. Persist to cache (best-effort, upsert by account+ifsc)
  supabase
    .from('knteer_beneficiaries')
    .upsert(
      {
        retailer_id: retailerId,
        account_number: accountNumber,
        ifsc_code: ifsc,
        bene_code: beneCode,
        bene_name: beneName,
        bank_name: bankName,
        email,
        mobile,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'retailer_id,account_number,ifsc_code' }
    )
    .then(({ error }) => {
      if (error) console.error('[Knteer] bene cache upsert failed:', error.message)
    })

  console.log('[Knteer] beneCode registered:', { beneCode, accountNumber: accountNumber.slice(-4) })
  return { success: true, beneCode, isNew: true }
}
