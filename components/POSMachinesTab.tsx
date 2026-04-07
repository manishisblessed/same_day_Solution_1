'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { 
  CreditCard, Search, RefreshCw, ChevronDown, ChevronUp, 
  ArrowRight, CheckCircle, XCircle, AlertCircle, Package,
  Smartphone, Monitor, Loader2, Filter, Eye, X, Clock,
  ArrowDownRight, ChevronLeft, ChevronRight, UserPlus, RotateCcw, Trash2
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import { POSMachine } from '@/types/database.types'

interface AssignableUser {
  partner_id: string
  name: string
  email: string
  business_name?: string
  status: string
}

interface POSMachinesTabProps {
  user: any
  accentColor?: string // 'yellow' for MD, 'purple' for distributor, 'blue' for retailer
}

export default function POSMachinesTab({ user, accentColor = 'blue' }: POSMachinesTabProps) {
  const [machines, setMachines] = useState<POSMachine[]>([])
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<10 | 25 | 100>(25)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedMachine, setSelectedMachine] = useState<POSMachine | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailMachine, setDetailMachine] = useState<POSMachine | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Bulk operation states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false)
  const [showBulkRecallModal, setShowBulkRecallModal] = useState(false)
  const [bulkModalPickedIds, setBulkModalPickedIds] = useState<Set<string>>(new Set())
  const [bulkModalSearch, setBulkModalSearch] = useState('')
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [bulkRecalling, setBulkRecalling] = useState(false)
  const [bulkAssignTarget, setBulkAssignTarget] = useState('')
  const [bulkAssignUserSearch, setBulkAssignUserSearch] = useState('')
  const [bulkNotes, setBulkNotes] = useState('')
  const [bulkSubscriptionAmount, setBulkSubscriptionAmount] = useState('')
  const [bulkBillingDay, setBulkBillingDay] = useState(1)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [bulkSummary, setBulkSummary] = useState<string | null>(null)

  const colorClasses = useMemo(() => {
    switch (accentColor) {
      case 'yellow':
        return {
          gradient: 'from-yellow-500 to-yellow-600',
          bg: 'bg-yellow-500',
          bgLight: 'bg-yellow-50 dark:bg-yellow-900/20',
          text: 'text-yellow-600 dark:text-yellow-400',
          border: 'border-yellow-200 dark:border-yellow-800',
          hover: 'hover:bg-yellow-50 dark:hover:bg-yellow-900/20',
          ring: 'focus:ring-yellow-500',
          btn: 'bg-yellow-600 hover:bg-yellow-700',
          badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
        }
      case 'purple':
        return {
          gradient: 'from-purple-500 to-purple-600',
          bg: 'bg-purple-500',
          bgLight: 'bg-purple-50 dark:bg-purple-900/20',
          text: 'text-purple-600 dark:text-purple-400',
          border: 'border-purple-200 dark:border-purple-800',
          hover: 'hover:bg-purple-50 dark:hover:bg-purple-900/20',
          ring: 'focus:ring-purple-500',
          btn: 'bg-purple-600 hover:bg-purple-700',
          badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
        }
      default:
        return {
          gradient: 'from-blue-500 to-blue-600',
          bg: 'bg-blue-500',
          bgLight: 'bg-blue-50 dark:bg-blue-900/20',
          text: 'text-blue-600 dark:text-blue-400',
          border: 'border-blue-200 dark:border-blue-800',
          hover: 'hover:bg-blue-50 dark:hover:bg-blue-900/20',
          ring: 'focus:ring-blue-500',
          btn: 'bg-blue-600 hover:bg-blue-700',
          badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        }
    }
  }, [accentColor])

  const fetchMachines = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let url = `/api/pos-machines/my-machines?page=${page}&limit=${pageSize}`
      if (searchTerm) url += `&search=${encodeURIComponent(searchTerm)}`

      const response = await apiFetch(url)
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch POS machines')
      }

      setMachines(result.data || [])
      setAssignableUsers(result.assignableUsers || [])
      setTotalPages(result.pagination?.totalPages || 1)
      setTotal(result.pagination?.total || 0)
    } catch (err: any) {
      console.error('Error fetching POS machines:', err)
      setError(err.message || 'Failed to load POS machines')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, searchTerm])

  useEffect(() => {
    fetchMachines()
  }, [fetchMachines])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (page !== 1) setPage(1)
      else fetchMachines()
    }, 500)
    return () => clearTimeout(timer)
  }, [searchTerm])

  const canAssign = user?.role === 'master_distributor' || user?.role === 'distributor' || user?.role === 'admin'
  const canBulkAssign = user?.role === 'master_distributor' || user?.role === 'distributor'
  const canRecall = user?.role === 'master_distributor' || user?.role === 'distributor'

  const canRecallMachine = (machine: POSMachine) => {
    if (user?.role === 'master_distributor') {
      return machine.master_distributor_id === user.partner_id &&
        ['assigned_to_distributor', 'assigned_to_retailer'].includes(machine.inventory_status || '')
    }
    if (user?.role === 'distributor') {
      return machine.distributor_id === user.partner_id &&
        machine.inventory_status === 'assigned_to_retailer'
    }
    return false
  }

  const getAssignableInventoryStatus = () => {
    switch (user?.role) {
      case 'admin': return ['in_stock', 'received_from_bank'] // Admin can assign from stock
      case 'master_distributor': return ['assigned_to_master_distributor']
      case 'distributor': return ['assigned_to_distributor']
      default: return null
    }
  }

  const getTargetRoleLabel = () => {
    switch (user?.role) {
      case 'admin': return 'Master Distributor or Partner'
      case 'master_distributor': return 'Distributor'
      case 'distributor': return 'Retailer'
      default: return ''
    }
  }

  const canAssignMachine = (machine: POSMachine) => {
    // Returned machines are eligible for reassignment by admin
    if (user?.role === 'admin' && machine.status === 'returned') return true
    const targetStatuses = getAssignableInventoryStatus()
    if (!targetStatuses) return false
    if (Array.isArray(targetStatuses)) {
      return targetStatuses.includes(machine.inventory_status || '')
    }
    return machine.inventory_status === targetStatuses
  }

  const handleAssign = (machine: POSMachine) => {
    setSelectedMachine(machine)
    setShowAssignModal(true)
  }

  const handleViewDetail = (machine: POSMachine) => {
    setDetailMachine(machine)
    setShowDetailModal(true)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      case 'inactive': return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
      case 'maintenance': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
      case 'damaged': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
      case 'returned': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getInventoryStatusLabel = (status?: string) => {
    switch (status) {
      case 'in_stock': return { label: 'In Stock', color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300' }
      case 'received_from_bank': return { label: 'Received from Bank', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' }
      case 'assigned_to_master_distributor': return { label: 'With Master Distributor', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' }
      case 'assigned_to_distributor': return { label: 'With Distributor', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' }
      case 'assigned_to_retailer': return { label: 'With Retailer', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' }
      case 'assigned_to_partner': return { label: 'With Partner', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' }
      case 'damaged_from_bank': return { label: 'Damaged', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' }
      default: return { label: status || 'Unknown', color: 'bg-gray-100 text-gray-800' }
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'POS': return <CreditCard className="w-4 h-4" />
      case 'WPOS': return <Smartphone className="w-4 h-4" />
      case 'Mini-ATM': return <Monitor className="w-4 h-4" />
      default: return <CreditCard className="w-4 h-4" />
    }
  }

  // Stats
  const stats = useMemo(() => {
    const assignable = machines.filter(m => canAssignMachine(m)).length
    const assigned = machines.filter(m => {
      if (user?.role === 'master_distributor') return m.inventory_status === 'assigned_to_distributor' || m.inventory_status === 'assigned_to_retailer'
      if (user?.role === 'distributor') return m.inventory_status === 'assigned_to_retailer'
      return false
    }).length
    return { total: machines.length, assignable, assigned }
  }, [machines, user?.role])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 sm:space-y-6"
    >
      {/* Success Message */}
      <AnimatePresence>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 flex items-center gap-3"
          >
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
            <p className="text-green-800 dark:text-green-300 text-sm font-medium flex-1">{successMessage}</p>
            <button onClick={() => setSuccessMessage(null)} className="text-green-600 hover:text-green-700">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className={`text-lg sm:text-xl font-bold bg-gradient-to-r ${colorClasses.gradient} bg-clip-text text-transparent flex items-center gap-2`}>
            <CreditCard className={`w-5 h-5 ${colorClasses.text}`} />
            {user?.role === 'retailer' ? 'My POS Machines' : 'POS Machine Inventory'}
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
            {user?.role === 'retailer' 
              ? 'View POS machines assigned to you'
              : user?.role === 'master_distributor'
                ? 'Manage and assign POS machines to your Distributors'
                : user?.role === 'distributor'
                  ? 'Manage and assign POS machines to your Retailers'
                  : 'Manage POS machine assignments'
            }
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canBulkAssign && (
            <button
              onClick={() => {
                setBulkModalPickedIds(new Set(selectedIds))
                setBulkModalSearch('')
                setBulkAssignTarget('')
                setBulkAssignUserSearch('')
                setBulkNotes('')
                setBulkSubscriptionAmount('')
                setBulkBillingDay(1)
                setBulkError(null)
                setBulkSummary(null)
                setShowBulkAssignModal(true)
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-green-500 text-green-600 dark:text-green-400 bg-white dark:bg-gray-800 hover:bg-green-50 dark:hover:bg-green-900/20 text-sm transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Bulk Assign
            </button>
          )}
          {canRecall && (
            <button
              onClick={() => {
                setBulkModalPickedIds(new Set(selectedIds))
                setBulkModalSearch('')
                setBulkError(null)
                setBulkSummary(null)
                setShowBulkRecallModal(true)
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-500 text-amber-600 dark:text-amber-400 bg-white dark:bg-gray-800 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-sm transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Bulk Recall
            </button>
          )}
          <button
            onClick={fetchMachines}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Package className={`w-4 h-4 ${colorClasses.text}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">Total Machines</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{total}</p>
        </div>
        {canAssign && (
          <>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <CreditCard className="w-4 h-4 text-green-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">Ready to Assign</span>
              </div>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.assignable}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <ArrowDownRight className="w-4 h-4 text-purple-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">Already Assigned</span>
              </div>
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.assigned}</p>
            </div>
          </>
        )}
      </div>

      {/* Search */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search machine ID, serial, MID, TID..."
            className={`w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg ${colorClasses.ring} focus:ring-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm`}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-800 dark:text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Machines List */}
      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 flex items-center justify-center">
          <Loader2 className={`w-8 h-8 animate-spin ${colorClasses.text}`} />
        </div>
      ) : machines.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
          <CreditCard className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {user?.role === 'retailer' 
              ? 'No POS machines have been assigned to you yet.'
              : 'No POS machines found in your inventory.'
            }
          </p>
          {user?.role !== 'retailer' && (
            <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
              POS machines will appear here once assigned to you by {user?.role === 'master_distributor' ? 'Admin' : 'your Master Distributor'}.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  {(canBulkAssign || canRecall) && (
                    <th className="px-3 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={machines.length > 0 && selectedIds.size === machines.length}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds(new Set(machines.map(m => m.id)))
                          else setSelectedIds(new Set())
                        }}
                        className={`rounded border-gray-300 ${colorClasses.ring}`}
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Machine</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">MID / TID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Brand</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Location</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {machines.map((machine) => {
                  const isAssignable = canAssign && canAssignMachine(machine)
                  return (
                    <motion.tr
                      key={machine.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${selectedIds.has(machine.id) ? 'bg-blue-50 dark:bg-blue-900/10' : ''}`}
                    >
                      {(canBulkAssign || canRecall) && (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(machine.id)}
                            onChange={(e) => {
                              const next = new Set(selectedIds)
                              if (e.target.checked) next.add(machine.id)
                              else next.delete(machine.id)
                              setSelectedIds(next)
                            }}
                            className={`rounded border-gray-300 ${colorClasses.ring}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-white font-mono">{machine.machine_id}</p>
                          {machine.serial_number && (
                            <p className="text-xs text-gray-500 dark:text-gray-400">S/N: {machine.serial_number}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs">
                          {machine.mid && (
                            <p className="text-gray-700 dark:text-gray-300">
                              <span className="font-medium">MID:</span> {machine.mid}
                            </p>
                          )}
                          {machine.tid && (
                            <p className="text-gray-600 dark:text-gray-400">
                              <span className="font-medium">TID:</span> {machine.tid}
                            </p>
                          )}
                          {!machine.mid && !machine.tid && <span className="text-gray-400">-</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {machine.brand ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                            {machine.brand}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                          {getTypeIcon(machine.machine_type)}
                          {machine.machine_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {[machine.city, machine.state].filter(Boolean).join(', ') || '-'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleViewDetail(machine)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {isAssignable && (
                            <button
                              onClick={() => handleAssign(machine)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${colorClasses.btn} text-white text-xs font-medium transition-colors`}
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                              Assign
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-gray-200 dark:divide-gray-700">
            {machines.map((machine) => {
              const isAssignable = canAssign && canAssignMachine(machine)
              return (
                <div key={machine.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white font-mono">{machine.machine_id}</p>
                      {machine.serial_number && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">S/N: {machine.serial_number}</p>
                      )}
                      <div className="mt-1 space-y-0.5">
                        {machine.mid && (
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            <span className="font-medium">MID:</span> {machine.mid}
                          </p>
                        )}
                        {machine.tid && (
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            <span className="font-medium">TID:</span> {machine.tid}
                          </p>
                        )}
                        {machine.brand && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                            {machine.brand}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                      {getTypeIcon(machine.machine_type)}
                      {machine.machine_type}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {[machine.city, machine.state].filter(Boolean).join(', ') || 'No location'}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleViewDetail(machine)}
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {isAssignable && (
                        <button
                          onClick={() => handleAssign(machine)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${colorClasses.btn} text-white text-xs font-medium`}
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          Assign to {getTargetRoleLabel()}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {total > 0 && (
            <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <span>Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value) as 10 | 25 | 100)
                    setPage(1)
                  }}
                  className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={100}>100</option>
                </select>
                <span>
                  {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                </span>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Selection toolbar */}
          {selectedIds.size > 0 && (canBulkAssign || canRecall) && (
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                {selectedIds.size} selected
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {canBulkAssign && (
                  <button
                    onClick={() => {
                      setBulkModalPickedIds(new Set(selectedIds))
                      setBulkModalSearch('')
                      setBulkAssignTarget('')
                      setBulkAssignUserSearch('')
                      setBulkNotes('')
                      setBulkSubscriptionAmount('')
                      setBulkBillingDay(1)
                      setBulkError(null)
                      setBulkSummary(null)
                      setShowBulkAssignModal(true)
                    }}
                    className={`text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${colorClasses.btn} text-white`}
                  >
                    <UserPlus className="w-4 h-4" />
                    Assign Selected
                  </button>
                )}
                {canRecall && (
                  <button
                    onClick={() => {
                      setBulkModalPickedIds(new Set(selectedIds))
                      setBulkModalSearch('')
                      setBulkError(null)
                      setBulkSummary(null)
                      setShowBulkRecallModal(true)
                    }}
                    className="text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Recall Selected
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Assignment Flow Info */}
      {canAssign && (
        <div className={`${colorClasses.bgLight} border ${colorClasses.border} rounded-xl p-4`}>
          <h3 className={`text-sm font-semibold ${colorClasses.text} mb-2 flex items-center gap-2`}>
            <AlertCircle className="w-4 h-4" />
            How POS Assignment Works
          </h3>
          <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
            {user?.role === 'master_distributor' && (
              <>
                <p>• Admin assigns POS machines to you from their inventory</p>
                <p>• You can then assign these machines to your Distributors</p>
                <p>• Distributors will further assign them to their Retailers</p>
                <p>• Only machines with status <span className="font-semibold text-yellow-600">"With Master Distributor"</span> can be assigned</p>
              </>
            )}
            {user?.role === 'distributor' && (
              <>
                <p>• Your Master Distributor assigns POS machines to you</p>
                <p>• You can then assign these machines to your Retailers</p>
                <p>• Only machines with status <span className="font-semibold text-purple-600">"With Distributor"</span> can be assigned</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bulk Assign Modal */}
      <AnimatePresence>
        {showBulkAssignModal && canBulkAssign && (() => {
          const bq = bulkModalSearch.toLowerCase()
          const searchedMachines = machines.filter((m) => {
            if (!canAssignMachine(m)) return false
            if (!bq) return true
            return m.machine_id.toLowerCase().includes(bq) || (m.tid || '').toLowerCase().includes(bq) || (m.serial_number || '').toLowerCase().includes(bq) || (m.mid || '').toLowerCase().includes(bq)
          })
          const pickedCount = bulkModalPickedIds.size
          const filteredTargets = assignableUsers.filter((u) => {
            const sq = bulkAssignUserSearch.toLowerCase()
            if (!sq) return true
            return u.name.toLowerCase().includes(sq) || u.partner_id.toLowerCase().includes(sq) || u.email.toLowerCase().includes(sq) || (u.business_name || '').toLowerCase().includes(sq)
          })
          return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !bulkAssigning && setShowBulkAssignModal(false)}>
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${colorClasses.bgLight}`}>
                      <UserPlus className={`w-5 h-5 ${colorClasses.text}`} />
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Bulk Assign to {getTargetRoleLabel()}
                    </h2>
                  </div>
                  <button type="button" onClick={() => !bulkAssigning && setShowBulkAssignModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                </div>

                {/* Machine picker */}
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">1. Select machines ({pickedCount} selected)</h3>
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input type="text" placeholder="Search by TID, Machine ID, SN…" value={bulkModalSearch} onChange={(e) => setBulkModalSearch(e.target.value)} className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                          <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                            <th className="px-3 py-2 w-8">
                              <input type="checkbox" checked={searchedMachines.length > 0 && searchedMachines.every((m) => bulkModalPickedIds.has(m.id))} onChange={(e) => { const next = new Set(bulkModalPickedIds); if (e.target.checked) searchedMachines.forEach((m) => next.add(m.id)); else searchedMachines.forEach((m) => next.delete(m.id)); setBulkModalPickedIds(next) }} className={`rounded border-gray-300 ${colorClasses.ring}`} />
                            </th>
                            <th className="px-2 py-2 font-medium">TID</th>
                            <th className="px-2 py-2 font-medium">Machine ID</th>
                            <th className="px-2 py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {searchedMachines.slice(0, 100).map((m) => (
                            <tr key={m.id} className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 ${bulkModalPickedIds.has(m.id) ? `${colorClasses.bgLight}` : ''}`} onClick={() => { const next = new Set(bulkModalPickedIds); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); setBulkModalPickedIds(next) }}>
                              <td className="px-3 py-1.5"><input type="checkbox" checked={bulkModalPickedIds.has(m.id)} onChange={() => {}} className={`rounded border-gray-300 ${colorClasses.ring} pointer-events-none`} /></td>
                              <td className="px-2 py-1.5 font-mono text-gray-900 dark:text-gray-100">{m.tid || '—'}</td>
                              <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300">{m.machine_id}</td>
                              <td className="px-2 py-1.5 text-xs">{(m.inventory_status || '').replace(/_/g, ' ')}</td>
                            </tr>
                          ))}
                          {searchedMachines.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-sm">No assignable machines found</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {pickedCount > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
                      {Array.from(bulkModalPickedIds).map((id) => { const m = machines.find((pm) => pm.id === id); return (
                        <span key={id} className={`inline-flex items-center gap-1 px-2 py-0.5 ${colorClasses.badge} text-xs rounded-full font-mono`}>
                          {m?.tid || m?.machine_id || id.slice(0, 8)}
                          <button type="button" onClick={() => { const n = new Set(bulkModalPickedIds); n.delete(id); setBulkModalPickedIds(n) }} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                        </span>
                      ) })}
                    </div>
                  )}
                </div>

                {/* Target selection */}
                <div className="space-y-3 mb-4">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">2. Assign to {getTargetRoleLabel()}</h3>
                  <input type="text" value={bulkAssignUserSearch} onChange={(e) => setBulkAssignUserSearch(e.target.value)} placeholder="Filter by name, ID, email…" className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                  <select value={bulkAssignTarget} onChange={(e) => setBulkAssignTarget(e.target.value)} disabled={bulkAssigning} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                    <option value="">Select {getTargetRoleLabel()}…</option>
                    {filteredTargets.map((u) => (
                      <option key={u.partner_id} value={u.partner_id}>{(u.name || u.business_name || u.partner_id) + ` — ${u.partner_id}`}</option>
                    ))}
                  </select>
                  <input type="text" value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} placeholder="Notes (optional)" className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Subscription / month (optional)</label>
                      <input type="number" min={0} step="0.01" value={bulkSubscriptionAmount} onChange={(e) => setBulkSubscriptionAmount(e.target.value)} placeholder="Leave empty to skip" className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Billing day (1–28)</label>
                      <input type="number" min={1} max={28} value={bulkBillingDay} onChange={(e) => setBulkBillingDay(Math.max(1, Math.min(28, parseInt(e.target.value, 10) || 1)))} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                    </div>
                  </div>
                </div>

                {bulkError && <div className="p-3 mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300 whitespace-pre-line">{bulkError}</div>}
                {bulkSummary && <div className="p-3 mb-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300 whitespace-pre-line">{bulkSummary}</div>}

                <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <button type="button" onClick={() => !bulkAssigning && setShowBulkAssignModal(false)} disabled={bulkAssigning} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
                  <button
                    type="button"
                    disabled={bulkAssigning || !bulkAssignTarget || pickedCount === 0}
                    onClick={async () => {
                      setBulkAssigning(true)
                      setBulkError(null)
                      setBulkSummary(null)
                      try {
                        const payload: Record<string, unknown> = {
                          machine_ids: Array.from(bulkModalPickedIds),
                          assign_to: bulkAssignTarget,
                          notes: bulkNotes.trim() || undefined,
                        }
                        const amt = bulkSubscriptionAmount.trim()
                        if (amt) { const n = parseFloat(amt); if (!Number.isNaN(n) && n > 0) { payload.subscription_amount = n; payload.billing_day = bulkBillingDay; payload.gst_percent = 18 } }
                        const res = await apiFetch('/api/pos-machines/bulk-assign', { method: 'POST', body: JSON.stringify(payload) })
                        const data = await res.json()
                        if (!res.ok) { setBulkError(data.error || 'Bulk assign failed'); return }
                        const failList = (data.failed || []) as { id: string; error: string }[]
                        const lines = [`Done: ${data.succeeded_count} succeeded, ${data.failed_count} failed.`, ...(failList.slice(0, 10).map((f) => `• ${f.id.slice(0, 8)}… — ${f.error}`))]
                        setBulkSummary(lines.join('\n'))
                        if (data.failed_count === 0) { setSelectedIds(new Set()); setBulkModalPickedIds(new Set()); setShowBulkAssignModal(false); fetchMachines() }
                        else { fetchMachines() }
                      } catch (e: any) { setBulkError(e?.message || 'Request failed') }
                      finally { setBulkAssigning(false) }
                    }}
                    className={`px-4 py-2 text-sm font-medium text-white ${colorClasses.btn} rounded-lg disabled:opacity-50`}
                  >
                    {bulkAssigning ? 'Assigning…' : `Assign ${pickedCount} Machine${pickedCount !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* Bulk Recall Modal */}
      <AnimatePresence>
        {showBulkRecallModal && canRecall && (() => {
          const rq = bulkModalSearch.toLowerCase()
          const recallableMachines = machines.filter((m) => {
            if (!canRecallMachine(m)) return false
            if (!rq) return true
            return m.machine_id.toLowerCase().includes(rq) || (m.tid || '').toLowerCase().includes(rq) || (m.serial_number || '').toLowerCase().includes(rq) || (m.mid || '').toLowerCase().includes(rq)
          })
          const pickedCount = bulkModalPickedIds.size
          return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !bulkRecalling && setShowBulkRecallModal(false)}>
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-full">
                      <RotateCcw className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Bulk Recall Machines
                    </h2>
                  </div>
                  <button type="button" onClick={() => !bulkRecalling && setShowBulkRecallModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Recall machines back to your inventory. Only machines assigned downstream are shown. <strong>{pickedCount}</strong> selected.
                </p>
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input type="text" placeholder="Search by TID, Machine ID, SN…" value={bulkModalSearch} onChange={(e) => setBulkModalSearch(e.target.value)} className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                </div>
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mb-4">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                        <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                          <th className="px-3 py-2 w-8">
                            <input type="checkbox" checked={recallableMachines.length > 0 && recallableMachines.every((m) => bulkModalPickedIds.has(m.id))} onChange={(e) => { const next = new Set(bulkModalPickedIds); if (e.target.checked) recallableMachines.forEach((m) => next.add(m.id)); else recallableMachines.forEach((m) => next.delete(m.id)); setBulkModalPickedIds(next) }} className="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
                          </th>
                          <th className="px-2 py-2 font-medium">TID</th>
                          <th className="px-2 py-2 font-medium">Machine ID</th>
                          <th className="px-2 py-2 font-medium">Current Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recallableMachines.slice(0, 100).map((m) => (
                          <tr key={m.id} className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 ${bulkModalPickedIds.has(m.id) ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`} onClick={() => { const next = new Set(bulkModalPickedIds); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); setBulkModalPickedIds(next) }}>
                            <td className="px-3 py-1.5"><input type="checkbox" checked={bulkModalPickedIds.has(m.id)} onChange={() => {}} className="rounded border-gray-300 text-amber-600 focus:ring-amber-500 pointer-events-none" /></td>
                            <td className="px-2 py-1.5 font-mono text-gray-900 dark:text-gray-100">{m.tid || '—'}</td>
                            <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300">{m.machine_id}</td>
                            <td className="px-2 py-1.5 text-xs">{(m.inventory_status || '').replace(/_/g, ' ')}</td>
                          </tr>
                        ))}
                        {recallableMachines.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-sm">No recallable machines found</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                {pickedCount > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4 max-h-24 overflow-y-auto">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">Will recall {pickedCount} machine(s):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(bulkModalPickedIds).map((id) => { const m = machines.find((pm) => pm.id === id); return (
                        <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-xs rounded-full font-mono">
                          {m?.tid || m?.machine_id || id.slice(0, 8)}
                          <button type="button" onClick={() => { const n = new Set(bulkModalPickedIds); n.delete(id); setBulkModalPickedIds(n) }} className="hover:text-amber-600"><X className="w-3 h-3" /></button>
                        </span>
                      ) })}
                    </div>
                  </div>
                )}

                {bulkError && <div className="p-3 mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300 whitespace-pre-line">{bulkError}</div>}
                {bulkSummary && <div className="p-3 mb-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300 whitespace-pre-line">{bulkSummary}</div>}

                <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <button type="button" onClick={() => !bulkRecalling && setShowBulkRecallModal(false)} disabled={bulkRecalling} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
                  <button
                    type="button"
                    disabled={bulkRecalling || pickedCount === 0}
                    onClick={async () => {
                      setBulkRecalling(true)
                      setBulkError(null)
                      setBulkSummary(null)
                      try {
                        const res = await apiFetch('/api/pos-machines/bulk-recall', { method: 'POST', body: JSON.stringify({ machine_ids: Array.from(bulkModalPickedIds), notes: bulkNotes.trim() || undefined }) })
                        const data = await res.json()
                        if (!res.ok) { setBulkError(data.error || 'Bulk recall failed'); return }
                        const failList = (data.failed || []) as { id: string; error: string }[]
                        const lines = [`Done: ${data.succeeded_count} recalled, ${data.failed_count} failed.`, ...(failList.slice(0, 10).map((f) => `• ${f.id.slice(0, 8)}… — ${f.error}`))]
                        setBulkSummary(lines.join('\n'))
                        if (data.failed_count === 0) { setSelectedIds(new Set()); setBulkModalPickedIds(new Set()); setShowBulkRecallModal(false); fetchMachines() }
                        else { fetchMachines() }
                      } catch (e: any) { setBulkError(e?.message || 'Request failed') }
                      finally { setBulkRecalling(false) }
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
                  >
                    {bulkRecalling ? 'Recalling…' : `Recall ${pickedCount} Machine${pickedCount !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* Assign Modal */}
      <AnimatePresence>
        {showAssignModal && selectedMachine && (
          <AssignModal
            machine={selectedMachine}
            assignableUsers={assignableUsers}
            targetRoleLabel={getTargetRoleLabel()}
            accentColor={accentColor}
            colorClasses={colorClasses}
            userRole={user?.role}
            onClose={() => { setShowAssignModal(false); setSelectedMachine(null) }}
            onSuccess={(message) => {
              setShowAssignModal(false)
              setSelectedMachine(null)
              setSuccessMessage(message)
              fetchMachines()
              setTimeout(() => setSuccessMessage(null), 5000)
            }}
          />
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {showDetailModal && detailMachine && (
          <DetailModal
            machine={detailMachine}
            colorClasses={colorClasses}
            getStatusColor={getStatusColor}
            getInventoryStatusLabel={getInventoryStatusLabel}
            getTypeIcon={getTypeIcon}
            onClose={() => { setShowDetailModal(false); setDetailMachine(null) }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ===================== ASSIGN MODAL =====================
function AssignModal({ 
  machine, assignableUsers, targetRoleLabel, accentColor, colorClasses, onClose, onSuccess, userRole 
}: { 
  machine: POSMachine
  assignableUsers: AssignableUser[]
  targetRoleLabel: string
  accentColor: string
  colorClasses: any
  onClose: () => void
  onSuccess: (message: string) => void
  userRole?: string
}) {
  const [selectedUser, setSelectedUser] = useState('')
  const [assignToType, setAssignToType] = useState<'master_distributor' | 'partner' | ''>('')
  const [notes, setNotes] = useState('')
  const [subscriptionAmount, setSubscriptionAmount] = useState('')
  const [billingDay, setBillingDay] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  // For admin, separate master distributors and partners
  const isAdmin = userRole === 'admin'
  const showSubscriptionFields = isAdmin ? assignToType === 'master_distributor' : true
  const masterDistributors = isAdmin ? assignableUsers.filter((u: any) => u.type === 'master_distributor' || !u.type) : []
  const partners = isAdmin ? assignableUsers.filter((u: any) => u.type === 'partner') : []
  
  // Auto-detect type if only one type is available
  useEffect(() => {
    if (isAdmin && !assignToType) {
      if (masterDistributors.length > 0 && partners.length === 0) {
        setAssignToType('master_distributor')
      } else if (partners.length > 0 && masterDistributors.length === 0) {
        setAssignToType('partner')
      } else if (masterDistributors.length > 0 && partners.length > 0) {
        // Default to master_distributor if both available
        setAssignToType('master_distributor')
      }
    }
  }, [isAdmin, masterDistributors.length, partners.length])
  
  // Get filtered users based on selected type
  const getFilteredAssignableUsers = () => {
    if (!isAdmin) return assignableUsers
    if (assignToType === 'master_distributor') return masterDistributors
    if (assignToType === 'partner') return partners
    return assignableUsers
  }
  
  const availableUsers = getFilteredAssignableUsers()

  const filteredUsers = useMemo(() => {
    if (!searchTerm) return availableUsers
    const lower = searchTerm.toLowerCase()
    return availableUsers.filter(u => 
      u.name.toLowerCase().includes(lower) || 
      u.partner_id.toLowerCase().includes(lower) ||
      u.email.toLowerCase().includes(lower) ||
      u.business_name?.toLowerCase().includes(lower)
    )
  }, [availableUsers, searchTerm])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) {
      setError(`Please select a ${targetRoleLabel}`)
      return
    }
    
    if (isAdmin && !assignToType) {
      setError('Please select assignment type (Master Distributor or Partner)')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = {
        machine_id: machine.id,
        assign_to: selectedUser,
        assign_to_type: isAdmin ? assignToType : undefined,
        notes,
      }
      if (showSubscriptionFields) {
        const amount = subscriptionAmount.trim() ? parseFloat(subscriptionAmount) : null
        if (amount != null && !Number.isNaN(amount)) {
          payload.subscription_amount = amount
          payload.billing_day = Math.max(1, Math.min(28, billingDay))
          payload.gst_percent = 18
        }
      }
      const response = await apiFetch('/api/pos-machines/assign', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to assign machine')
      }

      onSuccess(result.message || `Machine ${machine.machine_id} assigned successfully!`)
    } catch (err: any) {
      console.error('Error assigning POS machine:', err)
      setError(err.message || 'Failed to assign machine')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className={`bg-gradient-to-r ${colorClasses.gradient} px-6 py-4 rounded-t-2xl`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">Assign POS Machine</h3>
              <p className="text-white/80 text-sm mt-0.5">
                {machine.machine_id} → {targetRoleLabel}
              </p>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Machine Info */}
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">Machine ID</span>
              <span className="text-sm font-mono font-semibold text-gray-900 dark:text-white">{machine.machine_id}</span>
            </div>
            {machine.serial_number && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">Device Serial Number</span>
                <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{machine.serial_number}</span>
              </div>
            )}
            {machine.mid && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">MID (Merchant ID)</span>
                <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{machine.mid}</span>
              </div>
            )}
            {machine.tid && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">TID (Terminal ID)</span>
                <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{machine.tid}</span>
              </div>
            )}
            {machine.brand && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">Brand</span>
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{machine.brand}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">Type</span>
              <span className="text-sm text-gray-700 dark:text-gray-300">{machine.machine_type}</span>
            </div>
          </div>

          {/* Type Selector for Admin */}
          {isAdmin && masterDistributors.length > 0 && partners.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Assignment Type *
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={`flex items-center gap-2 p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                  assignToType === 'master_distributor' 
                    ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20' 
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}>
                  <input
                    type="radio"
                    name="assign_to_type"
                    value="master_distributor"
                    checked={assignToType === 'master_distributor'}
                    onChange={(e) => {
                      setAssignToType(e.target.value as 'master_distributor')
                      setSelectedUser('') // Reset selection when type changes
                    }}
                    className="w-4 h-4 text-yellow-600"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Master Distributor</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{masterDistributors.length} available</p>
                  </div>
                </label>
                <label className={`flex items-center gap-2 p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                  assignToType === 'partner' 
                    ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' 
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}>
                  <input
                    type="radio"
                    name="assign_to_type"
                    value="partner"
                    checked={assignToType === 'partner'}
                    onChange={(e) => {
                      setAssignToType(e.target.value as 'partner')
                      setSelectedUser('') // Reset selection when type changes
                    }}
                    className="w-4 h-4 text-orange-600"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Partner</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{partners.length} available</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Subscription (for MD / Distributor / Retailer assign) */}
          {showSubscriptionFields && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Subscription amount (₹/month)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={subscriptionAmount}
                  onChange={(e) => setSubscriptionAmount(e.target.value)}
                  placeholder="Any amount"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">+ 18% GST will be applied. Optional.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Billing day (1–28)
                </label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={billingDay}
                  onChange={(e) => setBillingDay(Math.max(1, Math.min(28, parseInt(e.target.value, 10) || 1)))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Day of month to debit (e.g. 1 = 1st).</p>
              </div>
            </div>
          )}

          {/* Select User */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Select {isAdmin && assignToType === 'partner' ? 'Partner' : isAdmin && assignToType === 'master_distributor' ? 'Master Distributor' : targetRoleLabel} *
            </label>
            {availableUsers.length === 0 ? (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                <p className="text-yellow-800 dark:text-yellow-300 text-sm">
                  {isAdmin && !assignToType 
                    ? 'Please select an assignment type first.'
                    : `No active ${isAdmin && assignToType === 'partner' ? 'Partners' : isAdmin && assignToType === 'master_distributor' ? 'Master Distributors' : targetRoleLabel}s found. Please add them first.`}
                </p>
              </div>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={`Search ${isAdmin && assignToType === 'partner' ? 'Partner' : isAdmin && assignToType === 'master_distributor' ? 'Master Distributor' : targetRoleLabel}...`}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
                  {filteredUsers.map((u) => (
                    <label
                      key={u.partner_id}
                      className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
                        selectedUser === u.partner_id 
                          ? `${colorClasses.bgLight} ${colorClasses.border} border-l-4` 
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="assign_to"
                        value={u.partner_id}
                        checked={selectedUser === u.partner_id}
                        onChange={(e) => setSelectedUser(e.target.value)}
                        className={`w-4 h-4 ${colorClasses.text}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{u.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {u.business_name || u.email} • {u.partner_id}
                        </p>
                      </div>
                      <CheckCircle className={`w-4 h-4 flex-shrink-0 ${selectedUser === u.partner_id ? colorClasses.text : 'text-transparent'}`} />
                    </label>
                  ))}
                  {filteredUsers.length === 0 && (
                    <p className="p-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                      No matching {isAdmin && assignToType === 'partner' ? 'Partners' : isAdmin && assignToType === 'master_distributor' ? 'Master Distributors' : targetRoleLabel}s found
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Add any notes about this assignment..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedUser || (isAdmin && !assignToType)}
              className={`flex-1 px-4 py-2.5 ${colorClasses.btn} text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Assigning...
                </>
              ) : (
                <>
                  <ArrowRight className="w-4 h-4" />
                  Assign to {isAdmin && assignToType === 'partner' ? 'Partner' : isAdmin && assignToType === 'master_distributor' ? 'Master Distributor' : targetRoleLabel}
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

// ===================== DETAIL MODAL =====================
function DetailModal({ 
  machine, colorClasses, getStatusColor, getInventoryStatusLabel, getTypeIcon, onClose 
}: { 
  machine: POSMachine
  colorClasses: any
  getStatusColor: (status: string) => string
  getInventoryStatusLabel: (status?: string) => { label: string; color: string }
  getTypeIcon: (type: string) => React.ReactNode
  onClose: () => void
}) {
  const invStatus = getInventoryStatusLabel(machine.inventory_status)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className={`bg-gradient-to-r ${colorClasses.gradient} px-6 py-4 rounded-t-2xl`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">POS Machine Details</h3>
              <p className="text-white/80 text-sm mt-0.5 font-mono">{machine.machine_id}</p>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <DetailRow label="Machine ID" value={machine.machine_id} mono />
            <DetailRow label="Device Serial Number" value={machine.serial_number || '-'} mono />
            <DetailRow label="MID (Merchant ID)" value={machine.mid || '-'} mono />
            <DetailRow label="TID (Terminal ID)" value={machine.tid || '-'} mono />
            <DetailRow label="Brand" value={machine.brand || '-'} />
            <DetailRow label="Machine Type" value={machine.machine_type} icon={getTypeIcon(machine.machine_type)} />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Status</p>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(machine.status)}`}>
                {machine.status}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Inventory Status</p>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${invStatus.color}`}>
                {invStatus.label}
              </span>
            </div>
            <DetailRow label="Location" value={machine.location || '-'} />
            <DetailRow label="City" value={machine.city || '-'} />
            <DetailRow label="State" value={machine.state || '-'} />
            <DetailRow label="Pincode" value={machine.pincode || '-'} />
            <DetailRow label="Delivery Date" value={machine.delivery_date ? new Date(machine.delivery_date).toLocaleDateString('en-IN') : '-'} />
            <DetailRow label="Installation Date" value={machine.installation_date ? new Date(machine.installation_date).toLocaleDateString('en-IN') : '-'} />
            <div className="col-span-2">
              <DetailRow label="Notes" value={machine.notes || 'No notes'} />
            </div>
          </div>

          {/* Assignment Info */}
          {machine.assigned_by && (
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 space-y-2">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Assignment</h4>
              <div className="grid grid-cols-2 gap-2">
                <DetailRow label="Assigned By" value={machine.assigned_by} />
                <DetailRow label="Role" value={machine.assigned_by_role || '-'} />
                <DetailRow label="Date" value={machine.last_assigned_at ? new Date(machine.last_assigned_at).toLocaleString('en-IN') : '-'} />
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function DetailRow({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</p>
      <p className={`text-sm text-gray-900 dark:text-white ${mono ? 'font-mono' : ''} flex items-center gap-1.5`}>
        {icon}
        {value}
      </p>
    </div>
  )
}

