'use client'

/**
 * KnteerPayoutTransfer — Settlement-1 UI powered by Knteer Solution API.
 *
 * Visual design matches ShadvalPayTransfer (Settlement-2) exactly.
 * No "Knteer" branding is exposed to users — the label stays "Settlement-1".
 *
 * Flow:
 *   - Bank account verification via penny drop (shared with Settlement-2)
 *   - User selects a verified account before processing settlement
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
  CreditCard, ChevronRight, Plus, Trash2,
  Download, MessageCircle, Printer, Eye, EyeOff,
  BadgeCheck, ShieldCheck, ShieldAlert, Sparkles,
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

interface VerifiedAccount {
  id: string
  account_number: string
  ifsc_code: string
  account_holder_name: string
  verified_name?: string
  is_verified: boolean
  verification_status?: string
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
  const [activeView, setActiveView] = useState<'home' | 'process-settlement' | 'add-account' | 'history'>('home')

  // Accounts
  const [accounts, setAccounts] = useState<VerifiedAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const isTrustedUnverified = (a: VerifiedAccount) =>
    !a.is_verified && (a.verification_status === 'SKIPPED' || a.verification_status === 'NOT_VERIFIED' || !a.verification_status)
  const settlementAccounts = accounts.filter(a => a.is_verified || isTrustedUnverified(a))
  const [selectedAccount, setSelectedAccount] = useState<VerifiedAccount | null>(null)

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
  const [addingWithoutVerify, setAddingWithoutVerify] = useState(false)
  const [recheckingId, setRecheckingId] = useState<string | null>(null)
  const [showNoAccountModal, setShowNoAccountModal] = useState(false)

  // Settlement step
  const [settlementStep, setSettlementStep] = useState<'select-account' | 'enter-details' | 'confirm' | 'result'>('select-account')

  // Form — bank details (populated from selected account)
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

  // ── Accounts ─────────────────────────────────────────────────────────────────

  const fetchAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const res = await apiFetch('/api/settlement-2/accounts')
      const data = await res.json()
      if (data.success) setAccounts(data.accounts || [])
    } catch { /* silent */ }
    finally { setLoadingAccounts(false) }
  }, [])

  const handleVerifyAccount = async () => {
    if (!newAccNumber || newAccNumber.length < 9) return setError('Enter a valid account number (min 9 digits)')
    if (newAccNumber !== newConfirmAcc) return setError('Account numbers do not match')
    if (!newIfsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(newIfsc)) return setError('Enter a valid IFSC code')
    const cleanedName = newBeneName.trim().replace(/[^A-Za-z\s\-]/g, '').replace(/\s+/g, ' ').trim()
    if (cleanedName.length < 3) return setError('Beneficiary name must be at least 3 letters')
    if (!newContactMobile || !/^\d{10}$/.test(newContactMobile)) return setError('Enter a valid 10-digit mobile number')
    setError(null)
    setVerifying(true)
    setVerifyResult(null)
    try {
      const res = await apiFetch('/api/settlement-2/accounts', {
        method: 'POST',
        body: JSON.stringify({ account_number: newAccNumber, ifsc_code: newIfsc.toUpperCase(), account_holder_name: cleanedName, contact_name: user?.name || '', contact_email: user?.email || '', contact_mobile: newContactMobile }),
      })
      const data = await res.json()
      setVerifyResult(data)
      if (data.success) {
        fetchAccounts()
        if (data.verified) {
          setNewAccNumber(''); setNewConfirmAcc(''); setNewIfsc(''); setNewBeneName(''); setNewContactMobile('')
          setShowCelebration(true)
          setCelebrationCountdown(3)
        }
      } else {
        setError(data.error || 'Verification failed')
      }
    } catch (err: any) { setError(err.message || 'Network error') }
    finally { setVerifying(false) }
  }

  useEffect(() => {
    if (!showCelebration) return
    if (celebrationCountdown <= 0) { setShowCelebration(false); setVerifyResult(null); setActiveView('home'); return }
    const t = setTimeout(() => setCelebrationCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [showCelebration, celebrationCountdown])

  const handleAddWithoutVerification = async () => {
    if (!newAccNumber || newAccNumber.length < 9) return setError('Enter a valid account number (min 9 digits)')
    if (newAccNumber !== newConfirmAcc) return setError('Account numbers do not match')
    if (!newIfsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(newIfsc)) return setError('Enter a valid IFSC code')
    const cleanedName = newBeneName.trim().replace(/[^A-Za-z\s\-]/g, '').replace(/\s+/g, ' ').trim()
    if (cleanedName.length < 3) return setError('Beneficiary name must be at least 3 letters')
    if (!newContactMobile || !/^\d{10}$/.test(newContactMobile)) return setError('Enter a valid 10-digit mobile number')
    setError(null)
    setAddingWithoutVerify(true)
    try {
      const res = await apiFetch('/api/settlement-2/accounts', {
        method: 'POST',
        body: JSON.stringify({ account_number: newAccNumber, ifsc_code: newIfsc.toUpperCase(), account_holder_name: cleanedName, contact_name: user?.name || '', contact_email: user?.email || '', contact_mobile: newContactMobile, skip_verification: true }),
      })
      const data = await res.json()
      if (data.success) { fetchAccounts(); setNewAccNumber(''); setNewConfirmAcc(''); setNewIfsc(''); setNewBeneName(''); setNewContactMobile(''); setActiveView('home') }
      else setError(data.error || 'Failed to add account')
    } catch (err: any) { setError(err.message || 'Network error') }
    finally { setAddingWithoutVerify(false) }
  }

  const handleRecheckVerification = async (accountId: string) => {
    setRecheckingId(accountId)
    try {
      const res = await apiFetch('/api/settlement-2/accounts', { method: 'PATCH', body: JSON.stringify({ account_id: accountId }) })
      const data = await res.json()
      if (data.success && data.verified) setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, is_verified: true, verification_status: 'SUCCESS', verified_name: data.account?.verified_name || a.verified_name } : a))
      else if (data.verification_status) setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, verification_status: data.verification_status } : a))
    } catch { /* silent */ }
    finally { setRecheckingId(null) }
  }

  const handleDeleteAccount = async (accountId: string) => {
    try {
      const res = await apiFetch(`/api/settlement-2/accounts?id=${accountId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) setAccounts(prev => prev.filter(a => a.id !== accountId))
    } catch { /* silent */ }
  }

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
    fetchAccounts()
  }, [fetchServiceStatus, fetchTransactions, fetchAccounts])

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
    if (settlementAccounts.length === 0) {
      setShowNoAccountModal(true)
      return
    }
    setActiveView('process-settlement')
    setSettlementStep('select-account')
    setSelectedAccount(null)
    setAmount('')
    setCharges(0)
    setSchemeMessage(null)
    setTransferResult(null)
    setError(null)
  }

  const handleSelectAccount = (acct: VerifiedAccount) => {
    setSelectedAccount(acct)
    setAccountNumber(acct.account_number)
    setConfirmAccountNumber(acct.account_number)
    setIfscCode(acct.ifsc_code)
    setAccountHolderName(acct.verified_name || acct.account_holder_name)
    setBankName(acct.ifsc_code.substring(0, 4))
    setBeneficiaryMobile(senderMobile || '')
    setSettlementStep('enter-details')
  }

  // ── Validation → confirm ────────────────────────────────────────────────────

  const handleProceedToConfirm = () => {
    if (!selectedAccount) return setError('Please select a bank account')
    if (!amountNum || amountNum < 100) return setError('Minimum transfer amount is ₹100')
    if (amountNum > 200000) return setError('Maximum transfer amount is ₹2,00,000')
    if (schemeMessage) return setError(schemeMessage)
    if (!senderName || senderName.trim().length < 2) return setError('Please fill in your Sender Name')
    if (!senderMobile || !/^[6-9]\d{9}$/.test(senderMobile)) return setError('Please fill in a valid 10-digit Sender Mobile')
    setError(null)
    setBeneficiaryMobile(senderMobile)
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

            {/* Card 2: Add Bank Account */}
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

          {/* Saved Accounts List */}
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
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${acct.is_verified ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-amber-50 dark:bg-amber-900/20'}`}>
                        <Building2 className={`w-5 h-5 ${acct.is_verified ? 'text-blue-600' : 'text-amber-600'}`} />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white text-sm">{acct.verified_name || acct.account_holder_name}</p>
                        <p className="text-xs text-gray-500 font-mono">{acct.account_number} | {acct.ifsc_code}</p>
                        {!acct.is_verified && (
                          <p className={`text-xs mt-0.5 ${isTrustedUnverified(acct) ? 'text-amber-600' : acct.verification_status === 'PENDING' ? 'text-amber-600' : 'text-red-500'}`}>
                            {isTrustedUnverified(acct) ? 'Not verified — transfers at your own risk' : acct.verification_status === 'PENDING' ? 'Verification pending — use Re-check' : 'Verification failed — re-check or delete'}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {acct.is_verified ? (
                        <BadgeCheck className="w-4 h-4 text-emerald-500" />
                      ) : isTrustedUnverified(acct) ? (
                        <ShieldAlert className="w-4 h-4 text-amber-500" />
                      ) : (
                        <>
                          {acct.verification_status !== 'PENDING' && <XCircle className="w-4 h-4 text-red-500" />}
                          <button onClick={() => handleRecheckVerification(acct.id)} disabled={recheckingId === acct.id}
                            className="px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg hover:bg-amber-100 disabled:opacity-50 flex items-center gap-1">
                            {recheckingId === acct.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Re-check
                          </button>
                        </>
                      )}
                      <button onClick={() => handleDeleteAccount(acct.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
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
            <button onClick={() => { setActiveView('history'); fetchTransactions() }} className="mt-4 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
              <Clock className="w-4 h-4" /> View {transactions.length} recent transaction{transactions.length !== 1 ? 's' : ''}
            </button>
          )}

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

      {/* ─── NO ACCOUNT MODAL ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showNoAccountModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNoAccountModal(false)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-gray-900 rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">No Bank Account Added</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">You need to add and verify a bank account before processing settlements.</p>
                <div className="flex gap-3">
                  <button onClick={() => setShowNoAccountModal(false)} className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-all">Cancel</button>
                  <button onClick={() => { setShowNoAccountModal(false); setActiveView('add-account'); setError(null); setVerifyResult(null) }}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2">
                    <Plus className="w-4 h-4" /> Add Account
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── ADD ACCOUNT VIEW ──────────────────────────────────────────────── */}
      {activeView === 'add-account' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <button onClick={() => { setActiveView('home'); setError(null); setVerifyResult(null) }} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 mb-4">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          {showCelebration ? (
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center py-12">
              <div className="text-6xl mb-4">🎉</div>
              <h3 className="text-xl font-bold text-emerald-600 mb-2">Account Verified!</h3>
              <p className="text-sm text-gray-500">Bank confirmed the account. Redirecting in {celebrationCountdown}s...</p>
            </motion.div>
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Add Bank Account</h3>
              <p className="text-sm text-gray-500 mb-5">Verify with penny drop & add to your beneficiary list</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Account Number</label>
                  <input type="text" value={newAccNumber} onChange={e => setNewAccNumber(e.target.value.replace(/\D/g, ''))} placeholder="Enter account number" className="w-full px-4 py-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Confirm Account Number</label>
                  <input type="text" value={newConfirmAcc} onChange={e => setNewConfirmAcc(e.target.value.replace(/\D/g, ''))} placeholder="Re-enter account number" className="w-full px-4 py-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">IFSC Code</label>
                  <input type="text" value={newIfsc} onChange={e => setNewIfsc(e.target.value.toUpperCase())} placeholder="e.g. SBIN0001234" maxLength={11} className="w-full px-4 py-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700 uppercase" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Account Holder Name</label>
                  <input type="text" value={newBeneName} onChange={e => setNewBeneName(e.target.value)} placeholder="As per bank records" className="w-full px-4 py-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Mobile Number</label>
                  <input type="tel" value={newContactMobile} onChange={e => setNewContactMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" maxLength={10} className="w-full px-4 py-2.5 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-700" />
                </div>
              </div>

              {verifyResult && !verifyResult.verified && verifyResult.error && (
                <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">{verifyResult.error}</div>
              )}
              {verifyResult && verifyResult.verified && (
                <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Account verified: {verifyResult.account?.verified_name}
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <button onClick={handleVerifyAccount} disabled={verifying || addingWithoutVerify}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
                  {verifying ? 'Verifying...' : 'Verify with Penny Drop (₹4 + GST)'}
                </button>
              </div>
              <button onClick={handleAddWithoutVerification} disabled={verifying || addingWithoutVerify}
                className="mt-2 w-full py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {addingWithoutVerify ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
                Add without verification (at your risk)
              </button>
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

          {/* ── Step: Select Account ── */}
          {settlementStep === 'select-account' && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Select Bank Account</h3>
              <p className="text-sm text-gray-500 mb-5">Choose a verified bank account for settlement</p>
              <div className="space-y-3">
                {settlementAccounts.map(acct => (
                  <button key={acct.id} onClick={() => handleSelectAccount(acct)}
                    className="w-full text-left p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 transition-all flex items-center gap-3 group">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{acct.verified_name || acct.account_holder_name}</p>
                      <p className="text-xs text-gray-500 font-mono">{acct.account_number} | {acct.ifsc_code}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {acct.is_verified ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-full"><BadgeCheck className="w-3 h-3" /> Verified</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-full"><ShieldAlert className="w-3 h-3" /> Unverified</span>
                      )}
                      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-500" />
                    </div>
                  </button>
                ))}
              </div>
              {accounts.length > settlementAccounts.length && (
                <p className="mt-3 text-xs text-gray-400 text-center">
                  {accounts.length - settlementAccounts.length} account(s) with failed verification hidden
                </p>
              )}
            </div>
          )}

          {/* ── Step: Enter Details ── */}
          {settlementStep === 'enter-details' && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  Settlement Details
                </h3>
                <p className="text-xs text-gray-500 mt-1">Enter amount to transfer to selected account</p>
              </div>
              <div className="p-5 space-y-4">

                {/* Selected Account Card */}
                {selectedAccount && (
                  <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-800/30 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm text-gray-900 dark:text-white">{selectedAccount.verified_name || selectedAccount.account_holder_name}</p>
                        <p className="text-xs text-gray-500 font-mono">{selectedAccount.account_number} | {selectedAccount.ifsc_code}</p>
                      </div>
                    </div>
                    <button onClick={() => setSettlementStep('select-account')} className="text-xs text-blue-600 hover:underline">Change</button>
                  </div>
                )}

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
