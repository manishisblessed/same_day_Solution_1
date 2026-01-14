'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import AdminSidebar from '@/components/AdminSidebar'
import { 
  Lock, Eye, EyeOff, CheckCircle, AlertCircle, 
  User, Mail, Shield, Save, ArrowLeft, Users, Plus, Edit, Trash2, X
} from 'lucide-react'
import { motion } from 'framer-motion'

export default function AdminSettings() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'profile' | 'password' | 'sub-admins'>('profile')
  
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
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

  const availableDepartments = [
    { id: 'wallet', label: 'Wallet' },
    { id: 'commission', label: 'Commission' },
    { id: 'mdr', label: 'MDR' },
    { id: 'limits', label: 'Limits' },
    { id: 'services', label: 'Services' },
    { id: 'reversals', label: 'Reversals' },
    { id: 'disputes', label: 'Disputes' },
    { id: 'reports', label: 'Reports' },
    { id: 'users', label: 'Users' },
    { id: 'settings', label: 'Settings' },
    { id: 'all', label: 'All Departments' }
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

  const fetchSubAdmins = async () => {
    setLoadingSubAdmins(true)
    try {
      const response = await fetch('/api/admin/sub-admins')
      const data = await response.json()
      if (data.success) {
        setSubAdmins(data.admins || [])
      }
    } catch (error) {
      console.error('Error fetching sub-admins:', error)
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
      const url = editingSubAdmin 
        ? '/api/admin/sub-admins'
        : '/api/admin/sub-admins'
      const method = editingSubAdmin ? 'PUT' : 'POST'

      const body = editingSubAdmin
        ? { id: editingSubAdmin.id, ...subAdminFormData, password: undefined }
        : subAdminFormData

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
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
      const response = await fetch(`/api/admin/sub-admins?id=${id}`, {
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

    setLoading(true)

    try {
      // First, verify current password by attempting to sign in
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email || '',
        password: formData.currentPassword,
      })

      if (signInError) {
        setMessage({ type: 'error', text: 'Current password is incorrect' })
        setLoading(false)
        return
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: formData.newPassword,
      })

      if (updateError) {
        throw updateError
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
                ...(adminInfo?.admin_type === 'super_admin' ? [{ id: 'sub-admins' as const, label: 'Sub-Admins', icon: Users }] : [])
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

                {/* Submit Button */}
                <div className="flex justify-end pt-4">
                  <button
                    type="submit"
                    disabled={loading}
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
          </div>

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
                      <input
                        type="password"
                        value={subAdminFormData.password}
                        onChange={(e) => setSubAdminFormData({ ...subAdminFormData, password: e.target.value })}
                        required
                        minLength={8}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        placeholder="Min. 8 characters"
                      />
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
                              checked={subAdminFormData.departments.includes(dept.id)}
                              onChange={(e) => {
                                if (dept.id === 'all') {
                                  // If "All" is selected, only keep "all"
                                  setSubAdminFormData({
                                    ...subAdminFormData,
                                    departments: e.target.checked ? ['all'] : []
                                  })
                                } else {
                                  // If "All" was selected, remove it when selecting specific departments
                                  let newDepartments = subAdminFormData.departments.filter(d => d !== 'all')
                                  if (e.target.checked) {
                                    newDepartments.push(dept.id)
                                  } else {
                                    newDepartments = newDepartments.filter(d => d !== dept.id)
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
        </div>
      </div>
    </div>
  )
}

