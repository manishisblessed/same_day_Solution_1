'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase/client'
import { 
  RefreshCw, Download, Filter, Search, 
  ArrowDownCircle, ArrowUpCircle, 
  TrendingUp, TrendingDown, Wallet,
  Receipt, Banknote, CreditCard, DollarSign,
  Calendar, ChevronLeft, ChevronRight
} from 'lucide-react'
import { motion } from 'framer-motion'

interface LedgerEntry {
  id: string
  retailer_id: string
  wallet_type: string
  fund_category: string | null
  service_type: string | null
  transaction_type: string
  transaction_id: string | null
  amount: number
  credit: number
  debit: number
  opening_balance: number
  closing_balance: number
  balance_after: number | null
  description: string | null
  reference_id: string | null
  status: string
  created_at: string
}

interface LedgerTabProps {
  user: any
}

export default function LedgerTab({ user }: LedgerTabProps) {
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit'>('all')
  const [filterService, setFilterService] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const itemsPerPage = 50

  const fetchLedgerData = async () => {
    if (!user?.partner_id) return
    
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('wallet_ledger')
        .select('*')
        .eq('retailer_id', user.partner_id)
        .eq('wallet_type', 'primary')
        .order('created_at', { ascending: false })
        .limit(1000) // Fetch more for filtering

      if (error) throw error
      setLedgerEntries(data || [])
    } catch (error) {
      console.error('Error fetching ledger data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLedgerData()
  }, [user?.partner_id])

  // Filter and paginate entries
  const filteredEntries = useMemo(() => {
    let filtered = ledgerEntries

    // Filter by type (credit/debit)
    if (filterType === 'credit') {
      filtered = filtered.filter(e => e.credit > 0)
    } else if (filterType === 'debit') {
      filtered = filtered.filter(e => e.debit > 0)
    }

    // Filter by service type
    if (filterService !== 'all') {
      filtered = filtered.filter(e => e.service_type === filterService)
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(e => 
        e.description?.toLowerCase().includes(query) ||
        e.reference_id?.toLowerCase().includes(query) ||
        e.transaction_id?.toLowerCase().includes(query) ||
        e.transaction_type?.toLowerCase().includes(query)
      )
    }

    return filtered
  }, [ledgerEntries, filterType, filterService, searchQuery])

  // Pagination
  const paginatedEntries = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    const end = start + itemsPerPage
    const total = Math.ceil(filteredEntries.length / itemsPerPage)
    setTotalPages(total)
    return filteredEntries.slice(start, end)
  }, [filteredEntries, currentPage])

  // Get transaction type display info
  const getTransactionInfo = (entry: LedgerEntry) => {
    const type = entry.transaction_type
    const service = entry.service_type
    const isCredit = entry.credit > 0

    // Map transaction types to display info
    const typeMap: Record<string, { label: string; icon: any; color: string }> = {
      'POS_CREDIT': { label: 'POS Transaction', icon: CreditCard, color: 'text-green-600 dark:text-green-400' },
      'BBPS_DEBIT': { label: 'BBPS Payment', icon: Receipt, color: 'text-red-600 dark:text-red-400' },
      'BBPS_REFUND': { label: 'BBPS Refund', icon: Receipt, color: 'text-green-600 dark:text-green-400' },
      'PAYOUT': { label: 'Settlement', icon: Banknote, color: 'text-red-600 dark:text-red-400' },
      'SETTLEMENT_CREDIT': { label: 'Settlement Received', icon: Banknote, color: 'text-green-600 dark:text-green-400' },
      'COMMISSION': { label: 'Commission', icon: TrendingUp, color: 'text-green-600 dark:text-green-400' },
      'ADJUSTMENT': { label: 'Adjustment', icon: DollarSign, color: 'text-blue-600 dark:text-blue-400' },
      'REFUND': { label: 'Refund', icon: ArrowDownCircle, color: 'text-green-600 dark:text-green-400' },
      'CHARGE': { label: 'Charge', icon: DollarSign, color: 'text-red-600 dark:text-red-400' },
      'AEPS_DEBIT': { label: 'AEPS Transaction', icon: Wallet, color: 'text-red-600 dark:text-red-400' },
      'AEPS_CREDIT': { label: 'AEPS Credit', icon: Wallet, color: 'text-green-600 dark:text-green-400' },
      'MDR_SETTLEMENT': { label: 'MDR Settlement', icon: TrendingUp, color: 'text-green-600 dark:text-green-400' },
      'WALLET_PUSH': { label: 'Wallet Credit (Admin)', icon: ArrowDownCircle, color: 'text-green-600 dark:text-green-400' },
      'WALLET_PULL': { label: 'Wallet Debit (Admin)', icon: ArrowUpCircle, color: 'text-red-600 dark:text-red-400' },
    }

    const defaultInfo = {
      label: type.replace(/_/g, ' '),
      icon: isCredit ? ArrowDownCircle : ArrowUpCircle,
      color: isCredit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
    }

    return typeMap[type] || defaultInfo
  }

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return {
      date: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    }
  }

  // Calculate totals
  const totals = useMemo(() => {
    const credits = filteredEntries.reduce((sum, e) => sum + (e.credit || 0), 0)
    const debits = filteredEntries.reduce((sum, e) => sum + (e.debit || 0), 0)
    return { credits, debits, net: credits - debits }
  }, [filteredEntries])

  // Export to CSV
  const exportToCSV = () => {
    const headers = ['Date', 'Time', 'Type', 'Service', 'Description', 'Credit', 'Debit', 'Balance After', 'Reference ID', 'Status']
    const rows = filteredEntries.map(e => {
      const { date, time } = formatDate(e.created_at)
      const info = getTransactionInfo(e)
      return [
        date,
        time,
        info.label,
        e.service_type || '-',
        e.description || '-',
        e.credit > 0 ? e.credit.toFixed(2) : '',
        e.debit > 0 ? e.debit.toFixed(2) : '',
        (e.balance_after || e.closing_balance || 0).toFixed(2),
        e.reference_id || '-',
        e.status
      ]
    })

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wallet-ledger-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  // Get unique service types
  const serviceTypes = useMemo(() => {
    const types = new Set(ledgerEntries.map(e => e.service_type).filter((st): st is string => Boolean(st)))
    return Array.from(types).sort()
  }, [ledgerEntries])

  return (
    <div className="space-y-4">
      {/* Header with Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Credits</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                ₹{totals.credits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <ArrowDownCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Debits</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                ₹{totals.debits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <ArrowUpCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Net Amount</p>
              <p className={`text-2xl font-bold ${totals.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                ₹{totals.net.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
            </div>
            {totals.net >= 0 ? (
              <TrendingUp className="w-8 h-8 text-green-600 dark:text-green-400" />
            ) : (
              <TrendingDown className="w-8 h-8 text-red-600 dark:text-red-400" />
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Transactions</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {filteredEntries.length}
              </p>
            </div>
            <Wallet className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
        </motion.div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by description, reference ID, transaction ID..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Type Filter */}
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value as any)
              setCurrentPage(1)
            }}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="all">All Types</option>
            <option value="credit">Credits Only</option>
            <option value="debit">Debits Only</option>
          </select>

          {/* Service Type Filter */}
          <select
            value={filterService}
            onChange={(e) => {
              setFilterService(e.target.value)
              setCurrentPage(1)
            }}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="all">All Services</option>
            {serviceTypes.map(st => (
              <option key={st} value={st}>{st.toUpperCase()}</option>
            ))}
          </select>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={fetchLedgerData}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={exportToCSV}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Date & Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Transaction Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Credit (₹)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Debit (₹)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Balance After
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Reference ID
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading ledger entries...
                  </td>
                </tr>
              ) : paginatedEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No ledger entries found
                  </td>
                </tr>
              ) : (
                paginatedEntries.map((entry) => {
                  const { date, time } = formatDate(entry.created_at)
                  const info = getTransactionInfo(entry)
                  const Icon = info.icon
                  const isCredit = entry.credit > 0

                  return (
                    <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">{date}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{time}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${info.color}`} />
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {info.label}
                          </span>
                          {entry.service_type && (
                            <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded">
                              {entry.service_type.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900 dark:text-white max-w-xs truncate" title={entry.description || ''}>
                          {entry.description || '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isCredit ? (
                          <span className="text-sm font-medium text-green-600 dark:text-green-400">
                            +₹{entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!isCredit && entry.debit > 0 ? (
                          <span className="text-sm font-medium text-red-600 dark:text-red-400">
                            -₹{entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          ₹{(entry.balance_after || entry.closing_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                          {entry.reference_id || entry.transaction_id || '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          entry.status === 'completed' 
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : entry.status === 'pending'
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        }`}>
                          {entry.status}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredEntries.length)} of {filteredEntries.length} entries
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

