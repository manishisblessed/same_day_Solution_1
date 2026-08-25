/**
 * Shared server-side helpers for the onboarding invite wizard.
 * Used by both the authenticated invite-management routes and the public
 * token-scoped wizard routes. Always call with a service-role Supabase client.
 */

import crypto from 'crypto'
import { getEnv } from '@/lib/env'
import type { OnboardingInvite, OnboardingVerification } from '@/types/database.types'

export const INVITE_TABLE = 'onboarding_invites'
export const VERIFICATION_TABLE = 'onboarding_verifications'
export const OTP_TABLE = 'onboarding_otps'

export function generateInviteToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

export function inviteExpiryDate(): string {
  const days = parseInt(getEnv('ONBOARDING_INVITE_EXPIRY_DAYS') || '7', 10) || 7
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

export function appUrl(): string {
  return (getEnv('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000').replace(/\/$/, '')
}

export function inviteLink(token: string): string {
  return `${appUrl()}/onboard?token=${encodeURIComponent(token)}`
}

/** Statuses in which the wizard is still active/usable by the invitee. */
export const OPEN_INVITE_STATUSES = ['pending', 'registered', 'verified', 'resubmit']

export interface LoadedInvite {
  invite: OnboardingInvite | null
  error?: string
  expired?: boolean
}

/**
 * Load an invite by token and lazily flip it to `expired` when past validity.
 */
export async function loadInviteByToken(
  supabase: any,
  token: string
): Promise<LoadedInvite> {
  const { data, error } = await supabase
    .from(INVITE_TABLE)
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (error) return { invite: null, error: error.message }
  if (!data) return { invite: null, error: 'Invite not found' }

  const invite = data as OnboardingInvite

  // Lazy expiry: only for still-open invites.
  if (
    OPEN_INVITE_STATUSES.includes(invite.status) &&
    invite.status !== 'approved' &&
    new Date(invite.expires_at).getTime() < Date.now()
  ) {
    await supabase
      .from(INVITE_TABLE)
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', invite.id)
    invite.status = 'expired'
    return { invite, expired: true }
  }

  return { invite }
}

/**
 * Upsert a verification result for an invite (one row per (invite, type)).
 */
export async function upsertVerification(
  supabase: any,
  args: {
    inviteId: string
    type: string
    status?: OnboardingVerification['status']
    verifiedName?: string | null
    payload?: Record<string, any>
  }
): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from(VERIFICATION_TABLE)
    .upsert(
      {
        invite_id: args.inviteId,
        type: args.type,
        status: args.status || 'Success',
        verified_name: args.verifiedName ?? null,
        response_payload: args.payload || {},
        updated_at: now,
      },
      { onConflict: 'invite_id,type' }
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function getVerifications(
  supabase: any,
  inviteId: string
): Promise<OnboardingVerification[]> {
  const { data } = await supabase
    .from(VERIFICATION_TABLE)
    .select('*')
    .eq('invite_id', inviteId)
  return (data || []) as OnboardingVerification[]
}

/**
 * Check whether an email/phone is already taken by an existing partner (any
 * role table) or an active invite. Returns a human-readable reason or null.
 */
export async function findDuplicateIdentity(
  supabase: any,
  args: { email: string; phone: string; excludeInviteId?: string }
): Promise<string | null> {
  const email = args.email.toLowerCase()
  const roleTables = ['retailers', 'distributors', 'master_distributors'] as const

  for (const table of roleTables) {
    const { data } = await supabase
      .from(table)
      .select('id')
      .or(`email.eq.${email},phone.eq.${args.phone}`)
      .limit(1)
    if (data && data.length > 0) {
      return `A ${table.slice(0, -1)} already exists with this email or phone`
    }
  }

  let q = supabase
    .from(INVITE_TABLE)
    .select('id')
    .in('status', OPEN_INVITE_STATUSES)
    .or(`email.eq.${email},phone.eq.${args.phone}`)
  if (args.excludeInviteId) q = q.neq('id', args.excludeInviteId)
  const { data: invites } = await q.limit(1)
  if (invites && invites.length > 0) {
    return 'An active invite already exists for this email or phone'
  }

  return null
}
