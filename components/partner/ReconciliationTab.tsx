'use client'

import { useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { apiFetch } from '@/lib/api-client'
import { motion } from 'framer-motion'
import {
  Scale, Download, RefreshCw, CheckCircle, XCircle,
  AlertTriangle, Calendar, FileSpreadsheet, Search
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts'

interface ComparisonRow {
  date: string
  transactionTotal: number
  settlementTotal: number
  difference: number
  status: 'matched' | 'mismatch'
}

interface ReconciliationData {
  settlements: any[]
  transactions: { date: string; totalCredit: number; totalDebit: number; transactionCount: number }[]
  comparison: ComparisonRow[]
  summary: {
    totalTransactions: number
    totalSettlements: number
    totalTransactionAmount: number
    totalSettlementAmount: number
    netDifference: number
    matchRate: number
  }
}

export default function ReconciliationTab() {
  const { user } = useAuth()
  const [data, setData] = useState<ReconciliationData | null>(null)
  const [loading, setLoading] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [groupBy, setGroupBy] = useState<'daily' | 'monthly'>('daily')
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const fetchReconciliation = useCallback(async () => {
    if (!startDate || !endDate) {
      setError('Please select both start and end dates')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await apiFetch(
        `/api/partner/reconciliation?start_date=${startDate}&end_date=${endDate}&group_by=${groupBy}`
      )
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (err: any) {
      console.error('Failed to fetch reconciliation:', err)
      setError(err.message || 'Failed to load reconciliation data')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, groupBy])

  const exportCSV = async () => {
    if (!data) return
    setExporting(true)
    try {
      const headers = ['Date', 'Transaction Total', 'Settlement Total', 'Difference', 'Status']
      const rows = data.comparison.map(r => [
        r.date,
        r.transactionTotal.toFixed(2),
        r.settlementTotal.toFixed(2),
        r.difference.toFixed(2),
        r.status,
      ])
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `reconciliation_${startDate}_to_${endDate}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch {
      setError('Failed to export report')
    } finally {
      setExporting(false)
    }
  }

  const formatCurrency = (val: number) => `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const mismatchCount = data?.comparison.filter(r => r.status === 'mismatch').length || 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Scale className="w-5 h-5 text-purple-600" />
          Reconciliation
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Compare settlements against transactions to identify mismatches</p>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Group By</label>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as 'daily' | 'monthly')}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <button
            onClick={fetchReconciliation}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Generate Report
          </button>
          {data && (
            <button
              onClick={exportCSV}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          )}
        </div>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-2 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> {error}
          </p>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-600"></div>
        </div>
      )}

      {data && !loading && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Transaction Volume</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(data.summary.totalTransactionAmount)}</p>
              <p className="text-xs text-gray-500 mt-1">{data.summary.totalTransactions} transactions</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Settlement Volume</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(data.summary.totalSettlementAmount)}</p>
              <p className="text-xs text-gray-500 mt-1">{data.summary.totalSettlements} settlements</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Net Difference</p>
              <p className={`text-xl font-bold ${data.summary.netDifference === 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(Math.abs(data.summary.netDifference))}
              </p>
              <p className="text-xs text-gray-500 mt-1">{data.summary.netDifference >= 0 ? 'Over-settled' : 'Under-settled'}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Match Rate</p>
              <p className={`text-xl font-bold ${data.summary.matchRate >= 95 ? 'text-green-600' : data.summary.matchRate >= 80 ? 'text-yellow-600' : 'text-red-600'}`}>
                {data.summary.matchRate.toFixed(1)}%
              </p>
              <p className="text-xs text-gray-500 mt-1">{mismatchCount} mismatches found</p>
            </div>
          </div>

          {/* Comparison Chart */}
          {data.comparison.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Transactions vs Settlements</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.comparison}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Bar dataKey="transactionTotal" name="Transactions" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="settlementTotal" name="Settlements" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Comparison Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Detailed Comparison</h3>
            </div>
            {data.comparison.length === 0 ? (
              <div className="text-center py-12">
                <Scale className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400">No data for the selected period</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Transactions</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Settlements</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Difference</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {data.comparison.map((row) => (
                      <tr
                        key={row.date}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                          row.status === 'mismatch' ? 'bg-red-50/50 dark:bg-red-900/10' : ''
                        }`}
                      >
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-medium">{row.date}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{formatCurrency(row.transactionTotal)}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{formatCurrency(row.settlementTotal)}</td>
                        <td className={`px-4 py-3 text-sm text-right font-medium ${
                          row.difference === 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {row.difference >= 0 ? '+' : ''}{formatCurrency(row.difference)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.status === 'matched' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                              <CheckCircle className="w-3 h-3" /> Matched
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                              <XCircle className="w-3 h-3" /> Mismatch
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!data && !loading && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
          <Scale className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">Select a Date Range</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Choose start and end dates above to generate a reconciliation report</p>
        </div>
      )}
    </motion.div>
  )
}
