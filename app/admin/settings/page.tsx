'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import TurnstileWidget, { TurnstileHandle, isCaptchaEnabled } from '@/components/TurnstileWidget'
import AdminSidebar from '@/components/AdminSidebar'
import { 
  Lock, Eye, EyeOff, CheckCircle, AlertCircle, 
  User, Mail, Shield, Save, ArrowLeft, Users, Plus, Edit, Trash2, X, IndianRupee, Key,
  Building2, Archive, ArchiveRestore
} from 'lucide-react'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import TwoFactorSetup from '@/components/TwoFactorSetup'

export default function AdminSettings() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'profile' | 'password' | 'security' | 'sub-admins' | 'finance-team' | 'companies'>('profile')

  // POS companies (archive/show) state
  const [posCompanies, setPosCompanies] = useState<Array<{ slug: string; name: string; shortName: string; archived: boolean }>>([])
  const [loadingCompanies, setLoadingCompanies] = useState(false)
  const [savingCompanySlug, setSavingCompanySlug] = useState<string | null>(null)
  
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [pwCaptchaToken, setPwCaptchaToken] = useState('')
  const [pwCaptchaError, setPwCaptchaError] = useState(false)
  const pwTurnstileRef = useRef<TurnstileHandle>(null)
  const [showSubAdminPassword, setShowSubAdminPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [adminInfo, setAdminInfo] = useState<any>(null)
  
  // Sub-admin management state
  const [subAdmins, setSubAdmins] = useState<any[]>([])
  const [loadingSubAdmins, setLoadingSubAdmins] = useState(false)
  const [showSubAdminModal, setShowSubAdminModal] = useState(false)
  const [editingSubAdmin, setEditingSubAdmin] = useState<any>(null)
  const [subAdminFormData, setSubAdminFormData] = useState({
    email: '',
    name: '',
    password: '',
    departments: ['wallet'] as string[],
    is_active: true
  })

  const [financeUsers, setFinanceUsers] = useState<any[]>([])
  const [loadingFinanceUsers, setLoadingFinanceUsers] = useState(false)
  const [showFinanceModal, setShowFinanceModal] = useState(false)
  const [creatingFinance, setCreatingFinance] = useState(false)
  const [showFinancePassword, setShowFinancePassword] = useState(false)
  const [financeForm, setFinanceForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
  })

  // Reset password modal state
  const [showResetPwModal, setShowResetPwModal] = useState(false)
  const [resetPwTarget, setResetPwTarget] = useState<{ id: string; email: string; name: string; role: string } | null>(null)
  const [resetPwValue, setResetPwValue] = useState('')
  const [resetPwConfirm, setResetPwConfirm] = useState('')
  const [resetPwLoading, setResetPwLoading] = useState(false)
  const [showResetPwText, setShowResetPwText] = useState(false)

  const canManageFinanceUsers =
    adminInfo?.admin_type === 'super_admin' ||
    adminInfo?.department === 'users' ||
    adminInfo?.department === 'all' ||
    (Array.isArray(adminInfo?.departments) &&
      (adminInfo.departments.includes('users') || adminInfo.departments.includes('all')))

  const availableDepartments = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'retailers', label: 'Retailers' },
    { id: 'distributors', label: 'Distributors' },
    { id: 'master-distributors', label: 'Master Distributors' },
    { id: 'scheme-management', label: 'Scheme Management' },
    { id: 'partners', label: 'Partners' },
    { id: 'pos-machines', label: 'POS Machines' },
    { id: 'pos-history', label: 'POS History' },
    { id: 'pos-tracking-report', label: 'POS Tracking Report' },
    { id: 'pos-rental-report', label: 'POS Rental Report' },
    { id: 'pos-partner-api', label: 'POS Partner API' },
    { id: 'pos-transactions', label: 'POS Transactions' },
    { id: 'services', label: 'Services' },
    { id: 'aeps', label: 'AEPS Management' },
    { id: 'reports', label: 'Reports' },
    { id: 'business-report', label: 'Business Report' },
    { id: 'settlement', label: 'Settlement' },
    { id: 'revenue-wallet', label: 'Revenue Wallet' },
    { id: 'wallet-ledger', label: 'Wallet Ledger' },
    { id: 'wallet', label: 'Wallet' },
    { id: 'commission', label: 'Commission' },
    { id: 'mdr', label: 'MDR' },
    { id: 'limits', label: 'Limits' },
    { id: 'reversals', label: 'Reversals' },
    { id: 'disputes', label: 'Disputes' },
    { id: 'users', label: 'Users' },
    { id: 'performance', label: 'Performance' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'portal-management', label: 'Portal Management' },
    { id: 'legal-agreements', label: 'Legal Agreements' },
    { id: 'settings', label: 'Settings' },
    { id: 'all', label: 'Select All' }
  ]

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    const fetchAdminInfo = async () => {
      if (user?.email) {
        try {
          const { data, error } = await supabase
            .from('admin_users')
            .select('*')
            .eq('email', user.email)
            .single()
          
          if (error) throw error
          setAdminInfo(data)
        } catch (error) {
          console.error('Error fetching admin info:', error)
        }
      }
    }
    fetchAdminInfo()
  }, [user])

  // Fetch sub-admins
  useEffect(() => {
    if (activeTab === 'sub-admins' && user?.role === 'admin') {
      fetchSubAdmins()
    }
  }, [activeTab, user])

  const fetchPosCompanies = async () => {
    setLoadingCompanies(true)
    try {
      const response = await apiFetch('/api/admin/pos-companies')
      const data = await response.json()
      if (response.ok && data.success) {
        setPosCompanies(data.companies || [])
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to load companies' })
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Failed to load companies' })
    } finally {
      setLoadingCompanies(false)
    }
  }

  const toggleCompanyArchived = async (slug: string, archived: boolean) => {
    setSavingCompanySlug(slug)
    // optimistic update
    setPosCompanies(prev => prev.map(c => (c.slug === slug ? { ...c, archived } : c)))
    try {
      const response = await apiFetch('/api/admin/pos-companies', {
        method: 'POST',
        body: JSON.stringify({ slug, archived }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update company')
      }
      setMessage({ type: 'success', text: `${slug} ${archived ? 'archived' : 'activated'}` })
    } catch (e: any) {
      // revert on failure
      setPosCompanies(prev => prev.map(c => (c.slug === slug ? { ...c, archived: !archived } : c)))
      setMessage({ type: 'error', text: e?.message || 'Failed to update company' })
    } finally {
      setSavingCompanySlug(null)
    }
  }

  useEffect(() => {
    if (activeTab === 'companies' && user?.role === 'admin') {
      fetchPosCompanies()
    }
  }, [activeTab, user])

  const fetchFinanceUsers = async () => {
    setLoadingFinanceUsers(true)
    try {
      const response = await apiFetch('/api/admin/finance-users')
      const data = await response.json()
      if (response.ok && data.success) {
        setFinanceUsers(data.users || [])
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to load finance users' })
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Failed to load finance users' })
    } finally {
      setLoadingFinanceUsers(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'finance-team' && user?.role === 'admin' && canManageFinanceUsers) {
      fetchFinanceUsers()
    }
  }, [activeTab, user, canManageFinanceUsers])

  const fetchSubAdmins = async () => {
    setLoadingSubAdmins(true)
    try {
      const response = await apiFetch('/api/admin/sub-admins')
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `Server error (${response.status})` }))
        setMessage({ type: 'error', text: errData.error || `Failed to fetch sub-admins (${response.status})` })
        return
      }
      const data = await response.json()
      if (data.success) {
        setSubAdmins(data.admins || [])
      } else if (data.error) {
        setMessage({ type: 'error', text: data.error })
      }
    } catch (error: any) {
      console.error('Error fetching sub-admins:', error)
      setMessage({ type: 'error', text: error?.message || 'Failed to load sub-admins. Please refresh the page.' })
    } finally {
      setLoadingSubAdmins(false)
    }
  }

  const handleCreateSubAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)

    if (!subAdminFormData.email || !subAdminFormData.name || (!editingSubAdmin && !subAdminFormData.password)) {
      setMessage({ type: 'error', text: 'All fields are required' })
      return
    }

    if (subAdminFormData.password && subAdminFormData.password.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters long' })
      return
    }

    if (!subAdminFormData.departments || subAdminFormData.departments.length === 0) {
      setMessage({ type: 'error', text: 'At least one department must be selected' })
      return
    }

    setLoading(true)
    try {
      const url = '/api/admin/sub-admins'
      const method = editingSubAdmin ? 'PUT' : 'POST'

      const body = editingSubAdmin
        ? { id: editingSubAdmin.id, ...subAdminFormData, password: undefined }
        : subAdminFormData

      const response = await apiFetch(url, {
        method,
        body: JSON.stringify(body)
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save sub-admin')
      }

      setMessage({ type: 'success', text: data.message || 'Sub-admin saved successfully!' })
      setShowSubAdminModal(false)
      setEditingSubAdmin(null)
      setSubAdminFormData({
        email: '',
        name: '',
        password: '',
        departments: ['wallet'],
        is_active: true
      })
      fetchSubAdmins()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to save sub-admin' })
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSubAdmin = async (id: string) => {
    if (!confirm('Are you sure you want to delete this sub-admin?')) return

    try {
      const response = await apiFetch(`/api/admin/sub-admins?id=${id}`, {
        method: 'DELETE'
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete sub-admin')
      }

      setMessage({ type: 'success', text: 'Sub-admin deleted successfully!' })
      fetchSubAdmins()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to delete sub-admin' })
    }
  }

  const openResetPwModal = (targetUser: { id: string; email: string; name: string }, role: string) => {
    setResetPwTarget({ ...targetUser, role })
    setResetPwValue('')
    setResetPwConfirm('')
    setShowResetPwText(false)
    setShowResetPwModal(true)
  }

  const handleResetPassword = async () => {
    if (!resetPwTarget) return
    if (!resetPwValue || resetPwValue.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' })
      return
    }
    if (resetPwValue !== resetPwConfirm) {
      setMessage({ type: 'error', text: 'Passwords do not match' })
      return
    }
    setResetPwLoading(true)
    setMessage(null)
    try {
      const response = await apiFetch('/api/admin/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          user_id: resetPwTarget.id,
          user_role: resetPwTarget.role,
          new_password: resetPwValue,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to reset password')
      setMessage({ type: 'success', text: `Password reset successfully for ${resetPwTarget.email}` })
      setShowResetPwModal(false)
      setResetPwTarget(null)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to reset password' })
    } finally {
      setResetPwLoading(false)
    }
  }

  const handleCreateFinanceUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    if (!financeForm.name.trim() || !financeForm.email.trim() || !financeForm.password) {
      setMessage({ type: 'error', text: 'Name, email, and password are required' })
      return
    }
    if (financeForm.password.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' })
      return
    }
    setCreatingFinance(true)
    try {
      const response = await apiFetch('/api/admin/finance-users', {
        method: 'POST',
        body: JSON.stringify({
          name: financeForm.name.trim(),
          email: financeForm.email.trim().toLowerCase(),
          phone: financeForm.phone.trim() || undefined,
          password: financeForm.password,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create finance user')
      }
      setMessage({ type: 'success', text: 'Finance executive created. They can sign in at /finance-same/login' })
      setShowFinanceModal(false)
      setShowFinancePassword(false)
      setFinanceForm({ name: '', email: '', phone: '', password: '' })
      fetchFinanceUsers()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to create finance user' })
    } finally {
      setCreatingFinance(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)

    // Validation
    if (!formData.currentPassword || !formData.newPassword || !formData.confirmPassword) {
      setMessage({ type: 'error', text: 'All fields are required' })
      return
    }

    if (formData.newPassword.length < 8) {
      setMessage({ type: 'error', text: 'New password must be at least 8 characters long' })
      return
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' })
      return
    }

    if (formData.currentPassword === formData.newPassword) {
      setMessage({ type: 'error', text: 'New password must be different from current password' })
      return
    }

    if (isCaptchaEnabled() && !pwCaptchaToken && !pwCaptchaError) {
      setMessage({ type: 'error', text: 'Please complete the CAPTCHA verification.' })
      return
    }

    setLoading(true)

    try {
      // CAPTCHA token is single-use; clear + reset for any subsequent attempt.
      setPwCaptchaToken('')
      pwTurnstileRef.current?.reset()

      // Use server-side API route to change password (handles Supabase secure password change)
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: formData.currentPassword,
          newPassword: formData.newPassword,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to change password')
      }

      setMessage({ type: 'success', text: 'Password changed successfully!' })
      setFormData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })
    } catch (error: any) {
      console.error('Error changing password:', error)
      setMessage({ type: 'error', text: error.message || 'Failed to change password' })
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-x-hidden">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <div className="flex-1 lg:ml-56 min-w-0 overflow-x-hidden pt-16">
        <div className="p-3 sm:p-4 lg:p-5 max-w-4xl mx-auto">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <button
              onClick={() => router.push('/admin')}
              className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Back to Dashboard</span>
            </button>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
              Settings
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">Manage your account settings and preferences</p>
          </motion.div>

          {/* Tabs */}
          <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-1">
            <div className="flex space-x-1">
              {[
                { id: 'profile' as const, label: 'Profile', icon: User },
                { id: 'password' as const, label: 'Password', icon: Lock },
                { id: 'security' as const, label: 'Security', icon: Shield },
                { id: 'companies' as const, label: 'Companies', icon: Building2 },
                ...(adminInfo?.admin_type === 'super_admin' ? [{ id: 'sub-admins' as const, label: 'Sub-Admins', icon: Users }] : []),
                ...(canManageFinanceUsers ? [{ id: 'finance-team' as const, label: 'Finance team', icon: IndianRupee }] : []),
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            {/* Profile Information Card */}
            {activeTab === 'profile' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                  <User className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Profile Information</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Your account details</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    <Mail className="w-4 h-4 inline mr-2" />
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    <User className="w-4 h-4 inline mr-2" />
                    Name
                  </label>
                  <input
                    type="text"
                    value={adminInfo?.name || user?.name || 'N/A'}
                    disabled
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    <Shield className="w-4 h-4 inline mr-2" />
                    Role
                  </label>
                  <input
                    type="text"
                    value="Administrator"
                    disabled
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400 cursor-not-allowed"
                  />
                </div>
              </div>
            </motion.div>
            )}

            {/* Change Password Card */}
            {activeTab === 'password' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                  <Lock className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Change Password</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Update your account password</p>
                </div>
              </div>

              <form onSubmit={handleChangePassword} className="space-y-4">
                {/* Current Password */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Current Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={formData.currentPassword}
                      onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                      required
                      className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      placeholder="Enter current password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* New Password */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    New Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={formData.newPassword}
                      onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                      required
                      minLength={8}
                      className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      placeholder="Enter new password (min. 8 characters)"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Password must be at least 8 characters long
                  </p>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Confirm New Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      required
                      minLength={8}
                      className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      placeholder="Confirm new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Message */}
                {message && (
                  <div
                    className={`p-4 rounded-lg flex items-center gap-3 ${
                      message.type === 'success'
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-400'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-400'
                    }`}
                  >
                    {message.type === 'success' ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      <AlertCircle className="w-5 h-5" />
                    )}
                    <span className="text-sm font-medium">{message.text}</span>
                  </div>
                )}

                {isCaptchaEnabled() && (
                  <div className="flex justify-end pt-2">
                    <TurnstileWidget
                      ref={pwTurnstileRef}
                      onVerify={(t) => { setPwCaptchaToken(t); setPwCaptchaError(false) }}
                      onExpire={() => setPwCaptchaToken('')}
                      onError={() => setPwCaptchaError(true)}
                    />
                  </div>
                )}

                {/* Submit Button */}
                <div className="flex justify-end pt-4">
                  <button
                    type="submit"
                    disabled={loading || (isCaptchaEnabled() && !pwCaptchaToken && !pwCaptchaError)}
                    className="btn-primary flex items-center gap-2 px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                        <span>Changing Password...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>Change Password</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
            )}

            {/* Sub-Admins Management Card */}
            {activeTab === 'sub-admins' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                    <Users className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Sub-Admins Management</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Create and manage sub-admins with department-based permissions</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setEditingSubAdmin(null)
                    setSubAdminFormData({
                      email: '',
                      name: '',
                      password: '',
                      departments: ['wallet'],
                      is_active: true
                    })
                    setShowSubAdminModal(true)
                  }}
                  className="btn-primary flex items-center gap-2 px-4 py-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Sub-Admin</span>
                </button>
              </div>

              {loadingSubAdmins ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600 mx-auto mb-2"></div>
                  <p className="text-gray-600 dark:text-gray-400">Loading sub-admins...</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Name</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Email</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Department</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Status</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Type</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subAdmins.map((admin) => (
                        <tr key={admin.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="py-3 px-4 text-sm text-gray-900 dark:text-white">{admin.name}</td>
                          <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">{admin.email}</td>
                          <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">
                            {admin.departments && admin.departments.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {admin.departments.map((dept: string) => (
                                  <span key={dept} className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 rounded capitalize">
                                    {dept}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="capitalize">{admin.department || 'N/A'}</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              admin.is_active 
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                            }`}>
                              {admin.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              admin.admin_type === 'super_admin'
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                                : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                            }`}>
                              {admin.admin_type === 'super_admin' ? 'Super Admin' : 'Sub-Admin'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            {admin.admin_type !== 'super_admin' && (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => openResetPwModal({ id: admin.id, email: admin.email, name: admin.name }, 'admin')}
                                  className="p-2 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded transition-colors"
                                  title="Reset Password"
                                >
                                  <Key className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingSubAdmin(admin)
                                    setSubAdminFormData({
                                      email: admin.email,
                                      name: admin.name,
                                      password: '',
                                      departments: admin.departments && admin.departments.length > 0 
                                        ? admin.departments 
                                        : (admin.department ? [admin.department] : ['wallet']),
                                      is_active: admin.is_active ?? true
                                    })
                                    setShowSubAdminModal(true)
                                  }}
                                  className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                                  title="Edit"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteSubAdmin(admin.id)}
                                  className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {subAdmins.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-gray-500 dark:text-gray-400">
                            No sub-admins found. Click "Add Sub-Admin" to create one.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
            )}

            {/* Security (2FA) Card */}
            {activeTab === 'security' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6"
            >
              <TwoFactorSetup />
            </motion.div>
            )}

            {/* POS Companies (archive / show) Card */}
            {activeTab === 'companies' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                  <Building2 className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">POS Companies</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Archive companies that are not in use to hide them from POS Transactions. Data is never deleted — activate any time to see it again.
                  </p>
                </div>
              </div>

              {message && (
                <div
                  className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
                    message.type === 'success'
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-400'
                      : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-400'
                  }`}
                >
                  {message.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                  <span className="font-medium">{message.text}</span>
                </div>
              )}

              {loadingCompanies ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600 mx-auto mb-2"></div>
                  <p className="text-gray-600 dark:text-gray-400">Loading companies...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {posCompanies.map((company) => (
                    <div
                      key={company.slug}
                      className={`flex items-center justify-between gap-4 p-4 rounded-lg border transition-colors ${
                        company.archived
                          ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40'
                          : 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 dark:text-white truncate">{company.shortName}</span>
                          <span
                            className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                              company.archived
                                ? 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                                : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            }`}
                          >
                            {company.archived ? 'Archived' : 'Active'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{company.name}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleCompanyArchived(company.slug, !company.archived)}
                        disabled={savingCompanySlug === company.slug}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          company.archived
                            ? 'bg-primary-600 text-white hover:bg-primary-700'
                            : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        {company.archived ? (
                          <>
                            <ArchiveRestore className="w-4 h-4" />
                            {savingCompanySlug === company.slug ? 'Saving...' : 'Activate'}
                          </>
                        ) : (
                          <>
                            <Archive className="w-4 h-4" />
                            {savingCompanySlug === company.slug ? 'Saving...' : 'Archive'}
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                  {posCompanies.length === 0 && (
                    <p className="py-8 text-center text-gray-500 dark:text-gray-400">No companies found.</p>
                  )}
                </div>
              )}
            </motion.div>
            )}

            {activeTab === 'finance-team' && canManageFinanceUsers && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                    <IndianRupee className="w-6 h-6 text-emerald-700 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Finance executives</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Create logins for the finance portal at <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 rounded">/finance-same/login</code>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFinanceForm({ name: '', email: '', phone: '', password: '' })
                    setShowFinancePassword(false)
                    setShowFinanceModal(true)
                  }}
                  className="btn-primary flex items-center gap-2 px-4 py-2"
                >
                  <Plus className="w-4 h-4" />
                  Add finance user
                </button>
              </div>

              {loadingFinanceUsers ? (
                <div className="text-center py-8 text-gray-500">Loading…</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Name</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Email</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Mobile</th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Status</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financeUsers.map((fu) => (
                        <tr key={fu.id} className="border-b border-gray-200 dark:border-gray-700">
                          <td className="py-3 px-4 text-sm text-gray-900 dark:text-white">{fu.name}</td>
                          <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">{fu.email}</td>
                          <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">{fu.phone || '—'}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                fu.is_active
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                              }`}
                            >
                              {fu.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => openResetPwModal({ id: fu.id, email: fu.email, name: fu.name }, 'finance_executive')}
                              className="p-2 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded transition-colors"
                              title="Reset Password"
                            >
                              <Key className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {financeUsers.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-gray-500 dark:text-gray-400">
                            No finance users yet. Click &quot;Add finance user&quot; to create one.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
            )}
          </div>

          {showFinanceModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Add finance executive</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowFinanceModal(false)
                      setShowFinancePassword(false)
                    }}
                    className="text-gray-400 hover:text-gray-600 p-1"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleCreateFinanceUser} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
                    <input
                      type="text"
                      required
                      value={financeForm.name}
                      onChange={(e) => setFinanceForm({ ...financeForm, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email *</label>
                    <input
                      type="email"
                      required
                      value={financeForm.email}
                      onChange={(e) => setFinanceForm({ ...financeForm, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mobile</label>
                    <input
                      type="tel"
                      value={financeForm.phone}
                      onChange={(e) => setFinanceForm({ ...financeForm, phone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password *</label>
                    <div className="relative">
                      <input
                        type={showFinancePassword ? 'text' : 'password'}
                        required
                        value={financeForm.password}
                        onChange={(e) => setFinanceForm({ ...financeForm, password: e.target.value })}
                        className="w-full pl-3 pr-11 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        minLength={8}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowFinancePassword(!showFinancePassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-md"
                        aria-label={showFinancePassword ? 'Hide password' : 'Show password'}
                      >
                        {showFinancePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowFinanceModal(false)
                        setShowFinancePassword(false)
                      }}
                      className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={creatingFinance} className="btn-primary px-4 py-2">
                      {creatingFinance ? 'Creating…' : 'Create'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {/* Sub-Admin Modal */}
          {showSubAdminModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full my-8 max-h-[90vh] flex flex-col"
              >
                {/* Header - Fixed */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                    {editingSubAdmin ? 'Edit Sub-Admin' : 'Create Sub-Admin'}
                  </h3>
                  <button
                    onClick={() => {
                      setShowSubAdminModal(false)
                      setEditingSubAdmin(null)
                      setSubAdminFormData({
                        email: '',
                        name: '',
                        password: '',
                        departments: ['wallet'],
                        is_active: true
                      })
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Scrollable Content */}
                <div className="overflow-y-auto flex-1 px-6 py-4">
                  <form onSubmit={handleCreateSubAdmin} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Name *
                    </label>
                    <input
                      type="text"
                      value={subAdminFormData.name}
                      onChange={(e) => setSubAdminFormData({ ...subAdminFormData, name: e.target.value })}
                      required
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Email *
                    </label>
                    <input
                      type="email"
                      value={subAdminFormData.email}
                      onChange={(e) => setSubAdminFormData({ ...subAdminFormData, email: e.target.value })}
                      required
                      disabled={!!editingSubAdmin}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:bg-gray-50 dark:disabled:bg-gray-900 disabled:cursor-not-allowed"
                    />
                  </div>

                  {!editingSubAdmin && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Password *
                      </label>
                      <div className="relative">
                        <input
                          type={showSubAdminPassword ? 'text' : 'password'}
                          value={subAdminFormData.password}
                          onChange={(e) => setSubAdminFormData({ ...subAdminFormData, password: e.target.value })}
                          required
                          minLength={8}
                          className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                          placeholder="Min. 8 characters"
                        />
                        <button type="button" onClick={() => setShowSubAdminPassword(!showSubAdminPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                          {showSubAdminPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Departments * (Select multiple)
                    </label>
                    <div className="border border-gray-300 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-900 max-h-48 overflow-y-auto">
                      <div className="grid grid-cols-2 gap-2">
                        {availableDepartments.map((dept) => (
                          <label
                            key={dept.id}
                            className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={dept.id === 'all'
                                ? subAdminFormData.departments.length === availableDepartments.length - 1
                                : subAdminFormData.departments.includes(dept.id)}
                              onChange={(e) => {
                                if (dept.id === 'all') {
                                  setSubAdminFormData({
                                    ...subAdminFormData,
                                    departments: e.target.checked
                                      ? availableDepartments.filter(d => d.id !== 'all').map(d => d.id)
                                      : []
                                  })
                                } else {
                                  let newDepartments: string[]
                                  if (e.target.checked) {
                                    newDepartments = [...subAdminFormData.departments, dept.id]
                                  } else {
                                    newDepartments = subAdminFormData.departments.filter(d => d !== dept.id)
                                  }
                                  setSubAdminFormData({
                                    ...subAdminFormData,
                                    departments: newDepartments
                                  })
                                }
                              }}
                              className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500 flex-shrink-0"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{dept.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                      <span className="font-medium">Selected:</span> {subAdminFormData.departments.length === 0 
                        ? <span className="text-gray-400">None</span>
                        : subAdminFormData.departments.length === availableDepartments.length - 1
                          ? <span className="text-primary-600 dark:text-primary-400">All</span>
                          : <span className="text-primary-600 dark:text-primary-400">{subAdminFormData.departments.join(', ')}</span>}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={subAdminFormData.is_active}
                      onChange={(e) => setSubAdminFormData({ ...subAdminFormData, is_active: e.target.checked })}
                      className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                    />
                    <label htmlFor="is_active" className="text-sm text-gray-700 dark:text-gray-300">
                      Active
                    </label>
                  </div>

                    {message && (
                      <div
                        className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                          message.type === 'success'
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-400'
                            : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-400'
                        }`}
                      >
                        {message.type === 'success' ? (
                          <CheckCircle className="w-4 h-4 flex-shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        )}
                        <span className="font-medium">{message.text}</span>
                      </div>
                    )}
                  </form>
                </div>

                {/* Footer - Fixed */}
                <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSubAdminModal(false)
                      setEditingSubAdmin(null)
                      setSubAdminFormData({
                        email: '',
                        name: '',
                        password: '',
                        departments: ['wallet'],
                        is_active: true
                      })
                    }}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateSubAdmin}
                    disabled={loading}
                    className="btn-primary px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Saving...' : editingSubAdmin ? 'Update' : 'Create'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {/* Reset Password Modal */}
          {showResetPwModal && resetPwTarget && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Reset Password</h3>
                  <button
                    type="button"
                    onClick={() => { setShowResetPwModal(false); setResetPwTarget(null) }}
                    className="text-gray-400 hover:text-gray-600 p-1"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="mb-4 space-y-1">
                  <p className="text-sm text-gray-600 dark:text-gray-400">User: <span className="font-medium text-gray-900 dark:text-white">{resetPwTarget.name}</span></p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Email: <span className="font-medium text-gray-900 dark:text-white">{resetPwTarget.email}</span></p>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Password *</label>
                    <div className="relative">
                      <input
                        type={showResetPwText ? 'text' : 'password'}
                        value={resetPwValue}
                        onChange={(e) => setResetPwValue(e.target.value)}
                        className="w-full pl-3 pr-11 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        minLength={8}
                        placeholder="Min. 8 characters"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetPwText(!showResetPwText)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-md"
                      >
                        {showResetPwText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm Password *</label>
                    <input
                      type={showResetPwText ? 'text' : 'password'}
                      value={resetPwConfirm}
                      onChange={(e) => setResetPwConfirm(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      minLength={8}
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                    />
                  </div>
                  {message && (
                    <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                      message.type === 'success'
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-400'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-400'
                    }`}>
                      {message.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                      <span className="font-medium">{message.text}</span>
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => { setShowResetPwModal(false); setResetPwTarget(null) }}
                    className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    disabled={resetPwLoading}
                    className="px-4 py-2 rounded-lg text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resetPwLoading ? 'Resetting...' : 'Reset Password'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

