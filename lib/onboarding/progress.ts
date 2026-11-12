/**
 * Canonical onboarding step model + progress computation.
 *
 * Shared by the public wizard (to resume at the first incomplete step after a
 * refresh / DigiLocker round-trip) and the admin panel (to show exactly where
 * an applicant is, even if they can't reach the applicant themselves).
 *
 * Pure TypeScript — safe to import on both server and client.
 */

import { getRequiredDocTypes } from './requiredDocuments'

export type OnboardStepKey =
  | 'welcome'
  | 'mobile'
  | 'email'
  | 'aadhaar'
  | 'pan'
  | 'business'
  | 'bank'
  | 'selfie_video'
  | 'documents'
  | 'declaration'
  | 'finish'

export interface OnboardStepDef {
  key: OnboardStepKey
  label: string
  /** Welcome is informational and never gates progress. */
  gating: boolean
}

export const ONBOARD_STEPS: OnboardStepDef[] = [
  { key: 'welcome', label: 'Welcome', gating: false },
  { key: 'mobile', label: 'Mobile', gating: true },
  { key: 'email', label: 'Email', gating: true },
  { key: 'aadhaar', label: 'Aadhaar', gating: true },
  { key: 'pan', label: 'PAN', gating: true },
  { key: 'business', label: 'Business', gating: true },
  { key: 'bank', label: 'Bank', gating: true },
  { key: 'selfie_video', label: 'Selfie & Video', gating: true },
  { key: 'documents', label: 'Documents', gating: true },
  { key: 'declaration', label: 'Declaration', gating: true },
  { key: 'finish', label: 'Finish', gating: true },
]

export interface ProgressInviteFields {
  status?: string | null
  phone_verified_at?: string | null
  email_verified_at?: string | null
  aadhaar_verified_at?: string | null
  created_partner_id?: string | null
  target_role?: string | null
}

/** Map of verification `type` -> `status` (e.g. { PAN_360: 'Success' }). */
export type VerifiedMap = Record<string, string>

function isDone(map: VerifiedMap, type: string, status = 'Success'): boolean {
  return map[type] === status
}

/**
 * Per-step completion, aligned 1:1 with ONBOARD_STEPS.
 */
export function computeStepStates(
  invite: ProgressInviteFields,
  verified: VerifiedMap,
  targetRole?: string
): boolean[] {
  const role = targetRole || invite.target_role || 'retailer'
  const requiredDocs = getRequiredDocTypes(role)
  const docsDone = requiredDocs.every((t) => isDone(verified, `DOCUMENT_${t}`, 'Uploaded'))
  const registered =
    !!invite.created_partner_id ||
    ['registered', 'verified', 'approved'].includes(String(invite.status || ''))

  return ONBOARD_STEPS.map((step) => {
    switch (step.key) {
      case 'welcome':
        return true
      case 'mobile':
        return !!invite.phone_verified_at
      case 'email':
        return !!invite.email_verified_at
      case 'aadhaar':
        return isDone(verified, 'AADHAAR_DIGILOCKER') || !!invite.aadhaar_verified_at
      case 'pan':
        return isDone(verified, 'PAN_360')
      case 'bank':
        return isDone(verified, 'BANK_PENNY_DROP')
      case 'business':
        return isDone(verified, 'BUSINESS_NAME')
      case 'selfie_video':
        return isDone(verified, 'DOCUMENT_SELFIE', 'Uploaded') && isDone(verified, 'ONBOARD_VIDEO', 'Uploaded')
      case 'documents':
        return docsDone
      case 'declaration':
        return isDone(verified, 'SELF_DECLARATION', 'Uploaded')
      case 'finish':
        return registered
      default:
        return false
    }
  })
}

export interface OnboardingProgress {
  states: boolean[]
  /** Wizard step index (0-based) the applicant should resume at. */
  currentIndex: number
  currentKey: OnboardStepKey
  currentLabel: string
  /** Completed gating steps. */
  completedCount: number
  totalCount: number
  percent: number
  complete: boolean
}

/**
 * Full progress summary. `currentIndex` is the first incomplete step (>= mobile),
 * or the Finish step when everything is done.
 */
export function computeOnboardingProgress(
  invite: ProgressInviteFields,
  verified: VerifiedMap,
  targetRole?: string
): OnboardingProgress {
  const states = computeStepStates(invite, verified, targetRole)

  // First incomplete gating step (skip Welcome at index 0).
  let currentIndex = ONBOARD_STEPS.length - 1
  for (let i = 1; i < ONBOARD_STEPS.length; i++) {
    if (!states[i]) {
      currentIndex = i
      break
    }
  }

  const gatingCount = ONBOARD_STEPS.filter((s) => s.gating).length
  const completedCount = ONBOARD_STEPS.reduce(
    (acc, s, i) => acc + (s.gating && states[i] ? 1 : 0),
    0
  )
  const complete = completedCount === gatingCount

  return {
    states,
    currentIndex,
    currentKey: ONBOARD_STEPS[currentIndex].key,
    currentLabel: complete ? 'Completed' : ONBOARD_STEPS[currentIndex].label,
    completedCount,
    totalCount: gatingCount,
    percent: Math.round((completedCount / gatingCount) * 100),
    complete,
  }
}
