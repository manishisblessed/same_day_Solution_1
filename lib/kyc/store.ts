/**
 * Server-side persistence for AEPS KYC verification results.
 * Uses the service-role client; callers must already have authenticated the user.
 */
import { createClient } from '@supabase/supabase-js'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface KycVerificationRow {
  user_id: string
  pan?: string | null
  pan_name?: string | null
  pan_verified_at?: string | null
  aadhaar_name?: string | null
  aadhaar_verification_id?: string | null
  aadhaar_verified_at?: string | null
  bank_account_hash?: string | null
  bank_ifsc?: string | null
  bank_account_name?: string | null
  bank_verified_at?: string | null
}

/** Upsert a partial verification patch for a user (only provided columns change). */
export async function upsertKycVerification(
  userId: string,
  patch: Partial<Omit<KycVerificationRow, 'user_id'>>
): Promise<void> {
  try {
    await sb()
      .from('aeps_kyc_verifications')
      .upsert(
        { user_id: userId, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
  } catch (e: any) {
    // Non-fatal: verification response still returns; onboarding will re-check.
    console.error('[KYC Store] upsert failed:', e?.message)
  }
}

export async function getKycVerification(userId: string): Promise<KycVerificationRow | null> {
  const { data } = await sb()
    .from('aeps_kyc_verifications')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as KycVerificationRow) || null
}
