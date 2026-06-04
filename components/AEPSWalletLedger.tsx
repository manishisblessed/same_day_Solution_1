'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import {
  RefreshCw, Download, Search,
  ArrowDownCircle, ArrowUpCircle,
  TrendingUp, TrendingDown, Wallet,
  Banknote, DollarSign, Percent, Fingerprint,
  ChevronLeft, ChevronRight, Eye, X, ChevronDown,
  Calculator, FileText, Shield
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface LedgerEntry {
  id: string
  retailer_id: string
  wallet_type: string
  fund_category: string | null
  service_type: string | null
  transaction_type: string
  transaction_id: string | null
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

interface CommissionDetail {
  id: string
  transaction_id: string
  service_type: string
  total_commission: number
  rt_amount: number
  tds_amount: number
  status: string
  created_at: string
}

interface AEPSWalletLedgerProps {
  user: any
}

const TX_TYPE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  'AEPS_CREDIT': { label: 'AEPS Cash Withdrawal', icon: ArrowDownCircle, color: 'text-green-600 dark:text-green-400' },
  'AEPS_DEBIT': { label: 'AEPS Cash Deposit', icon: ArrowUpCircle, color: 'text-red-600 dark:text-red-400' },
  'COMMISSION_CREDIT': { label: 'Commission Earned', icon: TrendingUp, color: 'text-emerald-600 dark:text-emerald-400' },
  'TDS_DEDUCTION': { label: 'TDS Deducted', icon: Shield, color: 'text-amber-600 dark:text-amber-400' },
  'AEPS_SETTLEMENT': { label: 'Settlement to Bank', icon: Banknote, color: 'text-orange-600 dark:text-orange-400' },
  'REFUND': { label: 'Refund', icon: ArrowDownCircle, color: 'text-blue-600 dark:text-blue-400' },
  'WALLET_PUSH': { label: 'Admin Credit', icon: ArrowDownCircle, color: 'text-green-600 dark:text-green-400' },
  'WALLET_PULL': { label: 'Admin Debit', icon: ArrowUpCircle, color: 'text-red-600 dark:text-red-400' },
  'AEPS_TO_PRIMARY': { label: 'Transfer to Primary', icon: ArrowUpCircle, color: 'text-purple-600 dark:text-purple-400' },
}

export default function AEPSWalletLedger({ user }: AEPSWalletLedgerProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit' | 'commission' | 'tds'>('all')
  const [showTdsCalculator, setShowTdsCalculator] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState<10 | 25 | 100>(25)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [commissionDetails, setCommissionDetails] = useState<Record<string, CommissionDetail>>({})
  const [aepsBalance, setAepsBalance] = useState<number>(0)

  const fetchLedgerData = useCallback(async () => {
    if (!user?.partner_id) return
    setLoading(true)
    try {
      const [ledgerRes, balanceRes] = await Promise.all([
        supabase
          .from('wallet_ledger')
          .select('*')
          .eq('retailer_id', user.partner_id)
          .eq('wallet_type', 'aeps')
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase.rpc('get_wallet_balance_v2', {
          p_user_id: user.partner_id,
          p_wallet_type: 'aeps',
        }),
      ])
      setEntries(ledgerRes.data || [])
      setAepsBalance(balanceRes.data || 0)
    } catch (error) {
      console.error('Error fetching AEPS ledger:', error)
    } finally {
      setLoading(false)
    }
  }, [user?.partner_id])

  useEffect(() => {
    fetchLedgerData()
  }, [fetchLedgerData])

  const fetchCommissionDetail = async (txnId: string) => {
    if (commissionDetails[txnId]) return
    try {
      const { data } = await supabase
        .from('commission_ledger')
        .select('id, transaction_id, service_type, total_commission, rt_amount, tds_amount, status, created_at')
        .eq('transaction_id', txnId)
        .limit(1)
        .maybeSingle()
      if (data) {
        setCommissionDetails(prev => ({ ...prev, [txnId]: data }))
      }
    } catch { /* non-blocking */ }
  }

  const handleRowExpand = (entry: LedgerEntry) => {
    const entryId = entry.id
    if (expandedRow === entryId) {
      setExpandedRow(null)
      return
    }
    setExpandedRow(entryId)
    if (entry.transaction_type === 'COMMISSION_CREDIT' && entry.transaction_id) {
      fetchCommissionDetail(entry.transaction_id)
    }
  }

  const filteredEntries = useMemo(() => {
    let filtered = entries
    if (filterType === 'credit') filtered = filtered.filter(e => e.credit > 0)
    else if (filterType === 'debit') filtered = filtered.filter(e => e.debit > 0)
    else if (filterType === 'commission') filtered = filtered.filter(e => e.transaction_type === 'COMMISSION_CREDIT')
    else if (filterType === 'tds') filtered = filtered.filter(e => e.transaction_type === 'TDS_DEDUCTION')

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(e =>
        e.description?.toLowerCase().includes(q) ||
        e.reference_id?.toLowerCase().includes(q) ||
        e.transaction_id?.toLowerCase().includes(q) ||
        e.transaction_type?.toLowerCase().includes(q)
      )
    }
    return filtered
  }, [entries, filterType, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / itemsPerPage))
  const safePage = Math.min(currentPage, totalPages)

  const paginatedEntries = useMemo(() => {
    const start = (safePage - 1) * itemsPerPage
    return filteredEntries.slice(start, start + itemsPerPage)
  }, [filteredEntries, safePage, itemsPerPage])

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  const totals = useMemo(() => {
    const credits = entries.reduce((s, e) => s + (e.credit || 0), 0)
    const debits = entries.reduce((s, e) => s + (e.debit || 0), 0)
    const commissions = entries
      .filter(e => e.transaction_type === 'COMMISSION_CREDIT')
      .reduce((s, e) => s + (e.credit || 0), 0)
    const tdsDeducted = entries
      .filter(e => e.transaction_type === 'TDS_DEDUCTION')
      .reduce((s, e) => s + (e.debit || 0), 0)
    return { credits, debits, net: credits - debits, commissions, tdsDeducted }
  }, [entries])

  const getTypeInfo = (entry: LedgerEntry) => {
    const isCredit = entry.credit > 0
    const config = TX_TYPE_CONFIG[entry.transaction_type]
    if (config) return config
    return {
      label: entry.transaction_type.replace(/_/g, ' '),
      icon: isCredit ? ArrowDownCircle : ArrowUpCircle,
      color: isCredit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
    }
  }

  const formatDate = (dateString: string) => {
    const d = new Date(dateString)
    return {
      date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    }
  }

  const exportToCSV = () => {
    const headers = ['Date', 'Time', 'Type', 'Description', 'Credit (₹)', 'Debit (₹)', 'Balance After', 'Reference ID', 'Status']
    const rows = filteredEntries.map(e => {
      const { date, time } = formatDate(e.created_at)
      const info = getTypeInfo(e)
      return [date, time, info.label, e.description || '-',
        e.credit > 0 ? e.credit.toFixed(2) : '',
        e.debit > 0 ? e.debit.toFixed(2) : '',
        (e.balance_after || e.closing_balance || 0).toFixed(2),
        e.reference_id || '-', e.status]
    })
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aeps-wallet-ledger-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Balance + Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg shadow p-4 text-white"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-xs font-medium">AEPS Wallet</p>
              <p className="text-2xl font-bold">₹{aepsBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
            <Fingerprint className="w-8 h-8 text-purple-200" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Credits</p>
              <p className="text-xl font-bold text-green-600 dark:text-green-400">₹{totals.credits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
            <ArrowDownCircle className="w-7 h-7 text-green-600 dark:text-green-400" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Debits</p>
              <p className="text-xl font-bold text-red-600 dark:text-red-400">₹{totals.debits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
            <ArrowUpCircle className="w-7 h-7 text-red-600 dark:text-red-400" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Commission Earned</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">₹{totals.commissions.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
            <Percent className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-amber-200 dark:border-amber-700 cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => setShowTdsCalculator(!showTdsCalculator)}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">TDS Deducted</p>
              <p className="text-xl font-bold text-amber-600 dark:text-amber-400">₹{totals.tdsDeducted.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
            <Shield className="w-7 h-7 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="text-xs text-amber-500 mt-1">Click for TDS details</p>
        </motion.div>
      </div>

      {/* TDS Calculator / Summary Panel */}
      <AnimatePresence>
        {showTdsCalculator && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-lg shadow border border-amber-200 dark:border-amber-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <Calculator className="w-5 h-5" />
                  TDS Summary & Verification
                </h3>
                <button onClick={() => setShowTdsCalculator(false)} className="text-amber-600 hover:text-amber-800 dark:text-amber-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-amber-200 dark:border-amber-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Gross Commission (Total)</p>
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    ₹{totals.commissions.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-amber-200 dark:border-amber-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">TDS Deducted (Total)</p>
                  <p className="text-lg font-bold text-red-600 dark:text-red-400">
                    -₹{totals.tdsDeducted.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-amber-200 dark:border-amber-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Net Commission Received</p>
                  <p className="text-lg font-bold text-green-600 dark:text-green-400">
                    ₹{(totals.commissions - totals.tdsDeducted).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-amber-200 dark:border-amber-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Effective TDS Rate</p>
                  <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                    {totals.commissions > 0 ? ((totals.tdsDeducted / totals.commissions) * 100).toFixed(2) : '0.00'}%
                  </p>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-amber-200 dark:border-amber-700">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                  <FileText className="w-4 h-4" /> How to verify TDS
                </h4>
                <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1.5">
                  <li>1. TDS is deducted at source on every commission earned from AEPS transactions.</li>
                  <li>2. The TDS amount shown here should match your Form 26AS / AIS on the Income Tax portal.</li>
                  <li>3. TAN of deductor: Same Day Solution Pvt. Ltd. Check your 26AS under &quot;TDS on Other Than Salary&quot;.</li>
                  <li>4. Export the ledger (CSV) and filter by &quot;TDS Deducted&quot; to get a transaction-wise TDS statement.</li>
                  <li>5. If you find any discrepancy, raise a support ticket with the transaction IDs.</li>
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by description, reference ID, transaction ID..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 dark:bg-gray-700 dark:text-white text-sm"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value as any); setCurrentPage(1) }}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 dark:bg-gray-700 dark:text-white text-sm"
          >
            <option value="all">All Entries</option>
            <option value="credit">Credits Only</option>
            <option value="debit">Debits Only</option>
            <option value="commission">Commission Only</option>
            <option value="tds">TDS Deductions Only</option>
          </select>
          <div className="flex gap-2">
            <button onClick={() => setShowTdsCalculator(!showTdsCalculator)}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-2 text-sm">
              <Calculator className="w-4 h-4" /> TDS
            </button>
            <button onClick={fetchLedgerData} disabled={loading}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 text-sm">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={exportToCSV}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 text-sm">
              <Download className="w-4 h-4" /> Export
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
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date & Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Credit (₹)</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Debit (₹)</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Balance</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-10"></th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading AEPS wallet ledger...
                </td></tr>
              ) : paginatedEntries.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  No AEPS wallet entries found
                </td></tr>
              ) : (
                paginatedEntries.map((entry) => {
                  const { date, time } = formatDate(entry.created_at)
                  const info = getTypeInfo(entry)
                  const Icon = info.icon
                  const isCredit = entry.credit > 0
                  const isExpanded = expandedRow === entry.id
                  const commDetail = entry.transaction_id ? commissionDetails[entry.transaction_id] : null

                  return (
                    <motion.tr key={entry.id} layout
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                      onClick={() => handleRowExpand(entry)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">{date}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{time}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${info.color}`} />
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{info.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900 dark:text-white max-w-xs truncate" title={entry.description || ''}>
                          {entry.description || '-'}
                        </div>
                        {entry.reference_id && (
                          <div className="text-xs text-gray-400 font-mono truncate max-w-xs">{entry.reference_id}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isCredit ? (
                          <span className="text-sm font-medium text-green-600 dark:text-green-400">
                            +₹{entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : <span className="text-sm text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!isCredit && entry.debit > 0 ? (
                          <span className="text-sm font-medium text-red-600 dark:text-red-400">
                            -₹{entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : <span className="text-sm text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          ₹{(entry.balance_after || entry.closing_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
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
                      <td className="px-4 py-3 text-center">
                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </td>
                    </motion.tr>
                  )
                })
              )}
            </tbody>
          </table>

          {/* Expanded Row Details */}
          <AnimatePresence>
            {expandedRow && paginatedEntries.map(entry => {
              if (entry.id !== expandedRow) return null
              const commDetail = entry.transaction_id ? commissionDetails[entry.transaction_id] : null

              return (
                <motion.div
                  key={`detail-${entry.id}`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-6 py-4"
                >
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 dark:text-gray-400 text-xs">Transaction ID</span>
                      <p className="font-mono text-gray-900 dark:text-white text-xs break-all">{entry.transaction_id || '-'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400 text-xs">Reference ID</span>
                      <p className="font-mono text-gray-900 dark:text-white text-xs break-all">{entry.reference_id || '-'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400 text-xs">Category</span>
                      <p className="text-gray-900 dark:text-white">{entry.fund_category || entry.service_type || '-'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400 text-xs">Opening Balance</span>
                      <p className="text-gray-900 dark:text-white">₹{(entry.opening_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                    </div>
                  </div>

                  {entry.transaction_type === 'COMMISSION_CREDIT' && commDetail && (
                    <div className="mt-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                      <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase mb-2 flex items-center gap-1">
                        <Percent className="w-3 h-3" /> Commission Breakdown
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <span className="text-emerald-600 dark:text-emerald-400 text-xs">Gross Commission</span>
                          <p className="font-bold text-gray-900 dark:text-white">₹{commDetail.total_commission.toFixed(2)}</p>
                        </div>
                        <div>
                          <span className="text-emerald-600 dark:text-emerald-400 text-xs">Your Share (RT)</span>
                          <p className="font-bold text-gray-900 dark:text-white">₹{commDetail.rt_amount.toFixed(2)}</p>
                        </div>
                        <div>
                          <span className="text-red-600 dark:text-red-400 text-xs">TDS Deducted</span>
                          <p className="font-bold text-red-600 dark:text-red-400">-₹{commDetail.tds_amount.toFixed(2)}</p>
                        </div>
                        <div>
                          <span className="text-green-600 dark:text-green-400 text-xs">Net Credited</span>
                          <p className="font-bold text-green-600 dark:text-green-400">₹{entry.credit.toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>

        {/* Pagination */}
        {filteredEntries.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <span className="whitespace-nowrap">Rows per page:</span>
              <select
                value={itemsPerPage}
                onChange={(e) => { setItemsPerPage(Number(e.target.value) as 10 | 25 | 100); setCurrentPage(1) }}
                className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={100}>100</option>
              </select>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {(safePage - 1) * itemsPerPage + 1}–{Math.min(safePage * itemsPerPage, filteredEntries.length)} of {filteredEntries.length}
              </span>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                  className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300">Page {safePage} of {totalPages}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                  className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
