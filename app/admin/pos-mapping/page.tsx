'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import { supabase } from '@/lib/supabase/client'
import { 
  Settings, 
  ChevronLeft, 
  ChevronRight, 
  RefreshCw,
  Plus,
  Edit,
  X,
  CheckCircle2,
  XCircle,
  Loader2,
  Search
} from 'lucide-react'
import { motion } from 'framer-motion'
import { POSDeviceMapping } from '@/types/database.types'

interface Retailer {
  partner_id: string
  name: string
}

interface Distributor {
  partner_id: string
  name: string
}

interface MasterDistributor {
  partner_id: string
  name: string
}

export default function POSMappingPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mappings, setMappings] = useState<POSDeviceMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [editingMapping, setEditingMapping] = useState<POSDeviceMapping | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'INACTIVE' | 'ALL'>('ALL')
  const limit = 20

  // Fetch retailers, distributors, master distributors for dropdowns
  const [retailers, setRetailers] = useState<Retailer[]>([])
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [masterDistributors, setMasterDistributors] = useState<MasterDistributor[]>([])

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  // Fetch partners for dropdowns
  useEffect(() => {
    if (user && user.role === 'admin') {
      fetchPartners()
    }
  }, [user])

  const fetchPartners = async () => {
    try {
      // Fetch retailers, distributors, and master distributors
      const [{ data: retailersData }, { data: distributorsData }, { data: masterDistributorsData }] = await Promise.all([
        supabase.from('retailers').select('partner_id, name').order('name'),
        supabase.from('distributors').select('partner_id, name').order('name'),
        supabase.from('master_distributors').select('partner_id, name').order('name')
      ])
      
      if (retailersData) setRetailers(retailersData)
      if (distributorsData) setDistributors(distributorsData)
      if (masterDistributorsData) setMasterDistributors(masterDistributorsData)
    } catch (err) {
      console.error('Error fetching partners:', err)
    }
  }

  // Fetch mappings
  const fetchMappings = async () => {
    if (!user || user.role !== 'admin') return

    setLoading(true)
    setError(null)

    try {
      let url = `/api/admin/pos-mapping?page=${page}&limit=${limit}`
      if (statusFilter !== 'ALL') {
        url += `&status=${statusFilter}`
      }
      if (searchTerm) {
        url += `&deviceSerial=${encodeURIComponent(searchTerm)}`
      }

      const response = await fetch(url)
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch POS mappings')
      }

      setMappings(result.data || [])
      setTotalPages(result.pagination?.totalPages || 1)
      setTotal(result.pagination?.total || 0)
    } catch (err: any) {
      console.error('Error fetching POS mappings:', err)
      setError(err.message || 'Failed to load POS mappings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMappings()
  }, [page, statusFilter, user])

  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (page === 1) {
        fetchMappings()
      } else {
        setPage(1)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [searchTerm])

  const handleAdd = () => {
    setEditingMapping(null)
    setShowModal(true)
  }

  const handleEdit = (mapping: POSDeviceMapping) => {
    setEditingMapping(mapping)
    setShowModal(true)
  }

  const handleModalClose = () => {
    setShowModal(false)
    setEditingMapping(null)
  }

  const handleModalSuccess = () => {
    setShowModal(false)
    setEditingMapping(null)
    fetchMappings()
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="lg:pl-56 flex items-center justify-center min-h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <div className="lg:pl-56">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <Settings className="w-8 h-8 text-primary-600" />
                POS Device Mapping
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                Map POS devices to retailers, distributors, and master distributors for role-based transaction visibility
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchMappings}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={handleAdd}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Mapping
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Search Device Serial
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Enter device serial..."
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Status Filter
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as 'ACTIVE' | 'INACTIVE' | 'ALL')
                    setPage(1)
                  }}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                >
                  <option value="ALL">All Status</option>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Mappings</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{total}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">Current Page</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {page} / {totalPages}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">Active Mappings</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {mappings.filter(m => m.status === 'ACTIVE').length}
              </p>
            </div>
          </div>

          {/* Mappings Table */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Device Serial
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      TID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Retailer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Distributor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Master Distributor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {mappings.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        {loading ? 'Loading mappings...' : 'No mappings found'}
                      </td>
                    </tr>
                  ) : (
                    mappings.map((mapping) => {
                      const retailer = retailers.find(r => r.partner_id === mapping.retailer_id)
                      const distributor = distributors.find(d => d.partner_id === mapping.distributor_id)
                      const masterDistributor = masterDistributors.find(md => md.partner_id === mapping.master_distributor_id)

                      return (
                        <motion.tr
                          key={mapping.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900 dark:text-gray-100">
                            {mapping.device_serial}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {mapping.tid || 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {retailer ? retailer.name : mapping.retailer_id || 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {distributor ? distributor.name : mapping.distributor_id || 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {masterDistributor ? masterDistributor.name : mapping.master_distributor_id || 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {mapping.status === 'ACTIVE' ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                ACTIVE
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                <XCircle className="w-3 h-3 mr-1" />
                                INACTIVE
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <button
                              onClick={() => handleEdit(mapping)}
                              className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          </td>
                        </motion.tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="bg-gray-50 dark:bg-gray-900 px-6 py-4 flex items-center justify-between border-t border-gray-200 dark:border-gray-700">
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  Showing page {page} of {totalPages} ({total} total mappings)
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                    className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || loading}
                    className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <POSMappingModal
          mapping={editingMapping}
          retailers={retailers}
          distributors={distributors}
          masterDistributors={masterDistributors}
          onClose={handleModalClose}
          onSuccess={handleModalSuccess}
        />
      )}
    </div>
  )
}

// POS Mapping Modal Component
function POSMappingModal({
  mapping,
  retailers,
  distributors,
  masterDistributors,
  onClose,
  onSuccess,
}: {
  mapping: POSDeviceMapping | null
  retailers: Retailer[]
  distributors: Distributor[]
  masterDistributors: MasterDistributor[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [formData, setFormData] = useState({
    deviceSerial: '',
    tid: '',
    retailer_id: '',
    distributor_id: '',
    master_distributor_id: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mapping) {
      setFormData({
        deviceSerial: mapping.device_serial || '',
        tid: mapping.tid || '',
        retailer_id: mapping.retailer_id || '',
        distributor_id: mapping.distributor_id || '',
        master_distributor_id: mapping.master_distributor_id || '',
        status: mapping.status || 'ACTIVE',
      })
    }
  }, [mapping])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const url = mapping
        ? `/api/admin/pos-mapping/${mapping.id}`
        : '/api/admin/pos-mapping'
      
      const method = mapping ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save POS mapping')
      }

      onSuccess()
    } catch (err: any) {
      console.error('Error saving POS mapping:', err)
      setError(err.message || 'Failed to save POS mapping')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {mapping ? 'Edit POS Mapping' : 'Add POS Mapping'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-red-800 dark:text-red-400">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Device Serial *
              </label>
              <input
                type="text"
                required
                value={formData.deviceSerial}
                onChange={(e) => setFormData({ ...formData, deviceSerial: e.target.value })}
                disabled={!!mapping}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-700"
                placeholder="Enter device serial"
              />
              {mapping && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Device serial cannot be changed after creation
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Terminal ID (TID)
              </label>
              <input
                type="text"
                value={formData.tid}
                onChange={(e) => setFormData({ ...formData, tid: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                placeholder="Enter terminal ID (optional)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Retailer
              </label>
              <select
                value={formData.retailer_id}
                onChange={(e) => setFormData({ ...formData, retailer_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="">Select Retailer (Optional)</option>
                {retailers.map((retailer) => (
                  <option key={retailer.partner_id} value={retailer.partner_id}>
                    {retailer.name} ({retailer.partner_id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Distributor
              </label>
              <select
                value={formData.distributor_id}
                onChange={(e) => setFormData({ ...formData, distributor_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="">Select Distributor (Optional)</option>
                {distributors.map((distributor) => (
                  <option key={distributor.partner_id} value={distributor.partner_id}>
                    {distributor.name} ({distributor.partner_id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Master Distributor
              </label>
              <select
                value={formData.master_distributor_id}
                onChange={(e) => setFormData({ ...formData, master_distributor_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="">Select Master Distributor (Optional)</option>
                {masterDistributors.map((md) => (
                  <option key={md.partner_id} value={md.partner_id}>
                    {md.name} ({md.partner_id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Status *
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as 'ACTIVE' | 'INACTIVE' })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              <strong>Note:</strong> At least one of Retailer, Distributor, or Master Distributor must be selected.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || (!formData.retailer_id && !formData.distributor_id && !formData.master_distributor_id)}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : mapping ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

