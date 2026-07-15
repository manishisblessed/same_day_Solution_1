import { supabase } from './supabase/client'
import { AuthUser, UserRole } from '@/types/database.types'
import { getApiUrl, getAccessToken } from './api-client'

// Auth/session endpoints that touch the DB with the Supabase SERVICE ROLE key
// MUST run on the EC2 backend. AWS Amplify's Next.js SSR runtime does not expose
// non-NEXT_PUBLIC env vars, so getSupabaseAdmin() throws there → 500 → login hangs.
// getApiUrl() returns the EC2 URL in production and a relative path on localhost.
function authApiUrl(path: string): string {
  return getApiUrl(path)
}

const SESSION_TOKEN_KEY = 'sds_session_token'

export function generateSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${crypto.randomUUID()}-${Date.now().toString(36)}`
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export function getStoredSessionToken(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(SESSION_TOKEN_KEY) } catch { return null }
}

export function setStoredSessionToken(token: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(SESSION_TOKEN_KEY, token) } catch {}
}

export function clearStoredSessionToken(): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(SESSION_TOKEN_KEY) } catch {}
}

/**
 * Best-effort call to the server-side login throttle. Never throws on network
 * errors (so a guard outage can't lock out all logins), except when the guard
 * explicitly reports the account is locked.
 */
async function loginGuardCheck(email: string): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const res = await fetch(authApiUrl('/api/auth/login-guard'), {
      method: 'POST',
      credentials: 'include',
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
    await fetch(authApiUrl('/api/auth/login-guard'), {
      method: 'POST',
      credentials: 'include',
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

  // Register single-session token (invalidates any previous session for this user)
  if (typeof window !== 'undefined') {
    const sessionToken = generateSessionToken()
    setStoredSessionToken(sessionToken)
    try {
      await fetch(authApiUrl('/api/auth/register-session'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authData.session.access_token}`,
        },
        body: JSON.stringify({ session_token: sessionToken }),
      })
    } catch {
      // Best-effort — don't block login if session registration fails
    }
  }

  return { user, session: authData.session }
}

// Special error class so the login page can detect a 2FA challenge
export class TwoFactorRequiredError extends Error {
  constructor(public email: string, public role: UserRole) {
    super('2FA_REQUIRED')
    this.name = 'TwoFactorRequiredError'
  }
}

async function check2FAStatus(email: string): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    const res = await fetch(authApiUrl('/api/auth/2fa/status'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const data = await res.json()
    return !!data.enabled
  } catch {
    return false
  }
}

async function authenticateWithPassword(
  email: string,
  password: string,
  captchaToken?: string
): Promise<{ user: any; session: any }> {
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  })

  if (authError) {
    const msg = authError.message?.toLowerCase() || ''
    if (captchaToken && (msg.includes('captcha') || msg.includes('bad request'))) {
      console.warn('[Auth] CAPTCHA token rejected, retrying without it')
      const { data: retryData, error: retryError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (!retryError && retryData?.user) {
        await loginGuardRecord(email, true)
        return retryData
      }
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
  return authData
}

export async function signIn(email: string, password: string, role: UserRole, captchaToken?: string) {
  try {
    await loginGuardCheck(email)

    const authData = await authenticateWithPassword(email, password, captchaToken)

    // Check if this user has 2FA enabled
    const has2FA = await check2FAStatus(email)
    if (has2FA) {
      // Sign out of Supabase temporarily — we'll re-auth after 2FA verification.
      // Store credentials temporarily in sessionStorage for the 2FA completion step.
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('_2fa_pending', JSON.stringify({ email, role }))
      }
      await supabase.auth.signOut()
      throw new TwoFactorRequiredError(email, role)
    }

    return await completeSignIn(authData, role, email)
  } catch (error: any) {
    if (error instanceof TwoFactorRequiredError) throw error
    throw new Error(error.message || 'Authentication failed')
  }
}

/**
 * Complete login after 2FA verification.
 * Re-authenticates with Supabase and completes sign-in.
 */
export async function complete2FALogin(
  email: string,
  password: string,
  role: UserRole,
  totpCode: string,
  isBackup?: boolean
) {
  try {
    // Verify TOTP code first
    const verifyRes = await fetch(authApiUrl('/api/auth/2fa/verify'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: totpCode, is_backup: isBackup }),
    })

    const verifyData = await verifyRes.json()
    if (!verifyRes.ok || !verifyData.valid) {
      throw new Error(verifyData.error || 'Invalid verification code')
    }

    // 2FA passed — re-authenticate with Supabase
    const authData = await authenticateWithPassword(email, password)

    // Clean up pending state
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('_2fa_pending')
    }

    return await completeSignIn(authData, role, email)
  } catch (error: any) {
    throw new Error(error.message || '2FA verification failed')
  }
}

export async function signOut() {
  // Invalidate session token before signing out of Supabase
  const token = getStoredSessionToken()
  if (token) {
    try {
      const accessToken = await getAccessToken()
      await fetch(authApiUrl('/api/auth/end-session'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ session_token: token, reason: 'logout' }),
      })
    } catch {
      // Best-effort
    }
    clearStoredSessionToken()
  }
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

