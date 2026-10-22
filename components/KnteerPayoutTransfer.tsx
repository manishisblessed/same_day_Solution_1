'use client'

/**
 * KnteerPayoutTransfer — Settlement-1 UI powered by Knteer Solution API.
 *
 * Visual design matches ShadvalPayTransfer (Settlement-2) exactly.
 * No "Knteer" branding is exposed to users — the label stays "Settlement-1".
 *
 * Flow differences vs Settlement-2:
 *   - No saved beneficiary accounts (Knteer handles add-bene server-side)
 *   - No penny-drop verification step
 *   - Bank name is a free-text input (no dropdown)
 *   - Transfer mode is always IMPS
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { apiFetch, newIdempotencyKey } from '@/lib/api-client'
import { motion, AnimatePresence } from 'framer-motion'
import {
  RefreshCw, AlertCircle, AlertTriangle, Check,
  Building2, User, Hash, IndianRupee, Zap, Clock,
  ArrowRight, CheckCircle2, XCircle, Loader2,
  Wallet, Send, Search, Copy, ArrowLeft,
  CreditCard, ChevronRight,
  Download, MessageCircle, Printer, Eye, EyeOff,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface TransactionRecord {
  id: string
  client_ref_id: string       // = partner_trans_id
  provider_txn_id?: string    // = knteer_trans_id
  rrn?: string                // = utr
  amount: number
  charges: number
  transfer_mode: string
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'PROCESSING'
  status_message?: string
  failure_reason?: string
  account_number: string
  account_holder_name: string
  bank_name?: string
  created_at: string
  completed_at?: string
}

interface KnteerPayoutTransferProps {
  title?: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function KnteerPayoutTransfer({ title }: KnteerPayoutTransferProps) {
  const { user } = useAuth()

  // Service status
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null)
  const [loadingService, setLoadingService] = useState(true)

  // Main view
  const [activeView, setActiveView] = useState<'home' | 'process-settlement' | 'history'>('home')

  // Settlement step
  const [settlementStep, setSettlementStep] = useState<'enter-details' | 'confirm' | 'result'>('enter-details')

  // Form — bank details
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('')
  const [ifscCode, setIfscCode] = useState('')
  const [accountHolderName, setAccountHolderName] = useState('')
  const [beneficiaryMobile, setBeneficiaryMobile] = useState('')

  // Form — transfer
  const [amount, setAmount] = useState('')
  const [narration, setNarration] = useState('')
  const [tpin, setTpin] = useState('')
  const [showTpin, setShowTpin] = useState(false)

  // Sender (auto-filled from profile)
  const [senderName, setSenderName] = useState('')
  const [senderMobile, setSenderMobile] = useState('')
  const [senderEmail, setSenderEmail] = useState('')

  // Transfer state
  const [transferring, setTransferring] = useState(false)
  const idemKeyRef = useRef<string | null>(null)
  const [transferResult, setTransferResult] = useState<TransactionRecord | null>(null)

  // Charges
  const [charges, setCharges] = useState<number>(0)
  const [loadingCharges, setLoadingCharges] = useState(false)
  const [schemeMessage, setSchemeMessage] = useState<string | null>(null)

  // Transactions history
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [checkingStatusId, setCheckingStatusId] = useState<string | null>(null)

  // Error
  const [error, setError] = useState<string | null>(null)

  const amountNum = parseFloat(amount) || 0
  const totalDebit = amountNum + charges

  // ── Service status ──────────────────────────────────────────────────────────

  const fetchServiceStatus = useCallback(async () => {
    setLoadingService(true)
    try {
      const res = await apiFetch('/api/knteer-payout/balance')
      const data = await res.json()
      setServiceAvailable(data.success)
    } catch {
      setServiceAvailable(false)
    } finally {
      setLoadingService(false)
    }
  }, [])

  // ── Charges (debounced) ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!amountNum || amountNum <= 0 || settlementStep !== 'enter-details') return
    const timer = setTimeout(async () => {
      setLoadingCharges(true)
      try {
        const res = await apiFetch(
          `/api/schemes/resolve-charges?service_type=payout&amount=${amountNum}&transfer_mode=IMPS&user_id=${user?.partner_id}`
        )
        const data = await res.json()
        if (data.resolved && data.charge_available !== false && parseFloat(data.charges?.retailer_charge) > 0) {
          setCharges(parseFloat(data.charges.retailer_charge))
          setSchemeMessage(null)
        } else if (data.scheme_assigned === false) {
          setCharges(0)
          setSchemeMessage(data?.message || 'Scheme not assigned. Please contact support.')
        } else {
          setCharges(0)
          setSchemeMessage(data?.error || data?.message || 'Unable to load charges. Please try again.')
        }
      } catch {
        setCharges(0)
      } finally {
        setLoadingCharges(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [amountNum, settlementStep, user?.partner_id])

  // ── Transactions ────────────────────────────────────────────────────────────

  const fetchTransactions = useCallback(async () => {
    setLoadingTransactions(true)
    try {
      const res = await apiFetch('/api/knteer-payout/status?list=true')
      const data = await res.json()
      if (data.success) setTransactions(data.transactions || [])
    } catch { /* silent */ }
    finally { setLoadingTransactions(false) }
  }, [])

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchServiceStatus()
    fetchTransactions()
  }, [fetchServiceStatus, fetchTransactions])

  // Auto-fill sender from profile
  useEffect(() => {
    if (!user) return
    setSenderName(user.name || '')
    setSenderEmail(user.email || '')
    setSenderMobile((user as any).phone || '')
  }, [user])

  // ── Poll single result transaction ──────────────────────────────────────────

  const pollTransactionStatus = useCallback(async (txId: string) => {
    try {
      const res = await apiFetch(`/api/knteer-payout/status?transactionId=${txId}`)
      const data = await res.json()
      if (data.success && data.transaction) {
        setTransferResult(prev =>
          prev
            ? {
                ...prev,
                status: data.transaction.status,
                rrn: data.transaction.rrn || prev.rrn,
                provider_txn_id: data.transaction.provider_txn_id || prev.provider_txn_id,
                failure_reason: data.transaction.failure_reason,
                completed_at: data.transaction.completed_at,
              }
            : null
        )
        return data.transaction.status as string
      }
    } catch { /* silent */ }
    return null
  }, [])

  // Auto-poll while PENDING
  useEffect(() => {
    if (settlementStep !== 'result' || !transferResult?.id) return
    const s = transferResult.status?.toUpperCase()
    if (!['PENDING', 'PROCESSING'].includes(s)) return
    let count = 0
    const initial = setTimeout(async () => {
      const done = await pollTransactionStatus(transferResult.id)
      if (done && ['SUCCESS', 'FAILED', 'REFUNDED'].includes(String(done).toUpperCase())) {
        fetchTransactions()
        return
      }
      const interval = setInterval(async () => {
        count++
        const status = await pollTransactionStatus(transferResult.id)
        if (count >= 30 || (status && ['SUCCESS', 'FAILED', 'REFUNDED'].includes(String(status).toUpperCase()))) {
          clearInterval(interval)
          fetchTransactions()
        }
      }, 10000)
    }, 3000)
    return () => clearTimeout(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlementStep, transferResult?.id])

  // ── Check status for history row ────────────────────────────────────────────

  const handleCheckStatus = useCallback(async (txId: string) => {
    setCheckingStatusId(txId)
    try {
      const res = await apiFetch(`/api/knteer-payout/status?transactionId=${txId}`)
      const data = await res.json()
      if (data.success && data.transaction) {
        setTransactions(prev =>
          prev.map(tx =>
            tx.id === txId
              ? {
                  ...tx,
                  status: data.transaction.status,
                  rrn: data.transaction.rrn || tx.rrn,
                  failure_reason: data.transaction.failure_reason,
                }
              : tx
          )
        )
      }
    } catch { /* silent */ }
    finally { setCheckingStatusId(null) }
  }, [])

  // ── Handle process settlement ───────────────────────────────────────────────

  const handleProcessSettlement = () => {
    setActiveView('process-settlement')
    setSettlementStep('enter-details')
    setAmount('')
    setCharges(0)
    setSchemeMessage(null)
    setTransferResult(null)
    setError(null)
  }

  // ── Validation → confirm ────────────────────────────────────────────────────

  const handleProceedToConfirm = () => {
    if (!bankName || bankName.trim().length < 2) return setError('Please enter the bank name')
    if (!accountNumber || accountNumber.length < 9) return setError('Enter a valid account number (min 9 digits)')
    if (accountNumber !== confirmAccountNumber) return setError('Account numbers do not match')
    if (!ifscCode || !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifscCode)) return setError('Enter a valid IFSC code (e.g. SBIN0001234)')
    if (!accountHolderName || accountHolderName.trim().length < 2) return setError('Enter the account holder name')
    if (!beneficiaryMobile || !/^[6-9]\d{9}$/.test(beneficiaryMobile)) return setError('Enter a valid 10-digit beneficiary mobile number')
    if (!amountNum || amountNum < 100) return setError('Minimum transfer amount is ₹100')
    if (amountNum > 200000) return setError('Maximum transfer amount is ₹2,00,000')
    if (schemeMessage) return setError(schemeMessage)
    if (!senderName || senderName.trim().length < 2) return setError('Please fill in your Sender Name')
    if (!senderMobile || !/^[6-9]\d{9}$/.test(senderMobile)) return setError('Please fill in a valid 10-digit Sender Mobile')
    setError(null)
    setSettlementStep('confirm')
  }

  // ── Execute transfer ────────────────────────────────────────────────────────

  const handleExecuteTransfer = async () => {
    if (!tpin || tpin.length !== 4) {
      setError('Enter your 4-digit TPIN to authorize this transfer')
      return
    }
    setError(null)
    setTransferring(true)
    if (!idemKeyRef.current) idemKeyRef.current = newIdempotencyKey()

    try {
      const res = await apiFetch('/api/knteer-payout/transfer', {
        method: 'POST',
        idempotencyKey: idemKeyRef.current,
        body: JSON.stringify({
          accountNumber,
          ifscCode: ifscCode.toUpperCase(),
          accountHolderName,
          bankName,
          amount: amountNum,
          paymentMode: 'IMPS',
          mobile: beneficiaryMobile,
          email: senderEmail || '',
          senderName,
          senderMobile,
          remarks: narration || '',
          tpin,
        }),
      })
      const data = await res.json()

      if (data.success) {
        idemKeyRef.current = null
        setTpin('')
        const tx: TransactionRecord = {
          id: data.transaction_id || '',
          client_ref_id: data.partner_trans_id || '',
          provider_txn_id: data.knteer_trans_id,
          rrn: data.utr,
          status: data.status || 'PENDING',
          amount: data.amount || amountNum,
          charges: data.charges || charges,
          transfer_mode: data.payment_mode || 'IMPS',
          account_number: data.account_number || accountNumber,
          account_holder_name: data.account_holder_name || accountHolderName,
          bank_name: data.bank_name || bankName,
          created_at: new Date().toISOString(),
        }
        setTransferResult(tx)
        setTransactions(prev => [tx, ...prev])
        setSettlementStep('result')
      } else {
        setError(data.error || 'Transfer failed')
      }
    } catch (err: any) {
      const msg = err.message || 'Network error'
      if (msg.includes('504') || msg.includes('timeout') || msg.includes('Gateway Time')) {
        setError(
          'Request timed out. This does not mean the transfer failed — check transaction history in 2–3 minutes before retrying.'
        )
      } else {
        setError(msg)
      }
    } finally {
      setTransferring(false)
    }
  }

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text)

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {title || 'Settlement-1 - Bank Transfer'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Send money to any bank account via IMPS
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800">
            <Wallet className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {loadingService ? (
                <Loader2 className="w-3 h-3 animate-spin inline" />
              ) : serviceAvailable ? (
                <span className="text-emerald-600">Service Active</span>
              ) : (
                <span className="text-red-500">Service Unavailable</span>
              )}
            </span>
            <button
              onClick={fetchServiceStatus}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
            >
              <RefreshCw className="w-3 h-3 text-gray-400" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Error Banner ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-2"
          >
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-300 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <XCircle className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── HOME VIEW ──────────────────────────────────────────────────────── */}
      {activeView === 'home' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Card 1: Process Settlement */}
            <motion.button
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleProcessSettlement}
              className="group text-left relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-2xl hover:shadow-blue-500/10 transition-all p-6 overflow-hidden"
            >
              <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-gradient-to-br from-blue-400/20 to-cyan-400/20 blur-2xl group-hover:scale-150 transition-transform duration-700" />
              <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="w-5 h-5 text-blue-500" />
              </div>
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:rotate-3 transition-all shadow-lg shadow-blue-500/30">
                  <Send className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Process Settlement</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Send money instantly to any bank account via IMPS
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                    <Zap className="w-3 h-3" />
                    IMPS Instant
                  </span>
                  <span className="text-xs text-gray-400">24×7 available</span>
                </div>
              </div>
            </motion.button>

            {/* Card 2: Transaction History */}
            <motion.button
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => { setActiveView('history'); fetchTransactions() }}
              className="group text-left relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-2xl hover:shadow-emerald-500/10 transition-all p-6 overflow-hidden"
            >
              <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-gradient-to-br from-emerald-400/20 to-teal-400/20 blur-2xl group-hover:scale-150 transition-transform duration-700" />
              <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="w-5 h-5 text-emerald-500" />
              </div>
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:rotate-3 transition-all shadow-lg shadow-emerald-500/30">
                  <Clock className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Transaction History</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  View your recent settlements and check status
                </p>
                {transactions.length > 0 ? (
                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    {transactions.filter(t => t.status === 'SUCCESS').length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                        <CheckCircle2 className="w-3 h-3" />
                        {transactions.filter(t => t.status === 'SUCCESS').length} successful
                      </span>
                    )}
                    {transactions.filter(t => ['PENDING', 'PROCESSING'].includes(t.status)).length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                        <Clock className="w-3 h-3" />
                        {transactions.filter(t => ['PENDING', 'PROCESSING'].includes(t.status)).length} pending
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs">
                    No transactions yet
                  </div>
                )}
              </div>
            </motion.button>
          </div>

          {/* Recent transactions preview on home */}
          {transactions.length > 0 && (
            <div className="mt-6 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  Recent Transactions
                </h3>
                <button
                  onClick={fetchTransactions}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                >
                  <RefreshCw className={`w-4 h-4 text-gray-400 ${loadingTransactions ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {transactions.slice(0, 5).map(tx => (
                  <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        tx.status === 'SUCCESS'
                          ? 'bg-emerald-50 dark:bg-emerald-900/20'
                          : tx.status === 'FAILED'
                          ? 'bg-red-50 dark:bg-red-900/20'
                          : 'bg-amber-50 dark:bg-amber-900/20'
                      }`}>
                        {tx.status === 'SUCCESS'
                          ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          : tx.status === 'FAILED'
                          ? <XCircle className="w-5 h-5 text-red-600" />
                          : <Clock className="w-5 h-5 text-amber-600" />}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white text-sm">{tx.account_holder_name}</p>
                        <p className="text-xs text-gray-500 font-mono">{tx.account_number}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900 dark:text-white">
                        ₹{Number(tx.amount).toLocaleString('en-IN')}
                      </p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        tx.status === 'SUCCESS'
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                          : tx.status === 'FAILED'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      }`}>
                        {tx.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {transactions.length > 5 && (
                <div className="p-3 text-center border-t border-gray-100 dark:border-gray-800">
                  <button
                    onClick={() => { setActiveView('history'); fetchTransactions() }}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 mx-auto"
                  >
                    View all {transactions.length} transactions <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* ─── PROCESS SETTLEMENT VIEW ────────────────────────────────────────── */}
      {activeView === 'process-settlement' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <button
            onClick={() => { setActiveView('home'); setError(null) }}
            className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          {/* ── Step: Enter Details ── */}
          {settlementStep === 'enter-details' && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  Bank Account Details
                </h3>
                <p className="text-xs text-gray-500 mt-1">Enter the beneficiary's bank details to process settlement</p>
              </div>
              <div className="p-5 space-y-4">

                {/* Bank Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bank Name *</label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={bankName}
                      onChange={e => setBankName(e.target.value)}
                      placeholder="e.g., State Bank of India"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                {/* Account Number */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Number *</label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={accountNumber}
                        onChange={e => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                        placeholder="Enter account number"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        maxLength={18}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm Account Number *</label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={confirmAccountNumber}
                        onChange={e => setConfirmAccountNumber(e.target.value.replace(/\D/g, ''))}
                        placeholder="Re-enter account number"
                        className={`w-full pl-10 pr-4 py-2.5 rounded-xl border ${
                          confirmAccountNumber && confirmAccountNumber !== accountNumber
                            ? 'border-red-400 focus:ring-red-500'
                            : confirmAccountNumber && confirmAccountNumber === accountNumber
                            ? 'border-green-400 focus:ring-green-500'
                            : 'border-gray-300 dark:border-gray-700'
                        } bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:border-transparent transition-all`}
                        maxLength={18}
                      />
                      {confirmAccountNumber && confirmAccountNumber === accountNumber && (
                        <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
                      )}
                    </div>
                  </div>
                </div>

                {/* IFSC + Name */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">IFSC Code *</label>
                    <div className="relative">
                      <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={ifscCode}
                        onChange={e => setIfscCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                        placeholder="e.g. SBIN0001234"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        maxLength={11}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Holder Name *</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={accountHolderName}
                        onChange={e => setAccountHolderName(e.target.value)}
                        placeholder="As per bank records"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* Beneficiary Mobile */}
                <div className="max-w-xs">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Beneficiary Mobile *</label>
                  <input
                    type="tel"
                    value={beneficiaryMobile}
                    onChange={e => setBeneficiaryMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile number"
                    className={`w-full px-4 py-2.5 rounded-xl border ${
                      beneficiaryMobile && beneficiaryMobile.length === 10
                        ? 'border-green-400 focus:ring-green-500'
                        : beneficiaryMobile && beneficiaryMobile.length > 0 && beneficiaryMobile.length < 10
                        ? 'border-amber-400 focus:ring-amber-500'
                        : 'border-gray-300 dark:border-gray-700'
                    } bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:border-transparent transition-all`}
                  />
                  {beneficiaryMobile && beneficiaryMobile.length > 0 && beneficiaryMobile.length < 10 && (
                    <p className="text-xs text-amber-600 mt-1">Enter complete 10-digit mobile number</p>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (INR) *</label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="number"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.00"
                      min="100"
                      step="0.01"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                {/* Transfer Mode — fixed IMPS */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Transfer Mode</label>
                  <div className="flex gap-2">
                    <div className="px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-600 text-white shadow-md flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" /> IMPS (Instant)
                    </div>
                  </div>
                </div>

                {/* Narration */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Narration (Optional)</label>
                  <input
                    type="text"
                    value={narration}
                    onChange={e => setNarration(e.target.value)}
                    placeholder="Optional remarks"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    maxLength={50}
                  />
                </div>

                {/* Sender Details */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
                  <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-400 mb-3 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Sender Details (Your Information)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Sender Name *</label>
                      <input
                        type="text"
                        value={senderName}
                        onChange={e => setSenderName(e.target.value)}
                        placeholder="Your name"
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Sender Mobile *</label>
                      <input
                        type="tel"
                        value={senderMobile}
                        onChange={e => setSenderMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="10-digit mobile"
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Sender Email (Optional)</label>
                      <input
                        type="email"
                        value={senderEmail}
                        onChange={e => setSenderEmail(e.target.value)}
                        placeholder="Email address"
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* Scheme warning */}
                {amountNum > 0 && schemeMessage && !loadingCharges && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm font-medium text-red-700 dark:text-red-300">
                    {schemeMessage}
                  </div>
                )}

                {/* Charges Preview */}
                {amountNum > 0 && !schemeMessage && (
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Transfer Amount</span>
                      <span className="font-medium text-gray-900 dark:text-white">₹{amountNum.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">
                        Charges (IMPS) {loadingCharges && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white">₹{charges.toFixed(2)}</span>
                    </div>
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-1 flex justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-300 font-medium">Total Wallet Debit</span>
                      <span className="font-bold text-blue-600">₹{totalDebit.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {/* Important notice */}
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      <strong>Verify all details carefully.</strong> Transfers to wrong accounts cannot be reversed.
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleProceedToConfirm}
                  disabled={!amountNum || amountNum < 100 || loadingCharges || !!schemeMessage}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  Review & Confirm
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step: Confirm ── */}
          {settlementStep === 'confirm' && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-blue-600" />
                  Confirm Settlement
                </h3>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Beneficiary</p>
                    <p className="font-medium text-gray-900 dark:text-white">{accountHolderName}</p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Bank</p>
                    <p className="font-medium text-gray-900 dark:text-white">{bankName}</p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Account Number</p>
                    <p className="font-mono text-xs font-medium text-gray-900 dark:text-white">{accountNumber}</p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">IFSC</p>
                    <p className="font-mono font-medium text-gray-900 dark:text-white">{ifscCode}</p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Mode</p>
                    <p className="font-medium text-gray-900 dark:text-white">IMPS (Instant)</p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Beneficiary Mobile</p>
                    <p className="font-medium text-gray-900 dark:text-white">{beneficiaryMobile}</p>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl col-span-2">
                    <p className="text-blue-600 dark:text-blue-400 text-xs mb-1">Settlement Amount</p>
                    <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                      <IndianRupee className="w-5 h-5 inline" />{amountNum.toFixed(2)}
                    </p>
                  </div>
                  {charges > 0 && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl col-span-2">
                      <p className="text-amber-600 dark:text-amber-400 text-xs mb-1">Charges (Wallet Debit)</p>
                      <p className="text-lg font-bold text-amber-700 dark:text-amber-300">
                        ₹{charges.toFixed(2)}
                        <span className="text-sm font-normal text-gray-500 ml-2">Total: ₹{totalDebit.toFixed(2)}</span>
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Transaction PIN (TPIN)
                  </label>
                  <div className="relative">
                    <input
                      type={showTpin ? 'text' : 'password'}
                      inputMode="numeric"
                      autoComplete="off"
                      value={tpin}
                      onChange={e => setTpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="Enter 4-digit TPIN"
                      maxLength={4}
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white tracking-[0.5em] text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTpin(!showTpin)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showTpin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    TPIN is required to authorize every settlement. Set it under Settings if you haven't.
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => { setSettlementStep('enter-details'); setTpin('') }}
                    disabled={transferring}
                    className="flex-1 py-3 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleExecuteTransfer}
                    disabled={transferring || tpin.length !== 4}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium shadow-md hover:shadow-lg disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                  >
                    {transferring ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                    ) : (
                      <><Send className="w-4 h-4" /> Confirm &amp; Send</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step: Result — Professional Receipt ── */}
          {settlementStep === 'result' && transferResult && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden"
            >
              {/* Receipt Header */}
              <div className={`p-6 text-center ${
                transferResult.status === 'SUCCESS'
                  ? 'bg-gradient-to-br from-emerald-500 to-emerald-700'
                  : transferResult.status === 'FAILED'
                  ? 'bg-gradient-to-br from-red-500 to-red-700'
                  : 'bg-gradient-to-br from-amber-500 to-amber-700'
              }`}>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 12, delay: 0.1 }}
                  className="w-16 h-16 mx-auto rounded-full bg-white/20 backdrop-blur flex items-center justify-center mb-3"
                >
                  {transferResult.status === 'SUCCESS' ? (
                    <CheckCircle2 className="w-9 h-9 text-white" />
                  ) : transferResult.status === 'FAILED' ? (
                    <XCircle className="w-9 h-9 text-white" />
                  ) : (
                    <Clock className="w-9 h-9 text-white" />
                  )}
                </motion.div>
                <h3 className="text-xl font-bold text-white">
                  {transferResult.status === 'SUCCESS'
                    ? 'Transfer Successful'
                    : transferResult.status === 'FAILED'
                    ? 'Transfer Failed'
                    : 'Transfer Processing'}
                </h3>
                <p className="text-white/80 text-sm mt-1">
                  {transferResult.status_message ||
                    (transferResult.status === 'SUCCESS'
                      ? 'Amount credited to beneficiary'
                      : transferResult.status === 'FAILED'
                      ? 'Amount will be refunded to wallet'
                      : 'Your transfer is being processed')}
                </p>
                <p className="text-3xl font-bold text-white mt-3">
                  ₹{Number(transferResult.amount).toFixed(2)}
                </p>
              </div>

              {/* Receipt Body */}
              <div className="p-5">
                <div className="border-t-2 border-dashed border-gray-200 dark:border-gray-700 mb-5 -mt-1" />

                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Beneficiary</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white text-right max-w-[60%] truncate">
                      {transferResult.account_holder_name}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Account No.</span>
                    <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                      {transferResult.account_number}
                    </span>
                  </div>
                  {transferResult.bank_name && (
                    <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Bank</span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {transferResult.bank_name}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Transfer Mode</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{transferResult.transfer_mode}</span>
                  </div>
                  {transferResult.rrn && (
                    <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm text-gray-500 dark:text-gray-400">UTR Number</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-medium text-emerald-700 dark:text-emerald-400">
                          {transferResult.rrn}
                        </span>
                        <button
                          onClick={() => copyToClipboard(transferResult.rrn!)}
                          className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        >
                          <Copy className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  )}
                  {transferResult.provider_txn_id && (
                    <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Provider Txn ID</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-medium text-gray-900 dark:text-white">
                          {transferResult.provider_txn_id}
                        </span>
                        <button
                          onClick={() => copyToClipboard(transferResult.provider_txn_id!)}
                          className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        >
                          <Copy className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Reference ID</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono font-medium text-gray-900 dark:text-white">
                        {transferResult.client_ref_id}
                      </span>
                      <button
                        onClick={() => copyToClipboard(transferResult.client_ref_id)}
                        className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                      >
                        <Copy className="w-3 h-3 text-gray-400" />
                      </button>
                    </div>
                  </div>
                  {transferResult.charges > 0 && (
                    <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Charges</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        ₹{Number(transferResult.charges).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {transferResult.failure_reason && transferResult.status === 'FAILED' && (
                    <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Failure Reason</span>
                      <span className="text-sm text-red-600 dark:text-red-400 max-w-[60%] text-right">
                        {transferResult.failure_reason}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Date &amp; Time</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {new Date(transferResult.created_at || Date.now()).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: true,
                      })}
                    </span>
                  </div>
                </div>

                <div className="border-t-2 border-dashed border-gray-200 dark:border-gray-700 my-5" />

                {/* Share Options */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Share Receipt</p>
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      onClick={() => {
                        const t = `*Settlement-1 Receipt*%0A%0AStatus: ${transferResult.status}%0AAmount: ₹${Number(transferResult.amount).toFixed(2)}%0ABeneficiary: ${transferResult.account_holder_name}%0AAccount: ${transferResult.account_number}%0AMode: ${transferResult.transfer_mode}%0A${transferResult.rrn ? `UTR: ${transferResult.rrn}%0A` : ''}Reference: ${transferResult.client_ref_id}%0ACharges: ₹${Number(transferResult.charges).toFixed(2)}%0ADate: ${new Date(transferResult.created_at).toLocaleString('en-IN')}`
                        window.open(`https://wa.me/?text=${t}`, '_blank')
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                    >
                      <MessageCircle className="w-5 h-5 text-green-600" />
                      <span className="text-[10px] font-medium text-green-700 dark:text-green-400">WhatsApp</span>
                    </button>
                    <button
                      onClick={() => {
                        const t = `Settlement-1 Receipt\n\nStatus: ${transferResult.status}\nAmount: ₹${Number(transferResult.amount).toFixed(2)}\nBeneficiary: ${transferResult.account_holder_name}\nAccount: ${transferResult.account_number}\nMode: ${transferResult.transfer_mode}\n${transferResult.rrn ? `UTR: ${transferResult.rrn}\n` : ''}Reference: ${transferResult.client_ref_id}\nCharges: ₹${Number(transferResult.charges).toFixed(2)}\nDate: ${new Date(transferResult.created_at).toLocaleString('en-IN')}`
                        navigator.clipboard.writeText(t)
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                    >
                      <Copy className="w-5 h-5 text-blue-600" />
                      <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">Copy</span>
                    </button>
                    <button
                      onClick={() => {
                        const t = `Settlement-1 Receipt\n${'─'.repeat(35)}\nStatus: ${transferResult.status}\nAmount: ₹${Number(transferResult.amount).toFixed(2)}\nBeneficiary: ${transferResult.account_holder_name}\nAccount: ${transferResult.account_number}\nMode: ${transferResult.transfer_mode}\n${transferResult.rrn ? `UTR: ${transferResult.rrn}\n` : ''}${transferResult.provider_txn_id ? `Provider ID: ${transferResult.provider_txn_id}\n` : ''}Reference: ${transferResult.client_ref_id}\nCharges: ₹${Number(transferResult.charges).toFixed(2)}\nDate: ${new Date(transferResult.created_at).toLocaleString('en-IN')}\n${'─'.repeat(35)}\nSame Day Solution`
                        const blob = new Blob([t], { type: 'text/plain' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `receipt_${transferResult.client_ref_id}.txt`
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
                    >
                      <Download className="w-5 h-5 text-purple-600" />
                      <span className="text-[10px] font-medium text-purple-700 dark:text-purple-400">Download</span>
                    </button>
                    <button
                      onClick={() => {
                        const pw = window.open('', '_blank')
                        if (!pw) return
                        pw.document.write(`<html><head><title>Receipt - ${transferResult.client_ref_id}</title><style>body{font-family:'Segoe UI',sans-serif;max-width:400px;margin:20px auto;padding:20px}.header{text-align:center;padding:20px;border-radius:12px;color:white;background:${transferResult.status==='SUCCESS'?'#059669':transferResult.status==='FAILED'?'#dc2626':'#d97706'}}.amount{font-size:28px;font-weight:bold;margin-top:10px}.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f3f4f6}.label{color:#6b7280;font-size:14px}.value{font-weight:600;font-size:14px}.divider{border-top:2px dashed #e5e7eb;margin:16px 0}.footer{text-align:center;color:#9ca3af;font-size:12px;margin-top:20px}</style></head><body><div class="header"><div style="font-size:18px;font-weight:bold">${transferResult.status==='SUCCESS'?'Transfer Successful':transferResult.status==='FAILED'?'Transfer Failed':'Transfer Processing'}</div><div class="amount">₹${Number(transferResult.amount).toFixed(2)}</div></div><div class="divider"></div><div class="row"><span class="label">Beneficiary</span><span class="value">${transferResult.account_holder_name}</span></div><div class="row"><span class="label">Account</span><span class="value">${transferResult.account_number}</span></div><div class="row"><span class="label">Mode</span><span class="value">${transferResult.transfer_mode}</span></div>${transferResult.rrn?`<div class="row"><span class="label">UTR</span><span class="value">${transferResult.rrn}</span></div>`:''}<div class="row"><span class="label">Reference</span><span class="value">${transferResult.client_ref_id}</span></div><div class="row"><span class="label">Charges</span><span class="value">₹${Number(transferResult.charges).toFixed(2)}</span></div><div class="row"><span class="label">Date</span><span class="value">${new Date(transferResult.created_at).toLocaleString('en-IN')}</span></div><div class="divider"></div><div class="footer">Same Day Solution - Settlement-1 Receipt</div></body></html>`)
                        pw.document.close()
                        pw.print()
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Printer className="w-5 h-5 text-gray-600" />
                      <span className="text-[10px] font-medium text-gray-700 dark:text-gray-400">Print</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-5 pt-0 flex gap-3">
                <button
                  onClick={() => { setActiveView('home'); setError(null) }}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium shadow-md hover:shadow-lg transition-all"
                >
                  Done
                </button>
                {['PENDING', 'PROCESSING'].includes(transferResult.status) && (
                  <button
                    onClick={() => pollTransactionStatus(transferResult.id)}
                    className="flex-1 py-3 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-all flex items-center justify-center gap-2"
                  >
                    <Search className="w-4 h-4" />
                    Check Status
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* ─── HISTORY VIEW ───────────────────────────────────────────────────── */}
      {activeView === 'history' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <button
            onClick={() => setActiveView('home')}
            className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          {transactions.length > 0 ? (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  Recent Settlements
                </h3>
                <button
                  onClick={fetchTransactions}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                >
                  <RefreshCw className={`w-4 h-4 text-gray-400 ${loadingTransactions ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Reference</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Beneficiary</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium">Amount</th>
                      <th className="text-center px-4 py-3 text-gray-500 font-medium">Status</th>
                      <th className="text-center px-4 py-3 text-gray-500 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx, idx) => (
                      <tr
                        key={`${tx.id}-${idx}`}
                        className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30"
                      >
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-gray-900 dark:text-white">{tx.client_ref_id}</p>
                          {tx.rrn && <p className="text-xs text-gray-500">UTR: {tx.rrn}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-900 dark:text-white text-xs">{tx.account_holder_name}</p>
                          <p className="text-xs text-gray-500 font-mono">{tx.account_number}</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-medium text-gray-900 dark:text-white">
                            ₹{Number(tx.amount).toFixed(2)}
                          </p>
                          {tx.charges > 0 && (
                            <p className="text-xs text-gray-500">+₹{Number(tx.charges).toFixed(2)}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            tx.status === 'SUCCESS'
                              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                              : tx.status === 'FAILED'
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                              : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          }`}>
                            {tx.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleCheckStatus(tx.id)}
                            disabled={checkingStatusId === tx.id}
                            className="px-3 py-1 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 hover:bg-blue-100 transition-all flex items-center gap-1 mx-auto disabled:opacity-50"
                          >
                            {checkingStatusId === tx.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <RefreshCw className="w-3 h-3" />}
                            Refresh
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No transactions yet</p>
              <p className="text-sm mt-1">Process a settlement to see it here</p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
