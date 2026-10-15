'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Landmark, Receipt, FileText, Loader2, TrendingUp, IndianRupee, FileCheck, Building2, RefreshCw, Radio } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'

interface DashboardStats {
  todayTxnCount: number
  todayBankMdr: number
  pendingInvoices: number
  totalConfigs: number
}

interface CompanyLive {
  brand_id: string
  brand_name: string
  brand_short: string
  today_count: number
  today_txn_value: number
  today_bank_mdr: number
  month_count: number
  month_txn_value: number
  month_bank_mdr: number
  margin_percent: number
  gst_percent: number
  month_service_charge: number
  month_gst: number
}

interface CompanyTotals {
  today_count: number
  today_bank_mdr: number
  month_count: number
  month_txn_value: number
  month_bank_mdr: number
  month_gst: number
}

const INR = (n: number) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const POLL_MS = 20000

export default function CABillingPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [companies, setCompanies] = useState<CompanyLive[]>([])
  const [companyTotals, setCompanyTotals] = useState<CompanyTotals | null>(null)
  const [companiesLoading, setCompaniesLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    if (!loading && user?.role !== 'ca_executive') {
      router.push('/ca/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (user?.role !== 'ca_executive') return
    const fetchStats = async () => {
      try {
        const res = await apiFetch('/api/ca/reimbursement?date_from=today&limit=0&stats_only=1')
        const data = await res.json()
        setStats({
          todayTxnCount: data.today_count ?? 0,
          todayBankMdr: data.today_bank_mdr ?? 0,
          pendingInvoices: data.pending_invoices ?? 0,
          totalConfigs: data.total_configs ?? 0,
        })
      } catch {
        // ignore
      } finally {
        setStatsLoading(false)
      }
    }
    fetchStats()
  }, [user])

  // Live per-company summary — polls every 20s
  useEffect(() => {
    if (user?.role !== 'ca_executive') return
    let active = true
    const fetchCompanies = async () => {
      try {
        const res = await apiFetch('/api/ca/reimbursement/by-company')
        const data = await res.json()
        if (!active) return
        setCompanies(data.companies || [])
        setCompanyTotals(data.totals || null)
        setLastUpdated(new Date())
      } catch {
        // ignore transient errors
      } finally {
        if (active) setCompaniesLoading(false)
      }
    }
    fetchCompanies()
    const t = setInterval(fetchCompanies, POLL_MS)
    return () => { active = false; clearInterval(t) }
  }, [user])

  if (loading || !user || user.role !== 'ca_executive') {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
      </div>
    )
  }

  const cards = [
    {
      href: '/ca/billing/bank-mdr',
      title: 'Bank MDR Rates',
      desc: 'Configure what the bank charges per TID, brand, payment mode, and card type.',
      icon: Landmark,
      color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
      hoverBorder: 'hover:border-blue-300 dark:hover:border-blue-700',
    },
    {
      href: '/ca/billing/reimbursement',
      title: 'Reimbursement Invoices',
      desc: 'Auto-generated per transaction. View, filter by brand/TID/date, and export.',
      icon: Receipt,
      color: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
      hoverBorder: 'hover:border-emerald-300 dark:hover:border-emerald-700',
    },
    {
      href: '/ca/billing/transaction-invoices',
      title: 'GST Transaction Invoices',
      desc: 'Generate monthly invoices per brand with bank MDR + margin + GST for GSTR-1 filing.',
      icon: FileText,
      color: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
      hoverBorder: 'hover:border-violet-300 dark:hover:border-violet-700',
    },
  ]

  const statCards = [
    {
      label: "Today's Transactions",
      value: stats?.todayTxnCount ?? '—',
      icon: TrendingUp,
      color: 'text-blue-600',
    },
    {
      label: "Today's Bank MDR",
      value: stats ? `₹${Number(stats.todayBankMdr).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—',
      icon: IndianRupee,
      color: 'text-emerald-600',
    },
    {
      label: 'Draft GST Invoices',
      value: stats?.pendingInvoices ?? '—',
      icon: FileCheck,
      color: 'text-violet-600',
    },
    {
      label: 'MDR Configs',
      value: stats?.totalConfigs ?? '—',
      icon: Landmark,
      color: 'text-orange-600',
    },
  ]

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">CA Billing Workspace</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Signed in as <span className="font-medium">{user.name || user.email}</span>
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
            </div>
            {statsLoading ? (
              <div className="h-6 w-16 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
            ) : (
              <div className="text-xl font-bold text-gray-900 dark:text-white">{value}</div>
            )}
          </div>
        ))}
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map(({ href, title, desc, icon: Icon, color, hoverBorder }) => (
          <Link
            key={href}
            href={href}
            className={`group p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 ${hoverBorder} hover:shadow-md transition-all`}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${color}`}>
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white group-hover:text-violet-700 dark:group-hover:text-violet-400">
                  {title}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Live transactions by company */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-violet-600" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Live Transactions by Company</h3>
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <Radio className="w-3 h-3 animate-pulse" /> live
            </span>
          </div>
          <span className="text-xs text-gray-400 flex items-center gap-1">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
            <RefreshCw className="w-3 h-3" />
          </span>
        </div>

        {companiesLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>
        ) : companies.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">
            No transactions recorded this month yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Company</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Today Txns</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Today Bank MDR</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">MTD Txns</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">MTD Txn Value</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">MTD Bank MDR</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Proj. GST (MTD)</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.brand_id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                      <Link href={`/ca/billing/reimbursement?brand_id=${c.brand_id}`} className="hover:text-violet-600 hover:underline">
                        {c.brand_name || c.brand_short}
                      </Link>
                      <span className="block text-xs text-gray-400">margin {c.margin_percent}% · GST {c.gst_percent}%</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{c.today_count.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400">{INR(c.today_bank_mdr)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{c.month_count.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900 dark:text-white">{INR(c.month_txn_value)}</td>
                    <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400">{INR(c.month_bank_mdr)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-violet-700 dark:text-violet-300">{INR(c.month_gst)}</td>
                  </tr>
                ))}
              </tbody>
              {companyTotals && (
                <tfoot>
                  <tr className="bg-gray-50 dark:bg-gray-800/60 border-t-2 border-gray-200 dark:border-gray-700 font-bold text-gray-900 dark:text-white">
                    <td className="px-4 py-2.5">All Companies</td>
                    <td className="px-4 py-2.5 text-right">{companyTotals.today_count.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400">{INR(companyTotals.today_bank_mdr)}</td>
                    <td className="px-4 py-2.5 text-right">{companyTotals.month_count.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-2.5 text-right">{INR(companyTotals.month_txn_value)}</td>
                    <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400">{INR(companyTotals.month_bank_mdr)}</td>
                    <td className="px-4 py-2.5 text-right text-violet-700 dark:text-violet-300">{INR(companyTotals.month_gst)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Quick summary card */}
      <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl p-5">
        <h3 className="font-semibold text-violet-900 dark:text-violet-300 mb-2">Monthly Workflow</h3>
        <ol className="space-y-1.5 text-sm text-violet-800 dark:text-violet-400 list-decimal list-inside">
          <li>Reimbursement invoices auto-generate for every POS transaction captured.</li>
          <li>Configure Bank MDR rates per TID/brand — used to calculate bank cost on each transaction.</li>
          <li>At month end: generate a Transaction Invoice per brand → downloads the GSTR-1 output tax amount.</li>
        </ol>
      </div>
    </motion.div>
  )
}
