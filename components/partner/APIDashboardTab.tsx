'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { apiFetch } from '@/lib/api-client'
import { motion } from 'framer-motion'
import {
  Server, Key, Activity, AlertTriangle, Globe, RefreshCw,
  CheckCircle, XCircle, TrendingUp, Clock, Link2, Send,
  Shield, Eye, EyeOff, Copy, Check
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'
import POSPartnerAPIManagement from '@/components/POSPartnerAPIManagement'

interface ApiStats {
  totalApiCalls: number
  successCount: number
  failureCount: number
  errorRate: number
  dailyUsage: { date: string; count: number }[]
  usageByType: { type: string; count: number }[]
  apiKeys: { total: number; active: number }
  webhookUrl: string | null
}

const PIE_COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#6366f1']

export default function APIDashboardTab() {
  const { user } = useAuth()
  const [stats, setStats] = useState<ApiStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d')
  const [activeSection, setActiveSection] = useState<'overview' | 'keys' | 'webhooks'>('overview')
  const [webhookTestLoading, setWebhookTestLoading] = useState(false)
  const [webhookTestResult, setWebhookTestResult] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/partner/api-stats?period=${period}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setStats(data)
    } catch (err) {
      console.error('Failed to fetch API stats:', err)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { fetchStats() }, [fetchStats])

  const testWebhook = async () => {
    if (!stats?.webhookUrl) return
    setWebhookTestLoading(true)
    setWebhookTestResult(null)
    try {
      const res = await apiFetch('/api/partner/api-stats?test_webhook=true', { method: 'POST' })
      const data = await res.json()
      setWebhookTestResult(data.success ? 'Webhook test sent successfully' : data.error || 'Test failed')
    } catch {
      setWebhookTestResult('Failed to send test webhook')
    } finally {
      setWebhookTestLoading(false)
    }
  }

  const sections = [
    { id: 'overview' as const, label: 'Overview', icon: Activity },
    { id: 'keys' as const, label: 'API Keys', icon: Key },
    { id: 'webhooks' as const, label: 'Webhooks', icon: Globe },
  ]

  const successRate = stats ? (stats.totalApiCalls > 0 ? ((stats.successCount / stats.totalApiCalls) * 100).toFixed(1) : '0.0') : '0.0'

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
            <Server className="w-5 h-5 text-purple-600" />
            API Dashboard
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Monitor your API usage, keys, and integrations</p>
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
            onClick={fetchStats}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-1">
        <div className="flex gap-1">
          {sections.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeSection === s.id
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {loading && !stats ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-600"></div>
        </div>
      ) : (
        <>
          {/* Overview Section */}
          {activeSection === 'overview' && stats && (
            <div className="space-y-4">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  label="Total API Calls"
                  value={stats.totalApiCalls.toLocaleString()}
                  icon={Activity}
                  gradient="from-blue-500 to-blue-600"
                />
                <StatCard
                  label="Success Rate"
                  value={`${successRate}%`}
                  icon={CheckCircle}
                  gradient="from-green-500 to-green-600"
                />
                <StatCard
                  label="Error Rate"
                  value={`${stats.errorRate.toFixed(1)}%`}
                  icon={AlertTriangle}
                  gradient="from-red-500 to-red-600"
                />
                <StatCard
                  label="Active API Keys"
                  value={`${stats.apiKeys.active} / ${stats.apiKeys.total}`}
                  icon={Key}
                  gradient="from-purple-500 to-purple-600"
                />
              </div>

              {/* Usage Chart */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Daily API Usage</h3>
                  {stats.dailyUsage.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={stats.dailyUsage}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-gray-400 py-12">No usage data available</p>
                  )}
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Usage by API Type</h3>
                  {stats.usageByType.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={stats.usageByType}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="type" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-gray-400 py-12">No usage data available</p>
                  )}
                </div>
              </div>

              {/* Error Rate Monitor */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Error Rate Monitoring</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center gap-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                    <div>
                      <p className="text-2xl font-bold text-green-700 dark:text-green-400">{stats.successCount.toLocaleString()}</p>
                      <p className="text-xs text-green-600 dark:text-green-500">Successful</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <XCircle className="w-8 h-8 text-red-600" />
                    <div>
                      <p className="text-2xl font-bold text-red-700 dark:text-red-400">{stats.failureCount.toLocaleString()}</p>
                      <p className="text-xs text-red-600 dark:text-red-500">Failed</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <TrendingUp className="w-8 h-8 text-blue-600" />
                    <div>
                      <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{successRate}%</p>
                      <p className="text-xs text-blue-600 dark:text-blue-500">Success Rate</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* API Keys Section */}
          {activeSection === 'keys' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex items-center gap-2 px-3 py-1 bg-green-100 dark:bg-green-900/30 rounded-full">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-xs font-medium text-green-700 dark:text-green-400">Live Environment</span>
                  </div>
                </div>
                <POSPartnerAPIManagement />
              </div>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center">
                <Shield className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">Sandbox Environment</h3>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">Sandbox API keys coming soon. Use Live keys for testing with test amounts.</p>
              </div>
            </div>
          )}

          {/* Webhooks Section */}
          {activeSection === 'webhooks' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-purple-600" />
                  Webhook Configuration
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Webhook URL</label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-mono text-gray-700 dark:text-gray-300 truncate">
                        {stats?.webhookUrl || 'No webhook URL configured'}
                      </div>
                      {stats?.webhookUrl && (
                        <button
                          onClick={testWebhook}
                          disabled={webhookTestLoading}
                          className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50"
                        >
                          <Send className={`w-4 h-4 ${webhookTestLoading ? 'animate-pulse' : ''}`} />
                          Test
                        </button>
                      )}
                    </div>
                    {webhookTestResult && (
                      <p className={`text-xs mt-2 ${webhookTestResult.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
                        {webhookTestResult}
                      </p>
                    )}
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                    <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Webhook Events</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {['transaction.completed', 'transaction.failed', 'settlement.processed', 'payout.completed'].map(evt => (
                        <div key={evt} className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          {evt}
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    Webhook URL can be configured via the API Management section or by contacting support.
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}

function StatCard({ label, value, icon: Icon, gradient }: {
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
