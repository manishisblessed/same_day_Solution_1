import { supabase } from './supabase/client'
import { AuthUser, UserRole } from '@/types/database.types'

/**
 * Best-effort call to the server-side login throttle. Never throws on network
 * errors (so a guard outage can't lock out all logins), except when the guard
 * explicitly reports the account is locked.
 */
async function loginGuardCheck(email: string): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const res = await fetch('/api/auth/login-guard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check', email }),
    })
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}))
      const mins = data?.retry_after_minutes || 15
      throw new Error(`Too many failed login attempts. Please try again in about ${mins} minute(s).`)
    }
  } catch (e: any) {
    // Re-throw only the explicit lockout message; swallow network errors.
    if (e?.message?.startsWith('Too many failed login attempts')) throw e
  }
}

async function loginGuardRecord(email: string, success: boolean): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    await fetch('/api/auth/login-guard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', email, success }),
    })
  } catch {
    // ignore — recording is best-effort
  }
}

async function completeSignIn(
  authData: { user: any; session: any },
  role: UserRole,
  email: string
) {
  if (authData.session && typeof window !== 'undefined') {
    try {
      const syncResponse = await fetch('/api/auth/sync-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          access_token: authData.session.access_token,
          refresh_token: authData.session.refresh_token,
        }),
      })
      if (!syncResponse.ok) {
        console.warn('Session sync returned non-OK status:', syncResponse.status)
      }
    } catch (syncError) {
      console.error('CRITICAL: Failed to sync session to cookies:', syncError)
    }
  }

  let tableName = ''
  switch (role) {
    case 'retailer': tableName = 'retailers'; break
    case 'distributor': tableName = 'distributors'; break
    case 'master_distributor': tableName = 'master_distributors'; break
    case 'admin': tableName = 'admin_users'; break
    case 'partner': tableName = 'partners'; break
    case 'finance_executive': tableName = 'finance_users'; break
  }

  let query = supabase.from(tableName).select('*').eq('email', email)
  if (role === 'finance_executive') {
    query = query.eq('is_active', true)
  } else if (role !== 'admin') {
    query = query.eq('status', 'active')
  }

  const { data, error } = await query.single()
  if (error || !data) {
    await supabase.auth.signOut()
    const roleLabel = role.replace('_', ' ')
    throw new Error(
      `No active ${roleLabel} account found for this email. ` +
      `Please check that you selected the correct account type.`
    )
  }

  const user: AuthUser = {
    id: authData.user.id,
    email: authData.user.email!,
    role,
    partner_id: role === 'partner' ? data.id : data.partner_id,
    name: data.name,
    ...(role === 'finance_executive' && 'phone' in data
      ? { phone: (data as { phone?: string }).phone }
      : {}),
  }

  return { user, session: authData.session }
}

export async function signIn(email: string, password: string, role: UserRole, captchaToken?: string) {
  try {
    // Brute-force protection: block if this account is currently locked out.
    await loginGuardCheck(email)

    // First, authenticate with Supabase Auth. When CAPTCHA is enabled in
    // Supabase Auth, the captchaToken (Cloudflare Turnstile) is required.
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    })

    if (authError) {
      // If captcha token was sent and caused the failure, retry without it.
      // This handles domain-mismatch where Turnstile token is invalid for the
      // current hostname but Supabase doesn't strictly require CAPTCHA.
      const msg = authError.message?.toLowerCase() || ''
      if (captchaToken && (msg.includes('captcha') || msg.includes('bad request'))) {
        console.warn('[Auth] CAPTCHA token rejected, retrying without it')
        const { data: retryData, error: retryError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (!retryError && retryData?.user) {
          await loginGuardRecord(email, true)
          return await completeSignIn(retryData, role, email)
        }
        // If retry also failed, fall through to original error handling
        if (retryError) {
          const retryMsg = retryError.message?.toLowerCase() || ''
          if (retryMsg.includes('invalid login credentials') || retryMsg.includes('invalid_credentials')) {
            await loginGuardRecord(email, false)
            throw new Error('Incorrect email or password. Please try again.')
          }
          if (retryMsg.includes('captcha')) {
            await loginGuardRecord(email, false)
            throw new Error(
              'CAPTCHA verification failed. Please check that your domain is authorized ' +
              'in Cloudflare Turnstile and Supabase Auth settings.'
            )
          }
        }
      }

      await loginGuardRecord(email, false)
      if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
        throw new Error('Incorrect email or password. Please try again.')
      }
      if (msg.includes('email not confirmed')) {
        throw new Error('Your email is not verified. Please check your inbox for a confirmation link.')
      }
      if (msg.includes('captcha')) {
        throw new Error(
          'CAPTCHA verification failed. Please check that your domain is authorized ' +
          'in Cloudflare Turnstile and Supabase Auth settings.'
        )
      }
      throw authError
    }

    await loginGuardRecord(email, true)
    return await completeSignIn(authData, role, email)
  } catch (error: any) {
    throw new Error(error.message || 'Authentication failed')
  }
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error || !user) return null

    // Check which table the user belongs to
    // Use maybeSingle() instead of single() to avoid 406 errors when user doesn't belong to a table
    const [retailer, distributor, masterDistributor, admin, finance, partner] = await Promise.all([
      supabase.from('retailers').select('*').eq('email', user.email!).eq('status', 'active').maybeSingle(),
      supabase.from('distributors').select('*').eq('email', user.email!).eq('status', 'active').maybeSingle(),
      supabase.from('master_distributors').select('*').eq('email', user.email!).eq('status', 'active').maybeSingle(),
      supabase.from('admin_users').select('*').eq('email', user.email!).maybeSingle(),
      supabase.from('finance_users').select('*').eq('email', user.email!).eq('is_active', true).maybeSingle(),
      supabase.from('partners').select('*').eq('email', user.email!).eq('status', 'active').maybeSingle(),
    ])

    // Precedence: admin and finance before hierarchy users (matches server-side auth).
    if (admin.data && !admin.error) {
      return {
        id: user.id,
        email: user.email!,
        role: 'admin',
        name: admin.data.name,
      }
    }
    if (finance.data && !finance.error) {
      return {
        id: user.id,
        email: user.email!,
        role: 'finance_executive',
        name: finance.data.name,
        phone: finance.data.phone ?? undefined,
      }
    }
    if (masterDistributor.data && !masterDistributor.error) {
      return {
        id: user.id,
        email: user.email!,
        role: 'master_distributor',
        partner_id: masterDistributor.data.partner_id,
        name: masterDistributor.data.name,
      }
    }
    if (distributor.data && !distributor.error) {
      return {
        id: user.id,
        email: user.email!,
        role: 'distributor',
        partner_id: distributor.data.partner_id,
        name: distributor.data.name,
      }
    }
    if (retailer.data && !retailer.error) {
      return {
        id: user.id,
        email: user.email!,
        role: 'retailer',
        partner_id: retailer.data.partner_id,
        name: retailer.data.name,
      }
    }
    if (partner.data && !partner.error) {
      return {
        id: user.id,
        email: user.email!,
        role: 'partner',
        partner_id: partner.data.id,
        name: partner.data.name,
      }
    }

    return null
  } catch (error) {
    return null
  }
}

