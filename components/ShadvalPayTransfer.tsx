'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { apiFetch } from '@/lib/api-client'
import { motion, AnimatePresence } from 'framer-motion'
import {
  RefreshCw, AlertCircle, AlertTriangle, Check,
  Building2, User, Hash, IndianRupee, Zap, Clock,
  ArrowRight, CheckCircle2, XCircle, Loader2,
  Wallet, Send, Search, Copy, ArrowLeft,
  Plus, CreditCard, Trash2, ShieldCheck, BadgeCheck,
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
  const [transferResult, setTransferResult] = useState<TransactionRecord | null>(null)

  // Add account state
  const [newAccNumber, setNewAccNumber] = useState('')
  const [newConfirmAcc, setNewConfirmAcc] = useState('')
  const [newIfsc, setNewIfsc] = useState('')
  const [newBeneName, setNewBeneName] = useState('')
  const [newContactMobile, setNewContactMobile] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<any>(null)

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

    try {
      const res = await apiFetch('/api/settlement-2/transfer', {
        method: 'POST',
        body: JSON.stringify({
          account_id: selectedAccount.id,
          amount: parseFloat(amount),
          mode: transferMode,
          narration: narration || 'Settlement-2 Transfer',
        }),
      })

      const data = await res.json()
      if (data.success && data.transaction) {
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
    if (!newBeneName.trim()) {
      setError('Enter beneficiary name')
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
            <button
              onClick={handleProcessSettlement}
              className="group text-left bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700 transition-all p-6"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Send className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Process Settlement</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Send settlement to verified bank accounts via IMPS, NEFT, or RTGS
              </p>
              {accounts.length > 0 && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-3 font-medium">
                  {accounts.length} verified account{accounts.length !== 1 ? 's' : ''} available
                </p>
              )}
            </button>

            {/* Card 2: Add Account */}
            <button
              onClick={() => { setActiveView('add-account'); setError(null); setVerifyResult(null) }}
              className="group text-left bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-lg hover:border-emerald-300 dark:hover:border-emerald-700 transition-all p-6"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Plus className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Add Account</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Verify & add bank accounts for future settlements (₹4 verification charge)
              </p>
            </button>
          </div>

          {/* Verified Accounts List */}
          {accounts.length > 0 && (
            <div className="mt-6 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  Verified Accounts ({accounts.length})
                </h3>
                <button onClick={fetchAccounts} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
                  <RefreshCw className={`w-4 h-4 text-gray-400 ${loadingAccounts ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {accounts.map(acct => (
                  <div key={acct.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/30">
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
                    <div className="flex items-center gap-2">
                      <BadgeCheck className="w-4 h-4 text-emerald-500" />
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
                  You need to add and verify a bank account before processing settlements. A verification charge of ₹4 will apply.
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
                        Charges {loadingCharges && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}
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
                      <p className="text-amber-600 dark:text-amber-400 text-xs mb-1">Settlement Charges (Wallet Debit)</p>
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

          {/* Step: Result */}
          {settlementStep === 'result' && transferResult && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm"
            >
              <div className="p-8 text-center space-y-4">
                <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${
                  transferResult.status === 'SUCCESS'
                    ? 'bg-emerald-100 dark:bg-emerald-900/30'
                    : transferResult.status === 'FAILED'
                    ? 'bg-red-100 dark:bg-red-900/30'
                    : 'bg-amber-100 dark:bg-amber-900/30'
                }`}>
                  {transferResult.status === 'SUCCESS' ? (
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  ) : transferResult.status === 'FAILED' ? (
                    <XCircle className="w-8 h-8 text-red-600" />
                  ) : (
                    <Clock className="w-8 h-8 text-amber-600" />
                  )}
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  {transferResult.status === 'SUCCESS' ? 'Settlement Successful!' :
                   transferResult.status === 'FAILED' ? 'Settlement Failed' : 'Settlement Processing'}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{transferResult.status_message}</p>
              </div>

              <div className="px-5 pb-5 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {transferResult.order_id && (
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                      <p className="text-gray-500 text-xs mb-1">Order ID</p>
                      <div className="flex items-center gap-1">
                        <p className="font-mono text-xs font-medium text-gray-900 dark:text-white truncate">{transferResult.order_id}</p>
                        <button onClick={() => copyToClipboard(transferResult.order_id!)} className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
                          <Copy className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  )}
                  {transferResult.utr && (
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                      <p className="text-gray-500 text-xs mb-1">UTR</p>
                      <div className="flex items-center gap-1">
                        <p className="font-mono text-xs font-medium text-gray-900 dark:text-white truncate">{transferResult.utr}</p>
                        <button onClick={() => copyToClipboard(transferResult.utr!)} className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
                          <Copy className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 text-xs mb-1">Amount</p>
                    <p className="font-medium text-gray-900 dark:text-white">₹{transferResult.amount.toFixed(2)}</p>
                  </div>
                  {transferResult.charges > 0 && (
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                      <p className="text-gray-500 text-xs mb-1">Charges</p>
                      <p className="font-medium text-gray-900 dark:text-white">₹{transferResult.charges.toFixed(2)}</p>
                    </div>
                  )}
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 text-xs mb-1">Mode</p>
                    <p className="font-medium text-gray-900 dark:text-white">{transferResult.mode}</p>
                  </div>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <p className="text-gray-500 text-xs mb-1">Reference</p>
                    <p className="font-mono text-xs font-medium text-gray-900 dark:text-white">{transferResult.reference_id}</p>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
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
              </div>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* ─── ADD ACCOUNT VIEW ────────────────────────────────── */}
      {activeView === 'add-account' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <button
            onClick={() => { setActiveView('home'); setError(null) }}
            className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-600" />
                Add & Verify Bank Account
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                A verification charge of <strong>₹4</strong> will be deducted from your wallet
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contact Mobile</label>
                <input
                  type="tel"
                  value={newContactMobile}
                  onChange={(e) => setNewContactMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit mobile"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>

              {/* Charge notice */}
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                <p className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Verification Charge:</strong> ₹4 will be deducted from your wallet to verify this bank account via penny drop.
                    Verified accounts can be used for future settlements.
                  </span>
                </p>
              </div>

              {/* Verify Result */}
              {verifyResult && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-4 rounded-xl border ${
                    verifyResult.verified
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                      : verifyResult.verification_status === 'PENDING'
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                      : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {verifyResult.verified ? (
                      <><CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <span className="font-semibold text-emerald-700 dark:text-emerald-300">Account Verified!</span></>
                    ) : verifyResult.verification_status === 'PENDING' ? (
                      <><Clock className="w-5 h-5 text-amber-500" />
                      <span className="font-semibold text-amber-700 dark:text-amber-300">Verification Pending</span></>
                    ) : (
                      <><XCircle className="w-5 h-5 text-red-500" />
                      <span className="font-semibold text-red-700 dark:text-red-300">Verification Failed</span></>
                    )}
                  </div>
                  {verifyResult.verified_name && (
                    <p className="text-sm mt-1 text-gray-700 dark:text-gray-300">
                      Verified Name: <strong>{verifyResult.verified_name}</strong>
                    </p>
                  )}
                  <p className="text-xs mt-1 text-gray-500">{verifyResult.api_message}</p>
                  <p className="text-xs mt-1 text-gray-500">₹{verifyResult.charge_deducted} deducted from wallet</p>
                </motion.div>
              )}

              {/* Verify Button */}
              <button
                onClick={handleVerifyAccount}
                disabled={verifying || !newAccNumber || !newIfsc || !newBeneName}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {verifying ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</>
                ) : (
                  <><ShieldCheck className="w-4 h-4" /> Verify & Add Account (₹4)</>
                )}
              </button>
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
    </div>
  )
}
