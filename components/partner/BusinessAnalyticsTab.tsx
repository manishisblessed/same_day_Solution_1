'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { apiFetch } from '@/lib/api-client'
import { motion } from 'framer-motion'
import {
  BarChart3, TrendingUp, DollarSign, Activity, RefreshCw,
  ArrowUpRight, ArrowDownRight
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart
} from 'recharts'

interface AnalyticsData {
  volumeTrends: { date: string; transactions: number; revenue: number }[]
  revenueVsCommission: { date: string; revenue: number; commission: number }[]
  topApis: { type: string; transactions: number; revenue: number }[]
  summary: {
    totalRevenue: number
    totalCommission: number
    totalTransactions: number
    avgTransactionValue: number
  }
}

export default function BusinessAnalyticsTab() {
  const { user } = useAuth()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d')

  const fetchAnalytics = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/partner/analytics?period=${period}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (err) {
      console.error('Failed to fetch analytics:', err)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { fetchAnalytics() }, [fetchAnalytics])

  const formatCurrency = (val: number) => `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-600"></div>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-purple-600" />
            Business Analytics
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Transaction trends, revenue insights, and top APIs</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as '7d' | '30d' | '90d')}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard
              label="Total Revenue"
              value={formatCurrency(data.summary.totalRevenue)}
              icon={DollarSign}
              gradient="from-green-500 to-emerald-600"
            />
            <SummaryCard
              label="Total Commission"
              value={formatCurrency(data.summary.totalCommission)}
              icon={TrendingUp}
              gradient="from-purple-500 to-purple-600"
            />
            <SummaryCard
              label="Transactions"
              value={data.summary.totalTransactions.toLocaleString()}
              icon={Activity}
              gradient="from-blue-500 to-blue-600"
            />
            <SummaryCard
              label="Avg Transaction"
              value={formatCurrency(data.summary.avgTransactionValue)}
              icon={BarChart3}
              gradient="from-orange-500 to-orange-600"
            />
          </div>

          {/* Transaction Volume Trends */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Transaction Volume Trends</h3>
            {data.volumeTrends.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={data.volumeTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === 'revenue' ? [formatCurrency(value), 'Revenue'] : [value, 'Transactions']
                    }
                  />
                  <Legend />
                  <Bar yAxisId="right" dataKey="revenue" fill="#22c55e" opacity={0.3} radius={[4, 4, 0, 0]} name="Revenue" />
                  <Line yAxisId="left" type="monotone" dataKey="transactions" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Transactions" />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-gray-400 py-12">No trend data available for this period</p>
            )}
          </div>

          {/* Revenue vs Commission + Top APIs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Revenue vs Commission */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Revenue vs Commission</h3>
              {data.revenueVsCommission.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={data.revenueVsCommission}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend />
                    <Area type="monotone" dataKey="revenue" fill="#22c55e" fillOpacity={0.2} stroke="#22c55e" strokeWidth={2} name="Revenue" />
                    <Area type="monotone" dataKey="commission" fill="#8b5cf6" fillOpacity={0.2} stroke="#8b5cf6" strokeWidth={2} name="Commission" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-gray-400 py-12">No data available</p>
              )}
            </div>

            {/* Top Performing APIs */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Top Performing APIs</h3>
              {data.topApis.length > 0 ? (
                <div className="space-y-3">
                  {data.topApis.map((api, idx) => {
                    const maxTx = data.topApis[0]?.transactions || 1
                    const pct = (api.transactions / maxTx) * 100
                    return (
                      <div key={api.type} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 dark:text-gray-300 font-medium capitalize">
                            {idx + 1}. {api.type.replace(/_/g, ' ')}
                          </span>
                          <span className="text-gray-500 dark:text-gray-400 text-xs">
                            {api.transactions.toLocaleString()} txns &middot; {formatCurrency(api.revenue)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-center text-gray-400 py-12">No API data available</p>
              )}
            </div>
          </div>
        </>
      )}
    </motion.div>
  )
}

function SummaryCard({ label, value, icon: Icon, gradient }: {
  label: string
  value: string
  icon: any
  gradient: string
}) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-gradient-to-br ${gradient} text-white p-4 shadow-md`}>
      <div className="relative z-10 flex items-center justify-between">
        <div>
          <p className="text-white/80 text-xs font-medium mb-0.5">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <div className="p-2 bg-white/20 rounded-lg">
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="absolute -bottom-3 -right-3 w-16 h-16 bg-white/10 rounded-full blur-xl"></div>
    </div>
  )
}
