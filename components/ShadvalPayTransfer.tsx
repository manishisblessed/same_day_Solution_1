'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { apiFetch, newIdempotencyKey } from '@/lib/api-client'
import { motion, AnimatePresence } from 'framer-motion'
import {
  RefreshCw, AlertCircle, AlertTriangle, Check,
  Building2, User, Hash, IndianRupee, Zap, Clock,
  ArrowRight, CheckCircle2, XCircle, Loader2,
  Wallet, Send, Search, Copy, ArrowLeft,
  Plus, CreditCard, Trash2, ShieldCheck, BadgeCheck,
  Sparkles, Star, TrendingUp, ChevronRight, Banknote,
  Download, Share2, MessageCircle, Printer,
} from 'lucide-react'

interface VerifiedAccount {
  id: string
  account_number: string
  ifsc_code: string
  account_holder_name: string
  verified_name: string | null
  is_verified: boolean
  verification_status: string
  created_at: string
}

interface TransactionRecord {
  id: string
  reference_id: string
  order_id?: string
  utr?: string
  amount: number
  charges: number
  mode: string
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  status_message?: string
  account_number: string
  account_holder_name: string
  provider_timestamp?: string
}

interface ShadvalPayTransferProps {
  title?: string
}

export default function ShadvalPayTransfer({ title }: ShadvalPayTransferProps) {
  const { user } = useAuth()

  // Service status
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null)
  const [loadingService, setLoadingService] = useState(true)

  // Main view: 'home' | 'process-settlement' | 'add-account' | 'history'
  const [activeView, setActiveView] = useState<'home' | 'process-settlement' | 'add-account' | 'history'>('home')

  // Accounts
  const [accounts, setAccounts] = useState<VerifiedAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  // Process settlement state
  const [selectedAccount, setSelectedAccount] = useState<VerifiedAccount | null>(null)
  const [amount, setAmount] = useState('')
  const [transferMode, setTransferMode] = useState<'IMPS' | 'NEFT' | 'RTGS'>('IMPS')
  const [narration, setNarration] = useState('')
  const [charges, setCharges] = useState<number>(0)
  const [loadingCharges, setLoadingCharges] = useState(false)
  const [settlementStep, setSettlementStep] = useState<'select-account' | 'enter-amount' | 'confirm' | 'result'>('select-account')
  const [transferring, setTransferring] = useState(false)
  // Stable idempotency key for the in-progress settlement (cleared on success)
  const settlementIdemRef = useRef<string | null>(null)
  const [transferResult, setTransferResult] = useState<TransactionRecord | null>(null)

  // Add account state
  const [newAccNumber, setNewAccNumber] = useState('')
  const [newConfirmAcc, setNewConfirmAcc] = useState('')
  const [newIfsc, setNewIfsc] = useState('')
  const [newBeneName, setNewBeneName] = useState('')
  const [newContactMobile, setNewContactMobile] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<any>(null)
  const [showCelebration, setShowCelebration] = useState(false)
  const [celebrationCountdown, setCelebrationCountdown] = useState(3)

  // Transaction history
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])

  // Modal for no accounts
  const [showNoAccountModal, setShowNoAccountModal] = useState(false)

  // General
  const [error, setError] = useState<string | null>(null)

  // Fetch service status
  const fetchServiceStatus = useCallback(async () => {
    setLoadingService(true)
    try {
      const res = await apiFetch('/api/shadval-pay/balance')
      const data = await res.json()
      setServiceAvailable(data.success && data.payout_available)
    } catch {
      setServiceAvailable(false)
    } finally {
      setLoadingService(false)
    }
  }, [])

  // Fetch verified accounts
  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const res = await apiFetch('/api/settlement-2/accounts')
      const data = await res.json()
      if (data.success) {
        setAccounts((data.accounts || []).filter((a: VerifiedAccount) => a.is_verified))
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err)
    } finally {
      setLoadingAccounts(false)
    }
  }, [])

  useEffect(() => {
    fetchServiceStatus()
    fetchAccounts()
  }, [fetchServiceStatus, fetchAccounts])

  useEffect(() => {
    if (user) {
      setNewContactMobile(user.phone || '')
    }
  }, [user])

  // Fetch charges when amount or mode changes
  useEffect(() => {
    const amountNum = parseFloat(amount)
    if (!amountNum || amountNum <= 0 || settlementStep !== 'enter-amount') return

    const timer = setTimeout(async () => {
      setLoadingCharges(true)
      try {
        const res = await apiFetch(`/api/settlement-2/charges?amount=${amountNum}&mode=${transferMode}`)
        const data = await res.json()
        if (data.success && data.charges) {
          setCharges(data.charges.retailer_charge || 0)
        }
      } catch {
        setCharges(0)
      } finally {
        setLoadingCharges(false)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [amount, transferMode, settlementStep])

  // Handle process settlement click
  const handleProcessSettlement = () => {
    if (accounts.length === 0) {
      setShowNoAccountModal(true)
      return
    }
    setActiveView('process-settlement')
    setSettlementStep('select-account')
    setSelectedAccount(null)
    setAmount('')
    setCharges(0)
    setTransferResult(null)
    setError(null)
  }

  // Handle account selection
  const handleSelectAccount = (account: VerifiedAccount) => {
    setSelectedAccount(account)
    setSettlementStep('enter-amount')
  }

  // Handle proceed to confirm
  const handleProceedToConfirm = () => {
    const amountNum = parseFloat(amount)
    if (!amountNum || amountNum <= 0) {
      setError('Enter a valid amount')
      return
    }
    if (amountNum < 1) {
      setError('Minimum transfer amount is ₹1')
      return
    }
    setError(null)
    setSettlementStep('confirm')
  }

  // Execute settlement
  const handleExecuteSettlement = async () => {
    if (!selectedAccount) return
    setError(null)
    setTransferring(true)
    if (!settlementIdemRef.current) settlementIdemRef.current = newIdempotencyKey()

    try {
      const res = await apiFetch('/api/settlement-2/transfer', {
        method: 'POST',
        idempotencyKey: settlementIdemRef.current,
        body: JSON.stringify({
          account_id: selectedAccount.id,
          amount: parseFloat(amount),
          mode: transferMode,
          narration: narration || 'Settlement-2 Transfer',
        }),
      })

      const data = await res.json()
      if (data.success && data.transaction) {
        settlementIdemRef.current = null
        setTransferResult(data.transaction)
        setTransactions(prev => [data.transaction, ...prev])
        setSettlementStep('result')
      } else {
        setError(data.error || 'Transfer failed')
      }
    } catch (err: any) {
      setError(err.message || 'Network error')
    } finally {
      setTransferring(false)
    }
  }

  // Verify & add account
  const handleVerifyAccount = async () => {
    if (!newAccNumber || newAccNumber.length < 9) {
      setError('Enter a valid account number (min 9 digits)')
      return
    }
    if (newAccNumber !== newConfirmAcc) {
      setError('Account numbers do not match')
      return
    }
    if (!newIfsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(newIfsc)) {
      setError('Enter a valid IFSC code')
      return
    }
    const trimmedName = newBeneName.trim()
    if (!trimmedName) {
      setError('Enter beneficiary name')
      return
    }
    if (trimmedName.length < 3) {
      setError('Beneficiary name must be at least 3 characters')
      return
    }
    if (!/^[A-Za-z\s.]+$/.test(trimmedName)) {
      setError('Beneficiary name must contain only letters, spaces, and dots')
      return
    }
    if (!newContactMobile || !/^\d{10}$/.test(newContactMobile)) {
      setError('Enter a valid 10-digit mobile number')
      return
    }

    setError(null)
    setVerifying(true)
    setVerifyResult(null)

    try {
      const res = await apiFetch('/api/settlement-2/accounts', {
        method: 'POST',
        body: JSON.stringify({
          account_number: newAccNumber,
          ifsc_code: newIfsc.toUpperCase(),
          account_holder_name: newBeneName.trim(),
          contact_name: user?.name || '',
          contact_email: user?.email || '',
          contact_mobile: newContactMobile,
        }),
      })

      const data = await res.json()
      setVerifyResult(data)

      if (data.success) {
        fetchAccounts()
        if (data.verified) {
          setNewAccNumber('')
          setNewConfirmAcc('')
          setNewIfsc('')
          setNewBeneName('')
          setNewContactMobile('')
          setShowCelebration(true)
          setCelebrationCountdown(3)
        }
      } else {
        setError(data.error || 'Verification failed')
      }
    } catch (err: any) {
      setError(err.message || 'Network error')
    } finally {
      setVerifying(false)
    }
  }

  useEffect(() => {
    if (!showCelebration) return
    if (celebrationCountdown <= 0) {
      setShowCelebration(false)
      setVerifyResult(null)
      setActiveView('home')
      return
    }
    const t = setTimeout(() => setCelebrationCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [showCelebration, celebrationCountdown])

  // Re-check pending verification
  const [recheckingId, setRecheckingId] = useState<string | null>(null)
  const handleRecheckVerification = async (accountId: string) => {
    setRecheckingId(accountId)
    try {
      const res = await apiFetch('/api/settlement-2/accounts', {
        method: 'PATCH',
        body: JSON.stringify({ account_id: accountId }),
      })
      const data = await res.json()
      if (data.success && data.verified) {
        setAccounts(prev =>
          prev.map(a => a.id === accountId ? { ...a, is_verified: true, verification_status: 'SUCCESS', verified_name: data.account?.verified_name || a.verified_name } : a)
        )
      } else if (data.verification_status === 'FAILED') {
        setAccounts(prev =>
          prev.map(a => a.id === accountId ? { ...a, verification_status: 'FAILED' } : a)
        )
      }
    } catch (err) {
      console.error('Re-check failed:', err)
    } finally {
      setRecheckingId(null)
    }
  }

  // Delete account
  const handleDeleteAccount = async (accountId: string) => {
    try {
      const res = await apiFetch(`/api/settlement-2/accounts?id=${accountId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setAccounts(prev => prev.filter(a => a.id !== accountId))
      }
    } catch (err) {
      console.error('Failed to delete account:', err)
    }
  }

  // Check status
  const handleCheckStatus = async (refId: string) => {
    try {
      const res = await apiFetch('/api/settlement-2/status', {
        method: 'POST',
        body: JSON.stringify({ reference_id: refId }),
      })
      const data = await res.json()
      if (data.success && data.data) {
        setTransactions(prev =>
          prev.map(tx =>
            tx.reference_id === refId
              ? {
                  ...tx,
                  status: data.data.txn_status?.toLowerCase().includes('success')
                    ? 'SUCCESS' as const
                    : data.data.txn_status?.toLowerCase().includes('fail')
                    ? 'FAILED' as const
                    : 'PENDING' as const,
                  utr: data.data.utr || tx.utr,
                  status_message: data.data.status_message,
                }
              : tx
          )
        )
      }
    } catch (err) {
      console.error('Status check failed:', err)
    }
  }

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text)
  const amountNum = parseFloat(amount) || 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {title || 'Settlement-2 - Bank Transfer'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Send money to verified bank accounts via IMPS, NEFT, or RTGS
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
            <button onClick={fetchServiceStatus} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
              <RefreshCw className="w-3 h-3 text-gray-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Error Banner */}
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

      {/* ─── HOME VIEW: 2 Cards ──────────────────────────────── */}
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
                  Send money to verified bank accounts via IMPS, NEFT, or RTGS
                </p>
                {accounts.length > 0 ? (
                  <div className="mt-4 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                      <BadgeCheck className="w-3 h-3" />
                      {accounts.length} verified
                    </span>
                    <span className="text-xs text-gray-400">Ready to use</span>
                  </div>
                ) : (
                  <div className="mt-4 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs">
                    Add account first
                  </div>
                )}
              </div>
            </motion.button>

            {/* Card 2: Add Account */}
            <motion.button
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => { setActiveView('add-account'); setError(null); setVerifyResult(null) }}
              className="group text-left relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-2xl hover:shadow-emerald-500/10 transition-all p-6 overflow-hidden"
            >
              <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-gradient-to-br from-emerald-400/20 to-teal-400/20 blur-2xl group-hover:scale-150 transition-transform duration-700" />
              <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="w-5 h-5 text-emerald-500" />
              </div>
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:rotate-3 transition-all shadow-lg shadow-emerald-500/30">
                  <Plus className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Add Bank Account</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Verify with penny drop & add to your beneficiary list
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                    <Sparkles className="w-3 h-3" />
                    ₹4 + GST
                  </span>
                  <span className="text-xs text-gray-400">One-time per account</span>
                </div>
              </div>
            </motion.button>
          </div>

          {/* Verified Accounts List */}
          {accounts.length > 0 && (
            <div className="mt-6 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  Bank Accounts ({accounts.length})
                </h3>
                <button onClick={fetchAccounts} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  <RefreshCw className={`w-4 h-4 text-gray-400 ${loadingAccounts ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {accounts.map(acct => (
                  <div key={acct.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        acct.is_verified ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-amber-50 dark:bg-amber-900/20'
                      }`}>
                        <Building2 className={`w-5 h-5 ${acct.is_verified ? 'text-blue-600' : 'text-amber-600'}`} />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white text-sm">
                          {acct.verified_name || acct.account_holder_name}
                        </p>
                        <p className="text-xs text-gray-500 font-mono">
                          {acct.account_number} | {acct.ifsc_code}
                        </p>
                        {!acct.is_verified && acct.verification_status === 'PENDING' && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Verification Pending</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {acct.is_verified ? (
                        <BadgeCheck className="w-4 h-4 text-emerald-500" />
                      ) : acct.verification_status === 'PENDING' ? (
                        <button
                          onClick={() => handleRecheckVerification(acct.id)}
                          disabled={recheckingId === acct.id}
                          className="px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                          {recheckingId === acct.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          Re-check
                        </button>
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500" />
                      )}
                      <button
                        onClick={() => handleDeleteAccount(acct.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick access to history */}
          {transactions.length > 0 && (
            <button
              onClick={() => setActiveView('history')}
              className="mt-4 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              <Clock className="w-4 h-4" />
              View {transactions.length} recent transaction{transactions.length !== 1 ? 's' : ''}
            </button>
          )}
        </motion.div>
      )}

      {/* ─── NO ACCOUNT MODAL ────────────────────────────────── */}
      <AnimatePresence>
        {showNoAccountModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowNoAccountModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-gray-900 rounded-2xl p-6 max-w-md w-full shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">No Bank Account Added</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  You need to add and verify a bank account before processing settlements. A verification charge of ₹4 + GST will apply.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowNoAccountModal(false)}
                    className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowNoAccountModal(false)
                      setActiveView('add-account')
                      setError(null)
                      setVerifyResult(null)
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Account
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── PROCESS SETTLEMENT VIEW ─────────────────────────── */}
      {activeView === 'process-settlement' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <button
            onClick={() => { setActiveView('home'); setError(null) }}
            className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          {/* Step: Select Account */}
          {settlementStep === 'select-account' && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-blue-600" />
                  Select Bank Account
                </h3>
                <p className="text-xs text-gray-500 mt-1">Choose a verified account to process settlement</p>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {accounts.map(acct => (
                  <button
                    key={acct.id}
                    onClick={() => handleSelectAccount(acct)}
                    className="w-full p-4 flex items-center justify-between hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white text-sm">
                          {acct.verified_name || acct.account_holder_name}
                        </p>
                        <p className="text-xs text-gray-500 font-mono">
                          {acct.account_number} | {acct.ifsc_code}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-400" />
                  </button>
                ))}
                {accounts.length === 0 && (
                  <div className="p-8 text-center text-gray-500">
                    <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="font-medium">No verified accounts</p>
                    <button
                      onClick={() => { setActiveView('add-account'); setError(null); setVerifyResult(null) }}
                      className="mt-2 text-sm text-blue-600 hover:underline"
                    >
                      Add an account
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step: Enter Amount */}
          {settlementStep === 'enter-amount' && selectedAccount && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <IndianRupee className="w-5 h-5 text-blue-600" />
                  Settlement Details
                </h3>
              </div>
              <div className="p-5 space-y-4">
                {/* Selected account info */}
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center gap-3">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="font-medium text-blue-900 dark:text-blue-100 text-sm">
                      {selectedAccount.verified_name || selectedAccount.account_holder_name}
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-300 font-mono">
                      {selectedAccount.account_number} | {selectedAccount.ifsc_code}
                    </p>
                  </div>
                  <button onClick={() => setSettlementStep('select-account')} className="ml-auto text-xs text-blue-600 hover:underline">
                    Change
                  </button>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (INR) *</label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      min="1"
                      step="0.01"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                {/* Transfer Mode */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Transfer Mode *</label>
                  <div className="flex gap-2">
                    {(['IMPS', 'NEFT', 'RTGS'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setTransferMode(mode)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                          transferMode === mode
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        {mode === 'IMPS' && <Zap className="w-3.5 h-3.5 inline mr-1" />}
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Narration */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Narration (Optional)</label>
                  <input
                    type="text"
                    value={narration}
                    onChange={(e) => setNarration(e.target.value)}
                    placeholder="Optional remarks"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    maxLength={50}
                  />
                </div>

                {/* Charges Preview */}
                {amountNum > 0 && (
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Settlement Amount</span>
                      <span className="font-medium text-gray-900 dark:text-white">₹{amountNum.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">
                        Charges (incl. 18% GST) {loadingCharges && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white">₹{charges.toFixed(2)}</span>
                    </div>
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-1 flex justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-300 font-medium">Total Wallet Debit (Charges)</span>
                      <span className="font-bold text-blue-600">₹{charges.toFixed(2)}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Settlement amount (₹{amountNum.toFixed(2)}) is sent from the provider wallet. Only charges are deducted from your wallet.
                    </p>
                  </div>
                )}

                <button
                  onClick={handleProceedToConfirm}
                  disabled={!amountNum || amountNum <= 0}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  Review & Confirm
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step: Confirm */}
          {settlementStep === 'confirm' && selectedAccount && (
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
                    <p className="font-medium text-gray-900 dark:text-white">
                      {selectedAccount.verified_name || selectedAccount.account_holder_name}
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Account</p>
                    <p className="font-mono text-xs font-medium text-gray-900 dark:text-white">{selectedAccount.account_number}</p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">IFSC</p>
                    <p className="font-mono font-medium text-gray-900 dark:text-white">{selectedAccount.ifsc_code}</p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-1">Mode</p>
                    <p className="font-medium text-gray-900 dark:text-white">{transferMode}</p>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl col-span-2">
                    <p className="text-blue-600 dark:text-blue-400 text-xs mb-1">Settlement Amount</p>
                    <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                      <IndianRupee className="w-5 h-5 inline" />{amountNum.toFixed(2)}
                    </p>
                  </div>
                  {charges > 0 && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl col-span-2">
                      <p className="text-amber-600 dark:text-amber-400 text-xs mb-1">Settlement Charges incl. GST (Wallet Debit)</p>
                      <p className="text-lg font-bold text-amber-700 dark:text-amber-300">₹{charges.toFixed(2)}</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setSettlementStep('enter-amount')}
                    disabled={transferring}
                    className="flex-1 py-3 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleExecuteSettlement}
                    disabled={transferring}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium shadow-md hover:shadow-lg disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                  >
                    {transferring ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                    ) : (
                      <><Send className="w-4 h-4" /> Confirm & Send</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step: Result - Professional Receipt */}
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
                  {transferResult.status === 'SUCCESS' ? 'Transfer Successful' :
                   transferResult.status === 'FAILED' ? 'Transfer Failed' : 'Transfer Processing'}
                </h3>
                <p className="text-white/80 text-sm mt-1">{transferResult.status_message || 'Transaction processed'}</p>
                <p className="text-3xl font-bold text-white mt-3">₹{transferResult.amount.toFixed(2)}</p>
              </div>

              {/* Receipt Body */}
              <div className="p-5" id="receipt-body">
                {/* Dashed separator */}
                <div className="border-t-2 border-dashed border-gray-200 dark:border-gray-700 mb-5 -mt-1" />

                {/* Transaction Details */}
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
                  <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Transfer Mode</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{transferResult.mode}</span>
                  </div>
                  {transferResult.order_id && (
                    <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Order ID</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-medium text-gray-900 dark:text-white">{transferResult.order_id}</span>
                        <button onClick={() => copyToClipboard(transferResult.order_id!)} className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                          <Copy className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  )}
                  {transferResult.utr && (
                    <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm text-gray-500 dark:text-gray-400">UTR Number</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-medium text-emerald-700 dark:text-emerald-400">{transferResult.utr}</span>
                        <button onClick={() => copyToClipboard(transferResult.utr!)} className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                          <Copy className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Reference ID</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono font-medium text-gray-900 dark:text-white">{transferResult.reference_id}</span>
                      <button onClick={() => copyToClipboard(transferResult.reference_id)} className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                        <Copy className="w-3 h-3 text-gray-400" />
                      </button>
                    </div>
                  </div>
                  {transferResult.charges > 0 && (
                    <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Charges (incl. GST)</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">₹{transferResult.charges.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Date & Time</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {new Date(transferResult.provider_timestamp || Date.now()).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: true,
                      })}
                    </span>
                  </div>
                </div>

                {/* Dashed separator */}
                <div className="border-t-2 border-dashed border-gray-200 dark:border-gray-700 my-5" />

                {/* Share Options */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Share Receipt</p>
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      onClick={() => {
                        const text = `*Settlement Receipt*%0A%0AStatus: ${transferResult.status}%0AAmount: ₹${transferResult.amount.toFixed(2)}%0ABeneficiary: ${transferResult.account_holder_name}%0AAccount: ${transferResult.account_number}%0AMode: ${transferResult.mode}%0A${transferResult.utr ? `UTR: ${transferResult.utr}%0A` : ''}Reference: ${transferResult.reference_id}%0ACharges: ₹${transferResult.charges.toFixed(2)}%0ADate: ${new Date(transferResult.provider_timestamp || Date.now()).toLocaleString('en-IN')}`
                        window.open(`https://wa.me/?text=${text}`, '_blank')
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                    >
                      <MessageCircle className="w-5 h-5 text-green-600" />
                      <span className="text-[10px] font-medium text-green-700 dark:text-green-400">WhatsApp</span>
                    </button>
                    <button
                      onClick={() => {
                        const receiptText = `Settlement Receipt\n\nStatus: ${transferResult.status}\nAmount: ₹${transferResult.amount.toFixed(2)}\nBeneficiary: ${transferResult.account_holder_name}\nAccount: ${transferResult.account_number}\nMode: ${transferResult.mode}\n${transferResult.utr ? `UTR: ${transferResult.utr}\n` : ''}Reference: ${transferResult.reference_id}\nCharges: ₹${transferResult.charges.toFixed(2)}\nDate: ${new Date(transferResult.provider_timestamp || Date.now()).toLocaleString('en-IN')}`
                        navigator.clipboard.writeText(receiptText)
                        setError(null)
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                    >
                      <Copy className="w-5 h-5 text-blue-600" />
                      <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">Copy</span>
                    </button>
                    <button
                      onClick={() => {
                        const receiptText = `Settlement Receipt\n${'─'.repeat(35)}\nStatus: ${transferResult.status}\nAmount: ₹${transferResult.amount.toFixed(2)}\nBeneficiary: ${transferResult.account_holder_name}\nAccount: ${transferResult.account_number}\nMode: ${transferResult.mode}\n${transferResult.utr ? `UTR: ${transferResult.utr}\n` : ''}${transferResult.order_id ? `Order ID: ${transferResult.order_id}\n` : ''}Reference: ${transferResult.reference_id}\nCharges: ₹${transferResult.charges.toFixed(2)}\nDate: ${new Date(transferResult.provider_timestamp || Date.now()).toLocaleString('en-IN')}\n${'─'.repeat(35)}\nSame Day Solution`
                        const blob = new Blob([receiptText], { type: 'text/plain' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `receipt_${transferResult.reference_id}.txt`
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
                        const printWindow = window.open('', '_blank')
                        if (printWindow) {
                          printWindow.document.write(`
                            <html><head><title>Receipt - ${transferResult.reference_id}</title>
                            <style>
                              body { font-family: 'Segoe UI', sans-serif; max-width: 400px; margin: 20px auto; padding: 20px; }
                              .header { text-align: center; padding: 20px; border-radius: 12px; color: white; background: ${transferResult.status === 'SUCCESS' ? '#059669' : transferResult.status === 'FAILED' ? '#dc2626' : '#d97706'}; }
                              .amount { font-size: 28px; font-weight: bold; margin-top: 10px; }
                              .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
                              .label { color: #6b7280; font-size: 14px; }
                              .value { font-weight: 600; font-size: 14px; }
                              .divider { border-top: 2px dashed #e5e7eb; margin: 16px 0; }
                              .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 20px; }
                            </style></head><body>
                            <div class="header">
                              <div style="font-size:18px;font-weight:bold">${transferResult.status === 'SUCCESS' ? 'Transfer Successful' : transferResult.status === 'FAILED' ? 'Transfer Failed' : 'Transfer Processing'}</div>
                              <div class="amount">₹${transferResult.amount.toFixed(2)}</div>
                            </div>
                            <div class="divider"></div>
                            <div class="row"><span class="label">Beneficiary</span><span class="value">${transferResult.account_holder_name}</span></div>
                            <div class="row"><span class="label">Account</span><span class="value">${transferResult.account_number}</span></div>
                            <div class="row"><span class="label">Mode</span><span class="value">${transferResult.mode}</span></div>
                            ${transferResult.utr ? `<div class="row"><span class="label">UTR</span><span class="value">${transferResult.utr}</span></div>` : ''}
                            ${transferResult.order_id ? `<div class="row"><span class="label">Order ID</span><span class="value">${transferResult.order_id}</span></div>` : ''}
                            <div class="row"><span class="label">Reference</span><span class="value">${transferResult.reference_id}</span></div>
                            <div class="row"><span class="label">Charges (incl. GST)</span><span class="value">₹${transferResult.charges.toFixed(2)}</span></div>
                            <div class="row"><span class="label">Date</span><span class="value">${new Date(transferResult.provider_timestamp || Date.now()).toLocaleString('en-IN')}</span></div>
                            <div class="divider"></div>
                            <div class="footer">Same Day Solution - Settlement Receipt</div>
                            </body></html>
                          `)
                          printWindow.document.close()
                          printWindow.print()
                        }
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
                {transferResult.status === 'PENDING' && (
                  <button
                    onClick={() => handleCheckStatus(transferResult.reference_id)}
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

      {/* ─── ADD ACCOUNT VIEW ────────────────────────────────── */}
      {activeView === 'add-account' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <button
            onClick={() => { setActiveView('home'); setError(null); setVerifyResult(null) }}
            className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Form section */}
            <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-emerald-50/50 to-teal-50/50 dark:from-emerald-900/10 dark:to-teal-900/10 rounded-t-2xl">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md shadow-emerald-500/20">
                  <ShieldCheck className="w-4 h-4 text-white" />
                </div>
                Add & Verify Bank Account
              </h3>
              <p className="text-xs text-gray-500 mt-1.5 ml-10">
                We&apos;ll send <strong>₹1</strong> via IMPS to confirm the account is real. <strong>₹4 + GST</strong> service charge from wallet.
              </p>
            </div>
            <div className="p-5 space-y-4">
              {/* Account Number */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Number *</label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={newAccNumber}
                      onChange={(e) => setNewAccNumber(e.target.value.replace(/\D/g, ''))}
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
                      value={newConfirmAcc}
                      onChange={(e) => setNewConfirmAcc(e.target.value.replace(/\D/g, ''))}
                      placeholder="Re-enter account number"
                      className={`w-full pl-10 pr-4 py-2.5 rounded-xl border ${
                        newConfirmAcc && newConfirmAcc !== newAccNumber
                          ? 'border-red-400 focus:ring-red-500'
                          : newConfirmAcc && newConfirmAcc === newAccNumber
                          ? 'border-green-400 focus:ring-green-500'
                          : 'border-gray-300 dark:border-gray-700'
                      } bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:border-transparent transition-all`}
                      maxLength={18}
                    />
                    {newConfirmAcc && newConfirmAcc === newAccNumber && (
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
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={newIfsc}
                      onChange={(e) => setNewIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
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
                      value={newBeneName}
                      onChange={(e) => setNewBeneName(e.target.value)}
                      placeholder="Account holder name"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Contact Mobile */}
              <div className="max-w-xs">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contact Mobile *</label>
                <input
                  type="tel"
                  value={newContactMobile}
                  onChange={(e) => setNewContactMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit mobile number"
                  className={`w-full px-4 py-2.5 rounded-xl border ${
                    newContactMobile && newContactMobile.length === 10
                      ? 'border-green-400 focus:ring-green-500'
                      : newContactMobile && newContactMobile.length > 0 && newContactMobile.length < 10
                      ? 'border-amber-400 focus:ring-amber-500'
                      : 'border-gray-300 dark:border-gray-700'
                  } bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:border-transparent transition-all`}
                />
                {newContactMobile && newContactMobile.length > 0 && newContactMobile.length < 10 && (
                  <p className="text-xs text-amber-600 mt-1">Enter complete 10-digit mobile number</p>
                )}
              </div>

              {/* Verify Result (only shown for failed/pending — success shows celebration overlay) */}
              {verifyResult && !verifyResult.verified && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-4 rounded-xl border ${
                    verifyResult.verification_status === 'PENDING'
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                      : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {verifyResult.verification_status === 'PENDING' ? (
                      <><Clock className="w-5 h-5 text-amber-500" />
                      <span className="font-semibold text-amber-700 dark:text-amber-300">Account Verification in Progress</span></>
                    ) : (
                      <><XCircle className="w-5 h-5 text-red-500" />
                      <span className="font-semibold text-red-700 dark:text-red-300">Verification Failed</span></>
                    )}
                  </div>
                  <p className="text-xs mt-1 text-gray-500">{verifyResult.api_message || verifyResult.error}</p>
                  {verifyResult.charge_deducted > 0 && (
                    <p className="text-xs mt-1 text-gray-500">₹{verifyResult.charge_deducted} deducted from wallet</p>
                  )}
                </motion.div>
              )}

              {/* Verify Button */}
              <button
                onClick={handleVerifyAccount}
                disabled={verifying || !newAccNumber || !newIfsc || !newBeneName || newBeneName.trim().length < 3 || !/^[A-Za-z\s.]+$/.test(newBeneName.trim()) || newAccNumber !== newConfirmAcc || !newContactMobile || !/^\d{10}$/.test(newContactMobile)}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-600 to-teal-600 text-white font-semibold shadow-lg shadow-emerald-500/20 hover:shadow-xl hover:shadow-emerald-500/30 hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all flex items-center justify-center gap-2"
              >
                {verifying ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Account Verification in Progress...</>
                ) : (
                  <><ShieldCheck className="w-5 h-5" /> Verify & Add Account (₹4 + GST)</>
                )}
              </button>
            </div>
            </div>

            {/* Side: Live Preview + Info */}
            <div className="lg:col-span-1 space-y-4">
              {/* Live Preview Card */}
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-5 shadow-xl text-white"
              >
                <div className="absolute -right-12 -top-12 w-40 h-40 rounded-full bg-emerald-400/20 blur-3xl" />
                <div className="absolute -left-8 -bottom-8 w-32 h-32 rounded-full bg-blue-400/20 blur-3xl" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-xs uppercase tracking-widest text-white/60 font-semibold">Bank Account</span>
                    <Banknote className="w-5 h-5 text-white/60" />
                  </div>
                  <div className="font-mono text-lg tracking-wider mb-5">
                    {newAccNumber ? newAccNumber.match(/.{1,4}/g)?.join(' ') : '•••• •••• •••• ••••'}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1">Holder</p>
                      <p className="text-sm font-medium truncate">{newBeneName || 'Account Holder'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1">IFSC</p>
                      <p className="text-sm font-mono">{newIfsc || 'XXXX0000000'}</p>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Steps */}
              <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
                <h4 className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-3">How it works</h4>
                <div className="space-y-3">
                  {[
                    { icon: IndianRupee, text: '₹4 + GST deducted from wallet' },
                    { icon: Send, text: '₹1 sent via IMPS to your account' },
                    { icon: BadgeCheck, text: 'Bank confirms beneficiary name' },
                    { icon: Sparkles, text: 'Account verified & ready' },
                  ].map((step, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0">
                        <step.icon className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-300">{step.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ─── HISTORY VIEW ────────────────────────────────────── */}
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
              <div className="p-5 border-b border-gray-100 dark:border-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-600" />
                  Recent Settlements
                </h3>
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
                      <tr key={`${tx.reference_id}-${idx}`} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-gray-900 dark:text-white">{tx.reference_id}</p>
                          {tx.utr && <p className="text-xs text-gray-500">UTR: {tx.utr}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-900 dark:text-white text-xs">{tx.account_holder_name}</p>
                          <p className="text-xs text-gray-500 font-mono">{tx.account_number}</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-medium text-gray-900 dark:text-white">₹{tx.amount.toFixed(2)}</p>
                          {tx.charges > 0 && <p className="text-xs text-gray-500">+₹{tx.charges.toFixed(2)}</p>}
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
                            onClick={() => handleCheckStatus(tx.reference_id)}
                            className="px-3 py-1 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 hover:bg-blue-100 transition-all"
                          >
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

      {/* ─── CELEBRATION OVERLAY (Account Verified) ─────────────── */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 18, stiffness: 200 }}
              className="relative bg-white dark:bg-gray-900 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              {/* Animated gradient header */}
              <div className="relative h-32 bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 overflow-hidden">
                {/* Floating sparkles */}
                {[...Array(12)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute"
                    initial={{
                      x: Math.random() * 400 - 200,
                      y: Math.random() * 100,
                      opacity: 0,
                      scale: 0,
                    }}
                    animate={{
                      y: [Math.random() * 100, Math.random() * 100 - 50],
                      opacity: [0, 1, 0],
                      scale: [0, 1, 0],
                      rotate: [0, 360],
                    }}
                    transition={{
                      duration: 2 + Math.random() * 2,
                      repeat: Infinity,
                      delay: Math.random() * 2,
                    }}
                    style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
                  >
                    <Sparkles className="w-3 h-3 text-white/80" />
                  </motion.div>
                ))}
                {/* Animated check circle */}
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', damping: 10, stiffness: 150, delay: 0.2 }}
                  className="absolute left-1/2 -translate-x-1/2 -bottom-10 w-20 h-20 rounded-full bg-white dark:bg-gray-900 shadow-xl flex items-center justify-center border-4 border-emerald-500"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
                  >
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 fill-emerald-100 dark:fill-emerald-900/40" />
                  </motion.div>
                </motion.div>
              </div>

              {/* Content */}
              <div className="pt-14 pb-6 px-6 text-center">
                <motion.h3
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="text-2xl font-bold text-gray-900 dark:text-white mb-1"
                >
                  Verification Successful!
                </motion.h3>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.7 }}
                  className="text-sm text-gray-500 dark:text-gray-400 mb-5"
                >
                  Your bank account is ready for settlements
                </motion.p>

                {verifyResult?.verified_name && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8 }}
                    className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 mb-5"
                  >
                    <div className="flex items-center justify-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium uppercase tracking-wider mb-2">
                      <BadgeCheck className="w-3.5 h-3.5" />
                      Verified by Bank
                    </div>
                    <p className="text-xl font-bold text-gray-900 dark:text-white tracking-wide">
                      {verifyResult.verified_name}
                    </p>
                    {verifyResult.account?.account_number && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1">
                        ••••{String(verifyResult.account.account_number).slice(-4)} · {verifyResult.account?.ifsc_code}
                      </p>
                    )}
                  </motion.div>
                )}

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-4"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Redirecting in {celebrationCountdown}s...
                </motion.div>

                <button
                  onClick={() => {
                    setShowCelebration(false)
                    setVerifyResult(null)
                    setActiveView('home')
                  }}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  Go to Bank Transfer
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
