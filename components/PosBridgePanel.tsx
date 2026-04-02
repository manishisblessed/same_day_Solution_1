'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Terminal, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

const MERCHANT_OPTIONS = [
  { value: 'ashvam', label: 'ASHVAM LEARNING' },
  { value: 'teachway', label: 'Teachway Education' },
  { value: 'newscenaric', label: 'New Scenaric Travels' },
  { value: 'lagoon', label: 'Lagoon Craft Labs' },
] as const

const PAY_MODES = ['CASH', 'UPI', 'BHARATQR', 'CARD', 'AMAZONPAY'] as const

type Variant = 'admin' | 'retailer'

export default function PosBridgePanel({ variant }: { variant: Variant }) {
  const [open, setOpen] = useState(variant === 'admin')
  const [configuredSlugs, setConfiguredSlugs] = useState<string[]>([])
  const [machines, setMachines] = useState<{ serial_number: string; machine_id: string; tid: string | null }[]>([])
  const [loadingMeta, setLoadingMeta] = useState(true)

  const [merchantSlug, setMerchantSlug] = useState<string>('newscenaric')
  const [deviceSerial, setDeviceSerial] = useState('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<string>('CASH')
  const [customerMobile, setCustomerMobile] = useState('')
  const [externalRef, setExternalRef] = useState('')
  const [externalRef2, setExternalRef2] = useState('')
  const [origP2pRequestId, setOrigP2pRequestId] = useState('')
  const [refundExtRef, setRefundExtRef] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [refundExt2, setRefundExt2] = useState('')
  const [voidTxnId, setVoidTxnId] = useState('')
  const [extRefNumbersJson, setExtRefNumbersJson] = useState('')

  const [busy, setBusy] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingMeta(true)
      try {
        const cfgRes = await apiFetch('/api/pos-bridge/config')
        const cfg = await cfgRes.json()
        if (!cancelled && cfg.configured_slugs?.length) {
          setConfiguredSlugs(cfg.configured_slugs)
          if (cfg.configured_slugs.includes('newscenaric')) setMerchantSlug('newscenaric')
          else setMerchantSlug(cfg.configured_slugs[0])
        }
        if (variant === 'retailer') {
          const mRes = await apiFetch('/api/pos-machines/my-machines?limit=200')
          const mJson = await mRes.json()
          const list = (mJson.data || mJson.machines || []) as any[]
          if (!cancelled && Array.isArray(list)) {
            setMachines(
              list
                .filter((m) => m.serial_number)
                .map((m) => ({
                  serial_number: String(m.serial_number),
                  machine_id: String(m.machine_id || ''),
                  tid: m.tid ? String(m.tid) : null,
                }))
            )
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingMeta(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [variant])

  const postBridge = useCallback(async (path: string, body: Record<string, unknown>) => {
    setBusy(path)
    setError(null)
    setLastResult(null)
    try {
      const res = await apiFetch(`/api/pos-bridge/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      setLastResult(json)
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`)
      }
    } catch (e: any) {
      setError(e?.message || 'Request failed')
    } finally {
      setBusy(null)
    }
  }, [])

  const parseExtRefNumbers = (): string[] | undefined => {
    const t = extRefNumbersJson.trim()
    if (!t) return undefined
    try {
      const p = JSON.parse(t)
      return Array.isArray(p) ? p.map(String) : undefined
    } catch {
      return undefined
    }
  }

  const onPay = () => {
    const body: Record<string, unknown> = {
      merchant_slug: merchantSlug,
      amount,
      mode,
      device_serial: deviceSerial.trim() || undefined,
      device_id: deviceSerial.includes('|') ? deviceSerial.trim() : undefined,
    }
    if (customerMobile.trim()) body.customerMobile = customerMobile.trim()
    if (externalRef.trim()) body.externalRefNumber = externalRef.trim()
    if (externalRef2.trim()) body.externalRefNumber2 = externalRef2.trim()
    const ers = parseExtRefNumbers()
    if (ers) body.externalRefNumbers = ers
    postBridge('pay', body)
  }

  const onStatus = () => {
    postBridge('status', { merchant_slug: merchantSlug, origP2pRequestId: origP2pRequestId.trim() })
  }

  const onCancel = () => {
    postBridge('cancel', {
      merchant_slug: merchantSlug,
      origP2pRequestId: origP2pRequestId.trim(),
      device_serial: deviceSerial.trim() || undefined,
      device_id: deviceSerial.includes('|') ? deviceSerial.trim() : undefined,
    })
  }

  const onRefund = () => {
    postBridge('refund', {
      merchant_slug: merchantSlug,
      amount: refundAmount,
      externalRefNumber: refundExtRef.trim(),
      externalRefNumber2: refundExt2.trim() || undefined,
    })
  }

  const onVoid = () => {
    postBridge('void', { merchant_slug: merchantSlug, txnId: voidTxnId.trim() })
  }

  const slugOptions = MERCHANT_OPTIONS.filter(
    (o) => configuredSlugs.length === 0 || configuredSlugs.includes(o.value)
  )

  return (
    <div className="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left bg-gray-50 dark:bg-gray-900/40 hover:bg-gray-100 dark:hover:bg-gray-900/70 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-primary-600" />
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">POS Bridge (Ezetap)</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Push pay, status, cancel{variant === 'admin' ? ', refund, void' : ''} — credentials stay on the server
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
      </button>

      {open && (
        <div className="p-4 space-y-6 border-t border-gray-100 dark:border-gray-700">
          {loadingMeta && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading configuration…
            </div>
          )}
          {configuredSlugs.length === 0 && !loadingMeta && (
            <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
              No Ezetap credentials found. Set <code className="text-xs">EZETAP_MERCHANT_CREDENTIALS_JSON</code> or{' '}
              <code className="text-xs">EZETAP_USERNAME</code> + <code className="text-xs">EZETAP_APP_KEY</code> on the server.
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-300">Company (merchant_slug)</span>
              <select
                value={merchantSlug}
                onChange={(e) => setMerchantSlug(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
              >
                {(slugOptions.length ? slugOptions : MERCHANT_OPTIONS).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {variant === 'retailer' && machines.length > 0 && (
              <label className="block text-sm">
                <span className="text-gray-600 dark:text-gray-300">Assigned machine</span>
                <select
                  value={deviceSerial}
                  onChange={(e) => setDeviceSerial(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
                >
                  <option value="">Select serial…</option>
                  {machines.map((m) => (
                    <option key={m.serial_number} value={m.serial_number}>
                      {m.machine_id || m.serial_number} — {m.serial_number}
                      {m.tid ? ` (TID ${m.tid})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block text-sm md:col-span-2">
              <span className="text-gray-600 dark:text-gray-300">
                Device serial or full device id (e.g. <code className="text-xs">123|ezetap_android</code>)
              </span>
              <input
                value={deviceSerial}
                onChange={(e) => setDeviceSerial(e.target.value)}
                placeholder="Serial or full deviceId"
                className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm font-mono"
              />
            </label>
          </div>

          {/* Pay */}
          <section className="rounded-lg border border-gray-100 dark:border-gray-600 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Pay (push to terminal)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block text-sm">
                <span className="text-gray-600 dark:text-gray-300">Amount</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600 dark:text-gray-300">Mode</span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
                >
                  {PAY_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-gray-600 dark:text-gray-300">Customer mobile (optional)</span>
                <input
                  value={customerMobile}
                  onChange={(e) => setCustomerMobile(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-gray-600 dark:text-gray-300">externalRefNumber</span>
                <input
                  value={externalRef}
                  onChange={(e) => setExternalRef(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600 dark:text-gray-300">externalRefNumber2</span>
                <input
                  value={externalRef2}
                  onChange={(e) => setExternalRef2(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-300">externalRefNumbers (JSON array of strings, optional)</span>
              <textarea
                value={extRefNumbersJson}
                onChange={(e) => setExtRefNumbersJson(e.target.value)}
                placeholder='["{\\"isFromMepay\\\":true}","{\\"mepaySceneId\\\":4111}"]'
                rows={2}
                className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-xs font-mono"
              />
            </label>
            <button
              type="button"
              disabled={!!busy}
              onClick={onPay}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {busy === 'pay' && <Loader2 className="w-4 h-4 animate-spin" />}
              Send pay
            </button>
          </section>

          {/* Status + Cancel */}
          <section className="rounded-lg border border-gray-100 dark:border-gray-600 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Status & cancel</h3>
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-300">origP2pRequestId</span>
              <input
                value={origP2pRequestId}
                onChange={(e) => setOrigP2pRequestId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm font-mono"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={onStatus}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium hover:bg-gray-900 disabled:opacity-50"
              >
                {busy === 'status' && <Loader2 className="w-4 h-4 animate-spin" />}
                Status
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={onCancel}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {busy === 'cancel' && <Loader2 className="w-4 h-4 animate-spin" />}
                Cancel
              </button>
            </div>
          </section>

          {variant === 'admin' && (
            <>
              <section className="rounded-lg border border-gray-100 dark:border-gray-600 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Refund (2.0 API)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="block text-sm">
                    <span className="text-gray-600 dark:text-gray-300">Amount</span>
                    <input
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="text-gray-600 dark:text-gray-300">externalRefNumber</span>
                    <input
                      value={refundExtRef}
                      onChange={(e) => setRefundExtRef(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm sm:col-span-3">
                    <span className="text-gray-600 dark:text-gray-300">externalRefNumber2 (optional)</span>
                    <input
                      value={refundExt2}
                      onChange={(e) => setRefundExt2(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={onRefund}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                >
                  {busy === 'refund' && <Loader2 className="w-4 h-4 animate-spin" />}
                  Refund
                </button>
              </section>

              <section className="rounded-lg border border-gray-100 dark:border-gray-600 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Void (2.0 API)</h3>
                <label className="block text-sm">
                  <span className="text-gray-600 dark:text-gray-300">txnId</span>
                  <input
                    value={voidTxnId}
                    onChange={(e) => setVoidTxnId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm font-mono"
                  />
                </label>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={onVoid}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                >
                  {busy === 'void' && <Loader2 className="w-4 h-4 animate-spin" />}
                  Void
                </button>
              </section>
            </>
          )}

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {lastResult != null && (
            <pre className="text-xs overflow-auto max-h-64 rounded-lg bg-gray-900 text-gray-100 p-3 font-mono">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
