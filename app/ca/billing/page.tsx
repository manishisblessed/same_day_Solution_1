'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Landmark, Receipt, FileText, Loader2, TrendingUp, IndianRupee, FileCheck, Building2, RefreshCw, Radio, Sparkles, ArrowUpRight } from 'lucide-react'
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
      gradient: 'from-blue-500 to-cyan-500',
      iconBg: 'from-blue-500/15 to-cyan-500/15',
      iconColor: 'text-blue-600 dark:text-blue-300',
      ring: 'hover:ring-blue-300/60 dark:hover:ring-blue-700/60',
    },
    {
      href: '/ca/billing/reimbursement',
      title: 'Reimbursement Invoices',
      desc: 'Auto-generated per transaction. View, filter by brand/TID/date, and export.',
      icon: Receipt,
      gradient: 'from-emerald-500 to-teal-500',
      iconBg: 'from-emerald-500/15 to-teal-500/15',
      iconColor: 'text-emerald-600 dark:text-emerald-300',
      ring: 'hover:ring-emerald-300/60 dark:hover:ring-emerald-700/60',
    },
    {
      href: '/ca/billing/transaction-invoices',
      title: 'GST Transaction Invoices',
      desc: 'Generate monthly invoices per brand with bank MDR + margin + GST for GSTR-1 filing.',
      icon: FileText,
      gradient: 'from-violet-500 to-fuchsia-500',
      iconBg: 'from-violet-500/15 to-fuchsia-500/15',
      iconColor: 'text-violet-600 dark:text-violet-300',
      ring: 'hover:ring-violet-300/60 dark:hover:ring-violet-700/60',
    },
  ]

  const statCards = [
    {
      label: "Today's Transactions",
      value: stats?.todayTxnCount ?? '—',
      icon: TrendingUp,
      gradient: 'from-blue-500 to-cyan-500',
      tint: 'from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/10',
    },
    {
      label: "Today's Bank MDR",
      value: stats ? `₹${Number(stats.todayBankMdr).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—',
      icon: IndianRupee,
      gradient: 'from-emerald-500 to-teal-500',
      tint: 'from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/10',
    },
    {
      label: 'Draft GST Invoices',
      value: stats?.pendingInvoices ?? '—',
      icon: FileCheck,
      gradient: 'from-violet-500 to-fuchsia-500',
      tint: 'from-violet-50 to-fuchsia-50 dark:from-violet-900/20 dark:to-fuchsia-900/10',
    },
    {
      label: 'MDR Configs',
      value: stats?.totalConfigs ?? '—',
      icon: Landmark,
      gradient: 'from-orange-500 to-amber-500',
      tint: 'from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/10',
    },
  ]

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
  }
  const item = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 260, damping: 24 } },
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-8 max-w-6xl"
    >
      {/* Hero banner */}
      <motion.div
        variants={item}
        className="relative overflow-hidden rounded-2xl border border-violet-200/60 dark:border-violet-800/40 bg-gradient-to-br from-violet-600 via-violet-500 to-fuchsia-500 dark:from-violet-800 dark:via-violet-700 dark:to-fuchsia-800 p-6 sm:p-8 shadow-[0_10px_40px_-15px_rgba(124,58,237,0.6)]"
      >
        {/* decorative blobs */}
        <motion.div
          aria-hidden
          className="absolute -top-20 -right-16 w-72 h-72 rounded-full bg-fuchsia-400/30 blur-3xl"
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.7, 0.5] }}
          transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden
          className="absolute -bottom-24 -left-16 w-80 h-80 rounded-full bg-violet-300/20 blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], opacity: [0.4, 0.6, 0.4] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_30%_10%,rgba(255,255,255,0.18),transparent_55%)]"
        />

        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-white text-[11px] font-medium ring-1 ring-white/25 backdrop-blur-sm">
              <Sparkles className="w-3 h-3" /> CA Billing Workspace
            </div>
            <h1 className="mt-3 text-2xl sm:text-3xl font-bold text-white tracking-tight drop-shadow-sm">
              Welcome back, {(user.name || user.email || '').split(' ')[0] || 'CA'}
            </h1>
            <p className="text-violet-50/90 mt-1.5 text-sm sm:text-base">
              Reconcile transactions, manage MDR &amp; file GSTR-1 — all from one hub.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <Link
              href="/ca/billing/transaction-invoices"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-violet-700 text-sm font-semibold shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"
            >
              Generate Invoices <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </motion.div>

      {/* Stats row */}
      <motion.div variants={container} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, gradient, tint }) => (
          <motion.div
            key={label}
            variants={item}
            whileHover={{ y: -3 }}
            className={`relative overflow-hidden bg-gradient-to-br ${tint} dark:bg-gray-800/40 rounded-2xl border border-gray-200/70 dark:border-gray-700/70 p-4 shadow-sm hover:shadow-md transition-all`}
          >
            <div
              aria-hidden
              className={`absolute -top-6 -right-6 w-20 h-20 rounded-full bg-gradient-to-br ${gradient} opacity-10 blur-xl`}
            />
            <div className="relative flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-lg bg-gradient-to-br ${gradient} text-white shadow-sm`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
            </div>
            {statsLoading ? (
              <div className="h-7 w-20 bg-gray-200/70 dark:bg-gray-700 rounded animate-pulse" />
            ) : (
              <div className="relative text-xl sm:text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                {value}
              </div>
            )}
          </motion.div>
        ))}
      </motion.div>

      {/* Feature cards */}
      <motion.div variants={container} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map(({ href, title, desc, icon: Icon, gradient, iconBg, iconColor, ring }) => (
          <motion.div key={href} variants={item} whileHover={{ y: -4 }}>
            <Link
              href={href}
              className={`group relative block p-5 rounded-2xl border border-gray-200/70 dark:border-gray-700/70 bg-white dark:bg-gray-800/50 ring-1 ring-transparent ${ring} hover:shadow-xl transition-all overflow-hidden h-full`}
            >
              {/* gradient wash on hover */}
              <div
                aria-hidden
                className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${gradient} opacity-80`}
              />
              <div
                aria-hidden
                className={`absolute -bottom-10 -right-10 w-32 h-32 rounded-full bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-10 blur-2xl transition-opacity duration-500`}
              />
              <div className="relative flex items-start gap-3">
                <div className={`p-2.5 rounded-xl bg-gradient-to-br ${iconBg} ring-1 ring-inset ring-white/40 dark:ring-white/5`}>
                  <Icon className={`w-6 h-6 ${iconColor}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-gray-900 dark:text-white group-hover:text-violet-700 dark:group-hover:text-violet-300 transition-colors">
                      {title}
                    </h2>
                    <ArrowUpRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-violet-600 dark:group-hover:text-violet-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{desc}</p>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}
      </motion.div>

      {/* Live transactions by company */}
      <motion.div
        variants={item}
        className="rounded-2xl border border-gray-200/70 dark:border-gray-700/70 bg-white dark:bg-gray-900 overflow-hidden shadow-sm"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-violet-50/60 to-fuchsia-50/60 dark:from-violet-900/20 dark:to-fuchsia-900/10">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm">
              <Building2 className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Live Transactions by Company</h3>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/20">
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
      </motion.div>

      {/* Quick summary card */}
      <motion.div
        variants={item}
        className="relative overflow-hidden bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 dark:from-violet-900/20 dark:via-gray-900 dark:to-fuchsia-900/20 border border-violet-200/70 dark:border-violet-800/40 rounded-2xl p-5 shadow-sm"
      >
        <div
          aria-hidden
          className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-10 blur-3xl"
        />
        <div className="relative flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            <Sparkles className="w-4 h-4" />
          </div>
          <h3 className="font-semibold text-violet-900 dark:text-violet-200">Monthly Workflow</h3>
        </div>
        <ol className="relative space-y-2 text-sm text-violet-900/80 dark:text-violet-200/80 list-decimal list-inside marker:text-violet-600 dark:marker:text-violet-400 marker:font-semibold">
          <li>Reimbursement invoices auto-generate for every POS transaction captured.</li>
          <li>Configure Bank MDR rates per TID/brand — used to calculate bank cost on each transaction.</li>
          <li>At month end: generate a Transaction Invoice per brand → downloads the GSTR-1 output tax amount.</li>
        </ol>
      </motion.div>
    </motion.div>
  )
}
