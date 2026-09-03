import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

// A real super_admin OR a sub-admin granted the "settings" (or "all") department
// is treated as a full admin able to manage sub-admins. We use effective
// privilege (not a DB admin_type change) so access stays revocable by removing
// the department, and so such users remain editable/deletable by super admins.
function isEffectiveSuperAdmin(a: { admin_type?: string; department?: string; departments?: string[] } | null | undefined): boolean {
  if (!a) return false
  if (a.admin_type === 'super_admin') return true
  const depts = Array.isArray(a.departments) ? a.departments : []
  return a.department === 'settings' || a.department === 'all' || depts.includes('settings') || depts.includes('all')
}

// Remove the Supabase Auth login for an admin_users row. Best-effort: tries the
// admin_users.id directly, then falls back to matching by email (legacy rows can
// have an auth id that differs from admin_users.id). Never throws.
async function removeAuthLogin(supabase: any, adminId: string): Promise<void> {
  try {
    const { data: byId } = await supabase.auth.admin.getUserById(adminId)
    if (byId?.user) {
      await supabase.auth.admin.deleteUser(adminId)
      return
    }
  } catch { /* fall through to email lookup */ }

  try {
    const { data: rec } = await supabase.from('admin_users').select('email').eq('id', adminId).single()
    const email = (rec?.email || '').toLowerCase()
    if (!email) return
    // Scan auth users (bounded) to find the real id for this email.
    for (let page = 1; page <= 50; page++) {
      const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
      const users = data?.users || []
      const match = users.find((u: any) => (u.email || '').toLowerCase() === email)
      if (match) { await supabase.auth.admin.deleteUser(match.id); return }
      if (users.length < 1000) break
    }
  } catch (e: any) {
    console.warn('[Sub-Admins API] removeAuthLogin best-effort failed:', e?.message)
  }
}

// Handle CORS preflight requests
export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

// Get all sub-admins
export async function GET(request: NextRequest) {
  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      const response = NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Sub-Admins API] Auth method:', method, '| User:', admin?.email || 'none')
    
    if (!admin) {
      const response = NextResponse.json(
        { error: 'Session expired. Please log out and log back in.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }
    
    if (admin.role !== 'admin') {
      const response = NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // Verify admin is super_admin (or effective super-admin via "settings" dept)
    const { data: adminData } = await supabase
      .from('admin_users')
      .select('admin_type, department, departments')
      .eq('email', admin.email)
      .single()

    if (!isEffectiveSuperAdmin(adminData)) {
      const response = NextResponse.json(
        { error: 'Only super admins can manage sub-admins' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // Get all admins (including sub-admins)
    const { data: admins, error } = await supabase
      .from('admin_users')
      .select(`
        id,
        email,
        name,
        admin_type,
        department,
        departments,
        permissions,
        is_active,
        created_at,
        created_by
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching sub-admins:', error)
      const response = NextResponse.json(
        { error: 'Failed to fetch sub-admins' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    // Finance executives are backed by a sub-admin row too; keep them out of the
    // Sub-Admins list so the "Finance team" tab stays the single place to manage them.
    const { data: financeRows } = await supabase.from('finance_users').select('email')
    const financeEmails = new Set((financeRows || []).map((f: any) => (f.email || '').toLowerCase()))
    const visibleAdmins = (admins || []).filter((a: any) => !financeEmails.has((a.email || '').toLowerCase()))

    const response = NextResponse.json({
      success: true,
      admins: visibleAdmins
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error in GET sub-admins:', error)
    const response = NextResponse.json(
      { error: 'Failed to fetch sub-admins' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

// Create sub-admin
export async function POST(request: NextRequest) {
  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      const response = NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Sub-Admins API] Auth method:', method, '| User:', admin?.email || 'none')
    
    if (!admin) {
      const response = NextResponse.json(
        { error: 'Session expired. Please log out and log back in.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }
    
    if (admin.role !== 'admin') {
      const response = NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // Verify admin is super_admin (or effective super-admin via "settings" dept)
    const { data: adminData } = await supabase
      .from('admin_users')
      .select('id, admin_type, department, departments')
      .eq('email', admin.email)
      .single()

    if (!isEffectiveSuperAdmin(adminData)) {
      const response = NextResponse.json(
        { error: 'Only super admins can create sub-admins' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { email, name, password, departments, permissions, is_active = true } = body

    // Validation
    if (!email || !name || !password) {
      const response = NextResponse.json(
        { error: 'email, name, and password are required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Validate departments array
    const validDepartments = ['dashboard', 'onboarding', 'daily-report', 'business-analytics', 'pos-transactions', 'pos-reconciliation', 'retailers', 'distributors', 'master-distributors', 'scheme-management', 'partners', 'pos-machines', 'pos-history', 'pos-tracking-report', 'pos-rental-report', 'partner-invoices', 'pos-partner-api', 'razorpay-transactions', 'services', 'aeps', 'reports', 'service-transaction-report', 'pos-report', 'bill-payment-report', 'aeps-report', 'settlement-report', 'business-report', 'settlement', 'settlement-2-approvals', 'revenue-wallet', 'wallet-ledger', 'push-pull-report', 'wallet', 'commission', 'mdr', 'limits', 'reversals', 'capabilities', 'disputes', 'users', 'performance', 'subscriptions', 'portal-management', 'legal-agreements', 'settings', 'all']
    if (!departments || !Array.isArray(departments) || departments.length === 0) {
      const response = NextResponse.json(
        { error: 'At least one department must be selected' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Validate each department
    for (const dept of departments) {
      if (!validDepartments.includes(dept)) {
        const response = NextResponse.json(
          { error: `Invalid department: ${dept}` },
          { status: 400 }
        )
        return addCorsHeaders(request, response)
      }
    }

    if (password.length < 8) {
      const response = NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Check if email already exists
    const { data: existingAdmin } = await supabase
      .from('admin_users')
      .select('id')
      .eq('email', email)
      .single()

    if (existingAdmin) {
      const response = NextResponse.json(
        { error: 'Admin with this email already exists' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      console.error('Error creating auth user:', authError)
      const response = NextResponse.json(
        { error: authError.message || 'Failed to create admin user' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    // Create admin user record
    const legacyDepts = ['wallet', 'commission', 'mdr', 'limits', 'services', 'reversals', 'disputes', 'reports', 'users', 'settings', 'all']
    const singleDepartment = departments.includes('all') ? 'all' : (legacyDepts.includes(departments[0]) ? departments[0] : 'all')
    
    const { data: newAdmin, error: adminError } = await supabase
      .from('admin_users')
      .insert({
        id: authData.user.id,
        email,
        name,
        admin_type: 'sub_admin',
        department: singleDepartment, // For backward compatibility
        departments: departments, // New array field
        permissions: permissions || {},
        is_active,
        created_by: adminData.id
      })
      .select()
      .single()

    if (adminError) {
      // Rollback: delete auth user if admin creation fails
      await supabase.auth.admin.deleteUser(authData.user.id)
      console.error('Error creating admin record:', adminError)
      const response = NextResponse.json(
        { error: 'Failed to create admin record' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, admin, { activity_type: 'admin_create_sub_admin', activity_category: 'admin' }).catch(() => {})

    const response = NextResponse.json({
      success: true,
      message: 'Sub-admin created successfully',
      admin: newAdmin
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error in POST sub-admins:', error)
    const response = NextResponse.json(
      { error: 'Failed to create sub-admin' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

// Update sub-admin
export async function PUT(request: NextRequest) {
  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      const response = NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Sub-Admins API] Auth method:', method, '| User:', admin?.email || 'none')
    
    if (!admin) {
      const response = NextResponse.json(
        { error: 'Session expired. Please log out and log back in.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }
    
    if (admin.role !== 'admin') {
      const response = NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // Verify admin is super_admin (or effective super-admin via "settings" dept)
    const { data: adminData } = await supabase
      .from('admin_users')
      .select('id, admin_type, department, departments')
      .eq('email', admin.email)
      .single()

    if (!isEffectiveSuperAdmin(adminData)) {
      const response = NextResponse.json(
        { error: 'Only super admins can update sub-admins' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { id, name, departments, permissions, is_active } = body

    if (!id) {
      const response = NextResponse.json(
        { error: 'Admin ID is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Check if trying to update a super_admin
    const { data: targetAdmin } = await supabase
      .from('admin_users')
      .select('admin_type')
      .eq('id', id)
      .single()

    if (targetAdmin?.admin_type === 'super_admin') {
      const response = NextResponse.json(
        { error: 'Cannot update super admin' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // Validate departments if provided
    if (departments !== undefined) {
      if (!Array.isArray(departments) || departments.length === 0) {
        const response = NextResponse.json(
          { error: 'At least one department must be selected' },
          { status: 400 }
        )
        return addCorsHeaders(request, response)
      }
      const validDepartments = ['dashboard', 'onboarding', 'daily-report', 'business-analytics', 'pos-transactions', 'pos-reconciliation', 'retailers', 'distributors', 'master-distributors', 'scheme-management', 'partners', 'pos-machines', 'pos-history', 'pos-tracking-report', 'pos-rental-report', 'partner-invoices', 'pos-partner-api', 'razorpay-transactions', 'services', 'aeps', 'reports', 'service-transaction-report', 'pos-report', 'bill-payment-report', 'aeps-report', 'settlement-report', 'business-report', 'settlement', 'settlement-2-approvals', 'revenue-wallet', 'wallet-ledger', 'push-pull-report', 'wallet', 'commission', 'mdr', 'limits', 'reversals', 'capabilities', 'disputes', 'users', 'performance', 'subscriptions', 'portal-management', 'legal-agreements', 'settings', 'all']
      for (const dept of departments) {
        if (!validDepartments.includes(dept)) {
          const response = NextResponse.json(
            { error: `Invalid department: ${dept}` },
            { status: 400 }
          )
          return addCorsHeaders(request, response)
        }
      }
    }

    // Update admin
    const updateData: any = {}
    if (name) updateData.name = name
    if (departments !== undefined) {
      updateData.departments = departments
      // Also update single department for backward compatibility
      const legacyDepts = ['wallet', 'commission', 'mdr', 'limits', 'services', 'reversals', 'disputes', 'reports', 'users', 'settings', 'all']
      updateData.department = departments.includes('all') ? 'all' : (legacyDepts.includes(departments[0]) ? departments[0] : 'all')
    }
    if (permissions !== undefined) updateData.permissions = permissions
    if (is_active !== undefined) updateData.is_active = is_active

    // When reactivating, ensure the auth account exists (it may have been deleted)
    let authRecreated = false
    if (is_active === true) {
      const { data: authCheck } = await supabase.auth.admin.getUserById(id)
      if (!authCheck?.user) {
        const { data: adminRecord } = await supabase
          .from('admin_users')
          .select('email')
          .eq('id', id)
          .single()

        if (adminRecord?.email) {
          const tempPassword = `Temp${Date.now()}!${Math.random().toString(36).slice(2, 8)}`
          const { error: createErr } = await supabase.auth.admin.createUser({
            uid: id,
            email: adminRecord.email,
            password: tempPassword,
            email_confirm: true,
          })
          if (createErr) {
            // An auth account with this email already exists (its id just differs
            // from admin_users.id, which is why getUserById missed it). The account
            // is NOT actually missing — don't block the tab/permission update.
            const alreadyExists = /already.*(registered|exists)|email_exists|has already been registered/i.test(
              createErr.message || ''
            )
            if (!alreadyExists) {
              console.error('Error recreating auth account:', createErr)
              const response = NextResponse.json(
                { error: `Auth account missing and could not be recreated: ${createErr.message}` },
                { status: 500 }
              )
              return addCorsHeaders(request, response)
            }
            console.warn(`[Sub-Admins API] Auth account for ${adminRecord.email} already exists (id mismatch) — skipping recreation`)
          } else {
            authRecreated = true
            console.log(`[Sub-Admins API] Recreated auth account for ${adminRecord.email}`)
          }
        }
      }
    }

    const { data: updatedAdmin, error } = await supabase
      .from('admin_users')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating sub-admin:', error)
      const response = NextResponse.json(
        { error: 'Failed to update sub-admin' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, admin, { activity_type: 'admin_update_sub_admin', activity_category: 'admin' }).catch(() => {})

    const msg = authRecreated
      ? 'Sub-admin reactivated. Auth account was recreated — please reset their password.'
      : 'Sub-admin updated successfully'

    const response = NextResponse.json({
      success: true,
      message: msg,
      admin: updatedAdmin,
      auth_recreated: authRecreated,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error in PUT sub-admins:', error)
    const response = NextResponse.json(
      { error: 'Failed to update sub-admin' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

// Delete sub-admin
export async function DELETE(request: NextRequest) {
  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      const response = NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Sub-Admins API] Auth method:', method, '| User:', admin?.email || 'none')
    
    if (!admin) {
      const response = NextResponse.json(
        { error: 'Session expired. Please log out and log back in.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }
    
    if (admin.role !== 'admin') {
      const response = NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // Verify admin is super_admin (or effective super-admin via "settings" dept)
    const { data: adminData } = await supabase
      .from('admin_users')
      .select('id, admin_type, department, departments')
      .eq('email', admin.email)
      .single()

    if (!isEffectiveSuperAdmin(adminData)) {
      const response = NextResponse.json(
        { error: 'Only super admins can delete sub-admins' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      const response = NextResponse.json(
        { error: 'Admin ID is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Check if trying to delete a super_admin
    const { data: targetAdmin } = await supabase
      .from('admin_users')
      .select('admin_type')
      .eq('id', id)
      .single()

    if (targetAdmin?.admin_type === 'super_admin') {
      const response = NextResponse.json(
        { error: 'Cannot delete super admin' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // Remove the Supabase Auth login so the account can no longer sign in.
    // The admin_users.id may not match the auth user's id (legacy data), so we
    // delete by id and, if that misses, by resolving the real auth user via email.
    await removeAuthLogin(supabase, id)

    // The admin_audit_log is an immutable, append-only compliance record with a
    // FK to admin_users. If this admin has ANY audited actions, the row cannot be
    // hard-deleted (and ON DELETE SET NULL/CASCADE are rejected by the append-only
    // trigger). In that case we soft-delete: deactivate so they lose all access
    // while the audit trail stays intact.
    const { count: auditCount } = await supabase
      .from('admin_audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('admin_id', id)

    if ((auditCount ?? 0) > 0) {
      const { error: deactErr } = await supabase
        .from('admin_users')
        .update({ is_active: false })
        .eq('id', id)

      if (deactErr) {
        console.error('Error deactivating sub-admin:', deactErr.message)
        const response = NextResponse.json(
          { error: `Failed to remove sub-admin: ${deactErr.message}` },
          { status: 500 }
        )
        return addCorsHeaders(request, response)
      }

      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, admin, { activity_type: 'admin_delete_sub_admin', activity_category: 'admin' }).catch(() => {})

      const response = NextResponse.json({
        success: true,
        soft_deleted: true,
        message: `Sub-admin deactivated. They can no longer sign in. The account was kept (not permanently deleted) because it has ${auditCount} immutable audit-log record(s).`,
      })
      return addCorsHeaders(request, response)
    }

    // No audit history — safe to hard-delete.
    // Nullify created_by references pointing to this admin (avoid FK violation)
    await supabase
      .from('admin_users')
      .update({ created_by: null })
      .eq('created_by', id)

    // Delete admin record
    const { error } = await supabase
      .from('admin_users')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting sub-admin:', error.message, error.code, error.details)
      const response = NextResponse.json(
        { error: `Failed to delete sub-admin: ${error.message}` },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, admin, { activity_type: 'admin_delete_sub_admin', activity_category: 'admin' }).catch(() => {})

    const response = NextResponse.json({
      success: true,
      message: 'Sub-admin deleted successfully'
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error in DELETE sub-admins:', error)
    const response = NextResponse.json(
      { error: 'Failed to delete sub-admin' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

