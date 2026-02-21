'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import AdminSidebar from '@/components/AdminSidebar'
import {
  Plus, Edit, Trash2, Search, X, Check, AlertCircle,
  Menu, Percent, CreditCard, Smartphone, Globe,
  TrendingUp, Settings, RefreshCw
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'

type PaymentMode = 'CARD' | 'UPI'
type CardType = 'CREDIT' | 'DEBIT' | 'PREPAID' | null
type SchemeStatus = 'active' | 'inactive'

interface GlobalScheme {
  id: string
  mode: PaymentMode
  card_type: CardType
  brand_type: string | null
  card_classification: string | null
  rt_mdr_t1: number
  rt_mdr_t0: number
  dt_mdr_t1: number
  dt_mdr_t0: number
  status: SchemeStatus
  effective_date: string
  created_at: string
  updated_at: string
}

export default function AdminMDRSchemes() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [schemes, setSchemes] = useState<GlobalScheme[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editingScheme, setEditingScheme] = useState<GlobalScheme | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<SchemeStatus | 'all'>('all')

  const [formData, setFormData] = useState({
    mode: 'CARD' as PaymentMode,
    card_type: null as CardType,
    brand_type: '',
    card_classification: '',
    rt_mdr_t1: '',
    dt_mdr_t1: '',
    status: 'active' as SchemeStatus,
  })

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchSchemes()
    }
  }, [user])

  const fetchSchemes = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('global_schemes')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setSchemes(data || [])
    } catch (error) {
      console.error('Error fetching schemes:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const rt_mdr_t1 = parseFloat(formData.rt_mdr_t1)
      const dt_mdr_t1 = parseFloat(formData.dt_mdr_t1)

      // Auto-calculate T+0 MDR = T+1 + 1%
      const rt_mdr_t0 = rt_mdr_t1 + 1
      const dt_mdr_t0 = dt_mdr_t1 + 1

      // Validate
      if (rt_mdr_t1 < 0 || rt_mdr_t1 > 100) {
        alert('Retailer MDR T+1 must be between 0 and 100')
        return
      }
      if (dt_mdr_t1 < 0 || dt_mdr_t1 > 100) {
        alert('Distributor MDR T+1 must be between 0 and 100')
        return
      }
      if (rt_mdr_t1 < dt_mdr_t1) {
        alert('Retailer MDR T+1 must be >= Distributor MDR T+1')
        return
      }

      const schemeData = {
        mode: formData.mode,
        card_type: formData.card_type || null,
        brand_type: formData.brand_type || null,
        card_classification: formData.card_classification || null,
        rt_mdr_t1,
        rt_mdr_t0,
        dt_mdr_t1,
        dt_mdr_t0,
        status: formData.status,
        effective_date: new Date().toISOString(),
      }

      if (editingScheme) {
        // Update existing scheme
        const { error } = await supabase
          .from('global_schemes')
          .update(schemeData)
          .eq('id', editingScheme.id)

        if (error) throw error
      } else {
        // Create new scheme
        const { error } = await supabase
          .from('global_schemes')
          .insert(schemeData)

        if (error) throw error
      }

      setShowModal(false)
      setEditingScheme(null)
      setFormData({
        mode: 'CARD',
        card_type: null,
        brand_type: '',
        card_classification: '',
        rt_mdr_t1: '',
        dt_mdr_t1: '',
        status: 'active',
      })
      fetchSchemes()
    } catch (error: any) {
      console.error('Error saving scheme:', error)
      alert(error.message || 'Failed to save scheme')
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (scheme: GlobalScheme) => {
    setEditingScheme(scheme)
    setFormData({
      mode: scheme.mode,
      card_type: scheme.card_type,
      brand_type: scheme.brand_type || '',
      card_classification: scheme.card_classification || '',
      rt_mdr_t1: scheme.rt_mdr_t1.toString(),
      dt_mdr_t1: scheme.dt_mdr_t1.toString(),
      status: scheme.status,
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this scheme?')) return

    try {
      const { error } = await supabase
        .from('global_schemes')
        .delete()
        .eq('id', id)

      if (error) throw error
      fetchSchemes()
    } catch (error: any) {
      console.error('Error deleting scheme:', error)
      alert(error.message || 'Failed to delete scheme')
    }
  }

  const filteredSchemes = schemes.filter(scheme => {
    const matchesSearch = 
      scheme.mode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (scheme.brand_type?.toLowerCase().includes(searchQuery.toLowerCase()) || false) ||
      (scheme.card_type?.toLowerCase().includes(searchQuery.toLowerCase()) || false)
    
    const matchesStatus = filterStatus === 'all' || scheme.status === filterStatus
    
    return matchesSearch && matchesStatus
  })

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-56">
        {/* Header */}
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-30">
          <div className="flex items-center justify-between px-4 py-4">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">MDR Schemes</h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">Manage global MDR schemes</p>
              </div>
            </div>
            <button
              onClick={() => {
                setEditingScheme(null)
                setFormData({
                  mode: 'CARD',
                  card_type: null,
                  brand_type: '',
                  card_classification: '',
                  rt_mdr_t1: '',
                  dt_mdr_t1: '',
                  status: 'active',
                })
                setShowModal(true)
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-secondary-500 text-white rounded-lg hover:shadow-lg transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Create Scheme</span>
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-6">
          {/* Filters */}
          <div className="mb-6 flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search by mode, card type, or brand..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as SchemeStatus | 'all')}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button
              onClick={fetchSchemes}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>

          {/* Schemes Table */}
          {loading ? (
            <div className="text-center py-12">Loading...</div>
          ) : filteredSchemes.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No schemes found</div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Mode</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Card Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Brand</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Classification</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">RT MDR T+1</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">RT MDR T+0</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">DT MDR T+1</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">DT MDR T+0</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredSchemes.map((scheme) => (
                      <tr key={scheme.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            {scheme.mode === 'CARD' ? (
                              <CreditCard className="w-4 h-4 text-blue-500" />
                            ) : (
                              <Smartphone className="w-4 h-4 text-green-500" />
                            )}
                            <span className="text-sm font-medium">{scheme.mode}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{scheme.card_type || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{scheme.brand_type || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{scheme.card_classification || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{scheme.rt_mdr_t1}%</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">{scheme.rt_mdr_t0}%</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{scheme.dt_mdr_t1}%</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">{scheme.dt_mdr_t0}%</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            scheme.status === 'active'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                          }`}>
                            {scheme.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => handleEdit(scheme)}
                              className="p-1 text-blue-600 hover:text-blue-800"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(scheme.id)}
                              className="p-1 text-red-600 hover:text-red-800"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {editingScheme ? 'Edit Scheme' : 'Create Global Scheme'}
                  </h2>
                  <button
                    onClick={() => setShowModal(false)}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Payment Mode *</label>
                      <select
                        value={formData.mode}
                        onChange={(e) => setFormData({ ...formData, mode: e.target.value as PaymentMode })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        required
                      >
                        <option value="CARD">CARD</option>
                        <option value="UPI">UPI</option>
                      </select>
                    </div>

                    {formData.mode === 'CARD' && (
                      <div>
                        <label className="block text-sm font-medium mb-1">Card Type</label>
                        <select
                          value={formData.card_type || ''}
                          onChange={(e) => setFormData({ ...formData, card_type: e.target.value as CardType || null })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                          <option value="">All Card Types</option>
                          <option value="CREDIT">CREDIT</option>
                          <option value="DEBIT">DEBIT</option>
                          <option value="PREPAID">PREPAID</option>
                        </select>
                      </div>
                    )}

                    {formData.mode === 'CARD' && (
                      <div>
                        <label className="block text-sm font-medium mb-1">Brand Type (Optional)</label>
                        <input
                          type="text"
                          value={formData.brand_type}
                          onChange={(e) => setFormData({ ...formData, brand_type: e.target.value })}
                          placeholder="VISA, MasterCard, etc."
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      </div>
                    )}

                    {formData.mode === 'CARD' && (
                      <div>
                        <label className="block text-sm font-medium mb-1">Card Classification</label>
                        <select
                          value={formData.card_classification}
                          onChange={(e) => setFormData({ ...formData, card_classification: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                          <option value="">All Classifications</option>
                          <option value="CLASSIC">CLASSIC</option>
                          <option value="GOLD">GOLD</option>
                          <option value="PLATINUM">PLATINUM</option>
                          <option value="TITANIUM">TITANIUM</option>
                          <option value="SIGNATURE">SIGNATURE</option>
                          <option value="INFINITE">INFINITE</option>
                          <option value="WORLD">WORLD</option>
                          <option value="BUSINESS">BUSINESS</option>
                          <option value="CORPORATE">CORPORATE</option>
                          <option value="PREMIUM">PREMIUM</option>
                          <option value="STANDARD">STANDARD</option>
                          <option value="OTHER">OTHER</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="border-t pt-4">
                    <h3 className="text-lg font-semibold mb-4">MDR Rates (T+1)</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-1">Retailer MDR T+1 (%) *</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={formData.rt_mdr_t1}
                          onChange={(e) => setFormData({ ...formData, rt_mdr_t1: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          required
                        />
                        <p className="text-xs text-gray-500 mt-1">T+0 will auto-calculate as T+1 + 1%</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Distributor MDR T+1 (%) *</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={formData.dt_mdr_t1}
                          onChange={(e) => setFormData({ ...formData, dt_mdr_t1: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          required
                        />
                        <p className="text-xs text-gray-500 mt-1">T+0 will auto-calculate as T+1 + 1%</p>
                      </div>
                    </div>
                    {formData.rt_mdr_t1 && formData.dt_mdr_t1 && (
                      <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-200">Auto-calculated T+0 Rates:</p>
                        <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600 dark:text-gray-400">RT MDR T+0: </span>
                            <span className="font-semibold text-green-600">{(parseFloat(formData.rt_mdr_t1) + 1).toFixed(2)}%</span>
                          </div>
                          <div>
                            <span className="text-gray-600 dark:text-gray-400">DT MDR T+0: </span>
                            <span className="font-semibold text-green-600">{(parseFloat(formData.dt_mdr_t1) + 1).toFixed(2)}%</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as SchemeStatus })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>

                  <div className="flex justify-end space-x-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-2 bg-gradient-to-r from-primary-500 to-secondary-500 text-white rounded-lg hover:shadow-lg disabled:opacity-50"
                    >
                      {loading ? 'Saving...' : editingScheme ? 'Update' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

