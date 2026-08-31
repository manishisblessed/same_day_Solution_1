'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { FileText, RefreshCw, Percent, Store } from 'lucide-react'

interface CommissionRate {
  mode: string
  card_type?: string | null
  merchant_slug?: string | null
  partner_mdr?: number | null
  master_commission_percent: number
  master_commission_tds_percent: number
}

interface PartnerScheme {
  partner_id: string
  name: string
  email?: string
  phone?: string
  status?: string
  scheme: { id: string; name: string; is_partner_plan?: boolean; status?: string } | null
  commissionRates: CommissionRate[]
}

const pct = (n?: number | null) =>
  n == null ? '—' : `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 4 })}%`

export default function MasterPartnerSchemesTab() {
  const [partners, setPartners] = useState<PartnerScheme[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    apiFetch('/api/master-partner/schemes')
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setPartners(res.data.partners || [])
        else setError(res.error || 'Failed to load schemes')
      })
      .catch(() => setError('Failed to load schemes'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-purple-600" /> Partner Schemes
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The MDR plan assigned to each of your partners and the POS commission you earn on it.
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-gray-100 dark:bg-gray-700 rounded-xl" />)}
        </div>
      ) : partners.length === 0 ? (
        <div className="py-12 text-center text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          No partners onboarded under you yet.
        </div>
      ) : (
        <div className="space-y-4">
          {partners.map((p) => (
            <div key={p.partner_id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white">{p.name}</div>
                  <div className="text-xs text-gray-400">{p.email || p.phone || ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  {p.scheme ? (
                    <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                      {p.scheme.name}
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-lg text-xs bg-gray-100 text-gray-500">No MDR scheme resolved</span>
                  )}
                </div>
              </div>

              {p.commissionRates.length === 0 ? (
                <p className="text-sm text-gray-400">No POS commission configured on this partner&apos;s plan.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                        <th className="py-2 pr-3 font-medium">Mode</th>
                        <th className="py-2 px-3 font-medium">Merchant</th>
                        <th className="py-2 px-3 font-medium text-right">Partner MDR</th>
                        <th className="py-2 px-3 font-medium text-right">Your Commission</th>
                        <th className="py-2 pl-3 font-medium text-right">TDS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.commissionRates.map((r, idx) => (
                        <tr key={idx} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                          <td className="py-2 pr-3">
                            <span className="font-medium text-gray-800 dark:text-gray-200">{r.mode}</span>
                            {r.card_type ? <span className="text-xs text-gray-400 ml-1">{r.card_type}</span> : null}
                          </td>
                          <td className="py-2 px-3 text-gray-600 dark:text-gray-300">
                            <span className="inline-flex items-center gap-1">
                              <Store className="w-3.5 h-3.5 text-gray-400" />
                              {r.merchant_slug || 'All'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-300">{pct(r.partner_mdr)}</td>
                          <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                            <span className="inline-flex items-center gap-1 justify-end">
                              <Percent className="w-3.5 h-3.5" />{pct(r.master_commission_percent)}
                            </span>
                          </td>
                          <td className="py-2 pl-3 text-right text-gray-500">{pct(r.master_commission_tds_percent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
