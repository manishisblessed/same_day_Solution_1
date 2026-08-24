'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { CreditCard, Loader2, CheckCircle2, XCircle, X, IndianRupee, Smartphone } from 'lucide-react'
import { apiFetchJson, newIdempotencyKey } from '@/lib/api-client'
import { useToast } from '@/components/Toast'

type Phase = 'idle' | 'initiating' | 'awaiting' | 'success' | 'failed'

interface StatusResult {
  isFinal?: boolean
  success?: boolean
  resultMsg?: string
  transactionId?: string
  amount?: string | number
  paymentMode?: string
  rrn?: string
  cardNumber?: string
  cardScheme?: string
  bankName?: string
  authCode?: string
}

const POLL_INTERVAL_MS = 5000
const MAX_POLL_MS = 120000

export default function ApiPaymentTab() {
  const { showToast } = useToast()
  const [amount, setAmount] = useState('')
  const [paymentMode, setPaymentMode] = useState<'Card' | 'QR'>('Card')
  const [phase, setPhase] = useState<Phase>('idle')
  const [mtxnId, setMtxnId] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [result, setResult] = useState<StatusResult | null>(null)

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollStart = useRef<number>(0)
  const stopped = useRef(false)

  const clearPoll = useCallback(() => {
    stopped.current = true
    if (pollTimer.current) {
      clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  useEffect(() => () => clearPoll(), [clearPoll])

  const poll = useCallback(
    async (txnId: string) => {
      if (stopped.current) return
      try {
        const data: StatusResult = await apiFetchJson('/api/api-payment/status', {
          method: 'POST',
          body: JSON.stringify({ merchantTransactionId: txnId }),
        })

        if (stopped.current) return

        if (data.isFinal) {
          setResult(data)
          if (data.success) {
            setPhase('success')
            setStatusMsg('Payment successful')
          } else {
            setPhase('failed')
            setStatusMsg(data.resultMsg || 'Payment failed')
          }
          return
        }
      } catch {
        // transient status error — keep polling until timeout
      }

      if (Date.now() - pollStart.current > MAX_POLL_MS) {
        setPhase('failed')
        setStatusMsg('Timed out waiting for payment. Check Transactions for the final status.')
        return
      }
      pollTimer.current = setTimeout(() => poll(txnId), POLL_INTERVAL_MS)
    },
    []
  )

  const startSale = useCallback(async () => {
    const amt = Number(amount)
    if (!amt || isNaN(amt) || amt <= 0) {
      showToast('Enter a valid amount', 'error')
      return
    }

    stopped.current = false
    setResult(null)
    setMtxnId(null)
    setPhase('initiating')
    setStatusMsg('Sending request to the terminal…')

    try {
      const data = await apiFetchJson<any>('/api/api-payment/sale', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: JSON.stringify({ amount: amt, paymentMode }),
      })

      if (!data.success) {
        setPhase('failed')
        setStatusMsg(data.resultMsg || data.error || 'Terminal did not accept the request')
        showToast(data.resultMsg || data.error || 'Request not accepted', 'error')
        return
      }

      setMtxnId(data.merchantTransactionId)
      setPhase('awaiting')
      setStatusMsg(
        paymentMode === 'Card'
          ? 'Ask the customer to tap / insert / swipe the card on the terminal…'
          : 'Ask the customer to scan the QR on the terminal…'
      )
      pollStart.current = Date.now()
      pollTimer.current = setTimeout(() => poll(data.merchantTransactionId), POLL_INTERVAL_MS)
    } catch (err: any) {
      setPhase('failed')
      setStatusMsg(err?.message || 'Failed to initiate payment')
      showToast(err?.message || 'Failed to initiate payment', 'error')
    }
  }, [amount, paymentMode, poll, showToast])

  const cancelSale = useCallback(async () => {
    if (!mtxnId) return
    clearPoll()
    setStatusMsg('Cancelling…')
    try {
      await apiFetchJson('/api/api-payment/abort', {
        method: 'POST',
        body: JSON.stringify({ merchantTransactionId: mtxnId }),
      })
    } catch {
      // best-effort; user can also cancel on the device
    }
    setPhase('failed')
    setStatusMsg('Payment cancelled')
  }, [mtxnId, clearPoll])

  const reset = useCallback(() => {
    clearPoll()
    stopped.current = false
    setPhase('idle')
    setAmount('')
    setMtxnId(null)
    setStatusMsg('')
    setResult(null)
  }, [clearPoll])

  const busy = phase === 'initiating' || phase === 'awaiting'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-xl mx-auto space-y-4"
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-base">API Payment</h2>
            <p className="text-white/80 text-xs">Collect a card / QR payment on the POS terminal</p>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Amount + mode form */}
          {(phase === 'idle' || phase === 'initiating' || phase === 'failed') && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Amount (₹)
                </label>
                <div className="relative">
                  <IndianRupee className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={busy}
                    placeholder="0.00"
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-lg font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Payment mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['Card', 'QR'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMode(m)}
                      disabled={busy}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                        paymentMode === m
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-400'
                      }`}
                    >
                      {m === 'Card' ? <CreditCard className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                      {m === 'Card' ? 'Card' : 'QR / UPI'}
                    </button>
                  ))}
                </div>
                {paymentMode === 'QR' && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                    QR / UPI must be enabled on the merchant account. Use Card if QR is not eligible.
                  </p>
                )}
              </div>

              <button
                onClick={startSale}
                disabled={busy || !amount}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {phase === 'initiating' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" /> Charge {amount ? `₹${Number(amount).toFixed(2)}` : ''}
                  </>
                )}
              </button>
            </>
          )}

          {/* Awaiting device */}
          {phase === 'awaiting' && (
            <div className="text-center py-6 space-y-4">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto" />
              <div>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  ₹{Number(amount).toFixed(2)}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{statusMsg}</p>
                {mtxnId && (
                  <p className="text-xs text-gray-400 mt-2 font-mono">Ref: {mtxnId}</p>
                )}
              </div>
              <button
                onClick={cancelSale}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          )}

          {/* Success */}
          {phase === 'success' && result && (
            <div className="text-center py-4 space-y-4">
              <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
              <div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">Payment Successful</p>
                <p className="text-2xl font-bold text-green-600 mt-1">
                  ₹{Number(amount).toFixed(2)}
                </p>
              </div>
              <div className="text-left bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-sm space-y-1.5">
                <Row label="Transaction ID" value={result.transactionId} />
                <Row label="RRN" value={result.rrn} />
                <Row label="Card" value={result.cardNumber} />
                <Row label="Scheme" value={result.cardScheme} />
                <Row label="Bank" value={result.bankName} />
                <Row label="Auth Code" value={result.authCode} />
              </div>
              <button
                onClick={reset}
                className="w-full py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700"
              >
                New Payment
              </button>
            </div>
          )}

          {/* Failed / cancelled / timeout */}
          {phase === 'failed' && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700 dark:text-red-300">{statusMsg}</div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-900 dark:text-white font-medium text-right break-all">{value}</span>
    </div>
  )
}
