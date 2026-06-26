import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { currentPassword, newPassword } = await request.json()

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Current password and new password are required' }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })
    }

    const adminClient = getAdminClient()

    // Verify current password using a temporary anon client.
    // Use a separate try/catch so we can surface the real error instead of
    // always saying "incorrect password" (e.g. when CAPTCHA blocks the call).
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const anonClient = createClient(supabaseUrl, supabaseAnonKey)
    const { error: signInError } = await anonClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })

    if (signInError) {
      const msg = signInError.message?.toLowerCase() || ''
      if (msg.includes('captcha') || msg.includes('rate') || msg.includes('too many')) {
        // CAPTCHA or rate-limit from Supabase Auth — don't blame the password
        console.warn('[change-password] signIn blocked by Supabase:', signInError.message)
        return NextResponse.json(
          { error: 'Verification temporarily unavailable. Please try again in a few minutes.' },
          { status: 429 }
        )
      }
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    // Update password
    const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
      password: newPassword,
    })

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    // Clear login lockout so the user can log in immediately with the new password
    try {
      await adminClient.from('login_attempts').delete()
        .eq('email', user.email.toLowerCase())
        .eq('success', false)
        .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    } catch {
      // non-fatal
    }

    return NextResponse.json({ success: true, message: 'Password changed successfully' })
  } catch (error: any) {
    console.error('Change password error:', error)
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 })
  }
}
