'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase/client'
import { apiFetchJson } from '@/lib/api-client'
import { motion } from 'framer-motion'
import {
  Search, X, RefreshCw, Info, AlertCircle, Check, Building2, 
  CreditCard, User, Hash, IndianRupee, Zap, Clock, ArrowRight,
  CheckCircle2, XCircle, Loader2, Wallet, Send, Eye, EyeOff
} from 'lucide-react'

// Types
interface Bank {
  id: number
  bankName: string
  code: string
  ifsc: string
  isIMPS: boolean
  isNEFT: boolean
  isACVerification: boolean
  isPopular: boolean
}

interface PayoutTransaction {
  id: string
  client_ref_id: string
  provider_txn_id?: string
  rrn?: string
  status: string
  amount: number
  charges: number
  total_amount: number
  account_number: string
  account_holder_name: string
  bank_name?: string
  transfer_mode: string
  failure_reason?: string
  created_at: string
  completed_at?: string
}

interface PayoutTransferProps {
  title?: string
}

export default function PayoutTransfer({ title }: PayoutTransferProps = {}) {
  const { user } = useAuth()
  
  // Wallet state
  const [walletBalance, setWalletBalance] = useState<number>(0)
  const [loadingBalance, setLoadingBalance] = useState(true)
  
  // Bank selection
  const [banks, setBanks] = useState<Bank[]>([])
  const [loadingBanks, setLoadingBanks] = useState(false)
  const [bankSearchQuery, setBankSearchQuery] = useState('')
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null)
  const [showBankDropdown, setShowBankDropdown] = useState(false)
  
  // Form state
  const [accountNumber, setAccountNumber] = useState('')
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('')
  const [ifscCode, setIfscCode] = useState('')
  const [accountHolderName, setAccountHolderName] = useState('')
  const [beneficiaryMobile, setBeneficiaryMobile] = useState('')
  const [amount, setAmount] = useState('')
  const [transferMode, setTransferMode] = useState<'IMPS' | 'NEFT'>('IMPS')
  const [remarks, setRemarks] = useState('')
  const [tpin, setTpin] = useState('')
  const [showTpin, setShowTpin] = useState(false)
  
  // Sender details (auto-filled from user profile)
  const [senderName, setSenderName] = useState('')
  const [senderMobile, setSenderMobile] = useState('')
  const [senderEmail, setSenderEmail] = useState('')
  
  // Verification state
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)
  const [verificationResult, setVerificationResult] = useState<{
    account_holder_name?: string
    bank_name?: string
    is_valid?: boolean
  } | null>(null)
  
  // Transfer state
  const [step, setStep] = useState<'details' | 'verify' | 'confirm' | 'result'>('details')
  const [transferring, setTransferring] = useState(false)
  const [transferResult, setTransferResult] = useState<PayoutTransaction | null>(null)
  
  // UI state
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  
  // Recent transactions
  const [recentTransactions, setRecentTransactions] = useState<PayoutTransaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [activeView, setActiveView] = useState<'transfer' | 'history'>('transfer')
  
  // Charges
  const charges = useMemo(() => {
    return transferMode === 'IMPS' ? 5 : 3
  }, [transferMode])
  
  const amountNum = useMemo(() => {
    const num = parseFloat(amount)
    return isNaN(num) ? 0 : num
  }, [amount])
  
  const totalAmount = useMemo(() => {
    return amountNum + charges
  }, [amountNum, charges])

  // Fetch wallet balance
  const fetchWalletBalance = useCallback(async () => {
    if (!user?.partner_id) return
    
    setLoadingBalance(true)
    try {
      const { data, error } = await supabase.rpc('get_wallet_balance_v2', {
        p_user_id: user.partner_id,
        p_wallet_type: 'primary'
      })
      if (!error) {
        setWalletBalance(data || 0)
      }
    } catch (err) {
      console.error('Error fetching wallet balance:', err)
    } finally {
      setLoadingBalance(false)
    }
  }, [user?.partner_id])

  // Fetch bank list - using apiFetch to route to EC2 backend (whitelisted IP)
  const fetchBanks = useCallback(async (query?: string) => {
    setLoadingBanks(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set('search', query)
      params.set('imps', 'true') // Only IMPS-enabled banks
      
      const result = await apiFetchJson<{
        success: boolean
        banks?: Bank[]
        error?: string
      }>(`/api/payout/banks?${params.toString()}`)
      
      if (result.success && result.banks) {
        setBanks(result.banks)
      } else {
        console.warn('Bank list fetch warning:', result.error || 'No banks returned')
      }
    } catch (err: any) {
      console.error('Error fetching banks:', err)
    } finally {
      setLoadingBanks(false)
    }
  }, [])

  // Fetch recent transactions
  const fetchRecentTransactions = useCallback(async () => {
    if (!user?.partner_id) return
    
    setLoadingTransactions(true)
    try {
      const { data, error } = await supabase
        .from('payout_transactions')
        .select('*')
        .eq('retailer_id', user.partner_id)
        .order('created_at', { ascending: false })
        .limit(10)
      
      if (!error && data) {
        setRecentTransactions(data.map(tx => ({
          id: tx.id,
          client_ref_id: tx.client_ref_id,
          provider_txn_id: tx.transaction_id,
          rrn: tx.rrn,
          status: tx.status.toUpperCase(),
          amount: tx.amount,
          charges: tx.charges,
          total_amount: tx.amount + tx.charges,
          account_number: tx.account_number,
          account_holder_name: tx.account_holder_name,
          bank_name: tx.bank_name,
          transfer_mode: tx.transfer_mode,
          failure_reason: tx.failure_reason,
          created_at: tx.created_at,
          completed_at: tx.completed_at,
        })))
      }
    } catch (err) {
      console.error('Error fetching transactions:', err)
    } finally {
      setLoadingTransactions(false)
    }
  }, [user?.partner_id])

  // Initial load
  useEffect(() => {
    fetchWalletBalance()
    fetchBanks()
    fetchRecentTransactions()
    
    const interval = setInterval(fetchWalletBalance, 15000)
    return () => clearInterval(interval)
  }, [fetchWalletBalance, fetchBanks, fetchRecentTransactions])

  // Initialize sender details from user profile
  useEffect(() => {
    if (user) {
      setSenderName(user.name || '')
      setSenderEmail(user.email || '')
      // Fetch phone from retailer profile if available
      if (user.partner_id) {
        supabase
          .from('retailers')
          .select('phone')
          .eq('partner_id', user.partner_id)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.phone) {
              setSenderMobile(data.phone)
            }
          })
      }
    }
  }, [user])

  // Bank search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (bankSearchQuery) {
        fetchBanks(bankSearchQuery)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [bankSearchQuery, fetchBanks])

  // Auto-fill IFSC when bank is selected
  useEffect(() => {
    if (selectedBank?.ifsc) {
      setIfscCode(selectedBank.ifsc.substring(0, 4) + '0')
    }
  }, [selectedBank])

  // Handle bank selection
  const handleBankSelect = (bank: Bank) => {
    setSelectedBank(bank)
    setShowBankDropdown(false)
    setBankSearchQuery(bank.bankName)
    // Reset verification when bank changes
    setVerified(false)
    setVerificationResult(null)
  }

  // Verify account
  const handleVerifyAccount = async () => {
    setError(null)
    
    // Validate inputs
    if (!selectedBank) {
      setError('Please select a bank')
      return
    }
    
    if (!accountNumber || accountNumber.length < 9) {
      setError('Please enter a valid account number (minimum 9 digits)')
      return
    }
    
    if (accountNumber !== confirmAccountNumber) {
      setError('Account numbers do not match')
      return
    }
    
    if (!ifscCode || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      setError('Please enter a valid IFSC code (e.g., SBIN0001234)')
      return
    }

    if (!beneficiaryMobile || !/^[6-9]\d{9}$/.test(beneficiaryMobile)) {
      setError('Please enter a valid 10-digit beneficiary mobile number')
      return
    }
    
    setVerifying(true)
    try {
      const result = await apiFetchJson<{
        success: boolean
        is_valid?: boolean
        account_holder_name?: string
        bank_name?: string
        error?: string
      }>('/api/payout/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountNumber,
          ifscCode,
          bankName: selectedBank?.bankName,
          user_id: user?.partner_id, // Fallback auth
        }),
      })
      
      if (result.success && result.is_valid) {
        setVerified(true)
        setVerificationResult({
          account_holder_name: result.account_holder_name,
          bank_name: result.bank_name,
          is_valid: result.is_valid,
        })
        setAccountHolderName(result.account_holder_name || '')
        setStep('verify')
        setInfoMessage('Account verified successfully!')
      } else {
        setError(result.error || 'Account verification failed')
        setVerified(false)
      }
    } catch (err: any) {
      setError(err.message || 'Account verification failed')
    } finally {
      setVerifying(false)
    }
  }

  // Proceed to confirmation
  const handleProceedToConfirm = () => {
    setError(null)
    
    if (!amountNum || amountNum < 100) {
      setError('Minimum transfer amount is ₹100')
      return
    }
    
    if (amountNum > 200000) {
      setError('Maximum transfer amount is ₹2,00,000')
      return
    }
    
    if (totalAmount > walletBalance) {
      setError(`Insufficient balance. You need ₹${totalAmount.toLocaleString('en-IN')} but have ₹${walletBalance.toLocaleString('en-IN')}`)
      return
    }

    // Validate sender details
    if (!senderName || senderName.trim().length < 2) {
      setError('Please enter sender name')
      return
    }

    if (!senderMobile || !/^[6-9]\d{9}$/.test(senderMobile)) {
      setError('Please enter a valid 10-digit sender mobile number')
      return
    }
    
    setStep('confirm')
  }

  // Handle transfer
  const handleTransfer = async () => {
    setError(null)
    
    if (!tpin || tpin.length !== 4) {
      setError('Please enter your 4-digit TPIN')
      return
    }

    if (!selectedBank) {
      setError('Please select a bank')
      return
    }

    if (!beneficiaryMobile || beneficiaryMobile.length !== 10) {
      setError('Please enter a valid 10-digit beneficiary mobile number')
      return
    }

    if (!senderName || !senderMobile) {
      setError('Sender name and mobile are required')
      return
    }
    
    setTransferring(true)
    try {
      const result = await apiFetchJson<{
        success: boolean
        transaction_id?: string
        provider_txn_id?: string
        client_ref_id?: string
        rrn?: string
        status?: string
        amount?: number
        charges?: number
        total_debited?: number
        account_number?: string
        account_holder_name?: string
        bank_name?: string
        transfer_mode?: string
        error?: string
        refunded?: boolean
      }>('/api/payout/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountNumber,
          ifscCode,
          accountHolderName,
          amount: amountNum,
          transferMode,
          bankId: selectedBank.id,
          bankName: selectedBank.bankName,
          beneficiaryMobile,
          senderName,
          senderMobile,
          senderEmail,
          remarks,
          tpin,
          user_id: user?.partner_id, // Fallback auth
        }),
      })
      
      if (result.success) {
        setTransferResult({
          id: result.transaction_id || '',
          client_ref_id: result.client_ref_id || '',
          provider_txn_id: result.provider_txn_id,
          rrn: result.rrn,
          status: result.status || 'PROCESSING',
          amount: result.amount || amountNum,
          charges: result.charges || charges,
          total_amount: result.total_debited || totalAmount,
          account_number: result.account_number || accountNumber,
          account_holder_name: result.account_holder_name || accountHolderName,
          transfer_mode: result.transfer_mode || transferMode,
          created_at: new Date().toISOString(),
        })
        setStep('result')
        fetchWalletBalance()
        fetchRecentTransactions()
      } else {
        setError(result.error || 'Transfer failed')
        if (result.refunded) {
          setInfoMessage('Amount has been refunded to your wallet.')
        }
      }
    } catch (err: any) {
      setError(err.message || 'Transfer failed')
    } finally {
      setTransferring(false)
    }
  }

  // Reset form
  const handleReset = () => {
    setAccountNumber('')
    setConfirmAccountNumber('')
    setIfscCode('')
    setAccountHolderName('')
    setAmount('')
    setTransferMode('IMPS')
    setRemarks('')
    setTpin('')
    setSelectedBank(null)
    setBankSearchQuery('')
    setVerified(false)
    setVerificationResult(null)
    setTransferResult(null)
    setStep('details')
    setError(null)
    setInfoMessage(null)
  }

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'success': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
      case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
      case 'refunded': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300'
      default: return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'
    }
  }

  // Filtered banks for dropdown
  const filteredBanks = useMemo(() => {
    if (!bankSearchQuery) return banks.filter(b => b.isPopular).slice(0, 10)
    return banks.slice(0, 20)
  }, [banks, bankSearchQuery])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header with balance and tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{title || 'Bank Transfer (Payout)'}</h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Transfer money to any bank account via IMPS/NEFT</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-blue-600" />
              <span className="text-gray-600 dark:text-gray-400">Balance:</span>
              {loadingBalance ? (
                <div className="animate-pulse h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
              ) : (
                <span className="font-bold text-blue-600 dark:text-blue-400">₹{walletBalance.toLocaleString('en-IN')}</span>
              )}
              <button onClick={fetchWalletBalance} className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
                <RefreshCw className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>
        </div>
        
        {/* Tab Switcher */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setActiveView('transfer')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeView === 'transfer' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <Send className="w-4 h-4 inline mr-2" />
            New Transfer
          </button>
          <button
            onClick={() => { setActiveView('history'); fetchRecentTransactions(); }}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeView === 'history' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <Clock className="w-4 h-4 inline mr-2" />
            Recent Transfers
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg flex items-center">
          <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-700 dark:text-red-300 hover:text-red-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Info Message */}
      {infoMessage && (
        <div className="bg-blue-100 dark:bg-blue-900 border border-blue-400 text-blue-700 dark:text-blue-300 px-4 py-3 rounded-lg flex items-center">
          <Info className="w-5 h-5 mr-3 flex-shrink-0" />
          <span>{infoMessage}</span>
          <button onClick={() => setInfoMessage(null)} className="ml-auto text-blue-700 dark:text-blue-300 hover:text-blue-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Transfer Form */}
      {activeView === 'transfer' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {['details', 'verify', 'confirm', 'result'].map((s, i) => (
              <div key={s} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === s ? 'bg-blue-600 text-white' :
                  ['details', 'verify', 'confirm', 'result'].indexOf(step) > i ? 'bg-green-500 text-white' :
                  'bg-gray-200 dark:bg-gray-700 text-gray-500'
                }`}>
                  {['details', 'verify', 'confirm', 'result'].indexOf(step) > i ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                {i < 3 && <div className={`w-12 h-1 ${
                  ['details', 'verify', 'confirm', 'result'].indexOf(step) > i ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                }`} />}
              </div>
            ))}
          </div>

          {/* Step 1: Bank Details */}
          {step === 'details' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Enter Bank Details</h3>
              
              {/* Bank Selection */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Building2 className="w-4 h-4 inline mr-2" />
                  Select Bank
                </label>
                <input
                  type="text"
                  value={bankSearchQuery}
                  onChange={(e) => { setBankSearchQuery(e.target.value); setShowBankDropdown(true); }}
                  onFocus={() => setShowBankDropdown(true)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="Search bank by name..."
                />
                {showBankDropdown && filteredBanks.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredBanks.map(bank => (
                      <button
                        key={bank.id}
                        onClick={() => handleBankSelect(bank)}
                        className="w-full px-4 py-2 text-left hover:bg-blue-50 dark:hover:bg-gray-700 flex items-center justify-between"
                      >
                        <span className="text-gray-900 dark:text-white">{bank.bankName}</span>
                        <div className="flex gap-1">
                          {bank.isIMPS && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">IMPS</span>}
                          {bank.isNEFT && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">NEFT</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Account Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Hash className="w-4 h-4 inline mr-2" />
                  Account Number
                </label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter account number"
                  maxLength={18}
                />
              </div>

              {/* Confirm Account Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Hash className="w-4 h-4 inline mr-2" />
                  Confirm Account Number
                </label>
                <input
                  type="text"
                  value={confirmAccountNumber}
                  onChange={(e) => setConfirmAccountNumber(e.target.value.replace(/\D/g, ''))}
                  className={`w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 ${
                    confirmAccountNumber && confirmAccountNumber !== accountNumber 
                      ? 'border-red-500' 
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                  placeholder="Re-enter account number"
                  maxLength={18}
                />
                {confirmAccountNumber && confirmAccountNumber !== accountNumber && (
                  <p className="text-red-500 text-sm mt-1">Account numbers do not match</p>
                )}
              </div>

              {/* IFSC Code */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <CreditCard className="w-4 h-4 inline mr-2" />
                  IFSC Code
                </label>
                <input
                  type="text"
                  value={ifscCode}
                  onChange={(e) => setIfscCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., SBIN0001234"
                  maxLength={11}
                />
              </div>

              {/* Beneficiary Mobile */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  📱 Beneficiary Mobile Number
                </label>
                <input
                  type="tel"
                  value={beneficiaryMobile}
                  onChange={(e) => setBeneficiaryMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter 10-digit mobile number"
                  maxLength={10}
                />
              </div>

              {/* Verify Button */}
              <div className="flex justify-end pt-4">
                <button
                  onClick={handleVerifyAccount}
                  disabled={verifying || !accountNumber || !confirmAccountNumber || !ifscCode || accountNumber !== confirmAccountNumber || beneficiaryMobile.length !== 10}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {verifying ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Verify Account
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Verification Result & Amount */}
          {step === 'verify' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Account Verified</h3>
              
              {/* Verified Account Info */}
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <span className="font-medium text-green-700 dark:text-green-400">Account Verified Successfully</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Account Holder</p>
                    <p className="font-semibold text-gray-900 dark:text-white">{verificationResult?.account_holder_name || accountHolderName}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Bank Name</p>
                    <p className="font-semibold text-gray-900 dark:text-white">{verificationResult?.bank_name || selectedBank?.bankName || '-'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Account Number</p>
                    <p className="font-semibold text-gray-900 dark:text-white">{accountNumber.replace(/\d(?=\d{4})/g, '*')}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">IFSC Code</p>
                    <p className="font-semibold text-gray-900 dark:text-white">{ifscCode}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Beneficiary Mobile</p>
                    <p className="font-semibold text-gray-900 dark:text-white">{beneficiaryMobile}</p>
                  </div>
                </div>
              </div>

              {/* Sender Details */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h4 className="font-medium text-blue-700 dark:text-blue-400 mb-3">Sender Details (Your Information)</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sender Name</label>
                    <input
                      type="text"
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sender Mobile</label>
                    <input
                      type="tel"
                      value={senderMobile}
                      onChange={(e) => setSenderMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      placeholder="10-digit mobile"
                      maxLength={10}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sender Email (Optional)</label>
                    <input
                      type="email"
                      value={senderEmail}
                      onChange={(e) => setSenderEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      placeholder="Email address"
                    />
                  </div>
                </div>
              </div>

              {/* Amount & Transfer Mode */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    <IndianRupee className="w-4 h-4 inline mr-2" />
                    Amount to Transfer
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter amount (min ₹100)"
                    min="100"
                    max="200000"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    <Zap className="w-4 h-4 inline mr-2" />
                    Transfer Mode
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setTransferMode('IMPS')}
                      className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
                        transferMode === 'IMPS' 
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' 
                          : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      IMPS (Instant)
                      <span className="block text-xs opacity-70">₹5 charges</span>
                    </button>
                    <button
                      onClick={() => setTransferMode('NEFT')}
                      className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
                        transferMode === 'NEFT' 
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' 
                          : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      NEFT
                      <span className="block text-xs opacity-70">₹3 charges</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Remarks (Optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Salary, Payment, etc."
                  maxLength={50}
                />
              </div>

              {/* Amount Summary */}
              {amountNum > 0 && (
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600 dark:text-gray-400">Transfer Amount</span>
                    <span className="text-gray-900 dark:text-white">₹{amountNum.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600 dark:text-gray-400">Charges ({transferMode})</span>
                    <span className="text-gray-900 dark:text-white">₹{charges}</span>
                  </div>
                  <div className="border-t border-gray-300 dark:border-gray-600 pt-2 flex justify-between font-semibold">
                    <span className="text-gray-900 dark:text-white">Total Debit</span>
                    <span className="text-blue-600 dark:text-blue-400">₹{totalAmount.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              )}

              {/* Buttons */}
              <div className="flex justify-between pt-4">
                <button
                  onClick={() => { setStep('details'); setVerified(false); }}
                  className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Back
                </button>
                <button
                  onClick={handleProceedToConfirm}
                  disabled={!amountNum || amountNum < 100 || totalAmount > walletBalance}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  Proceed
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Confirmation */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Confirm Transfer</h3>
              
              {/* Transfer Summary */}
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Beneficiary Name</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{accountHolderName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Account Number</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{accountNumber.replace(/\d(?=\d{4})/g, '*')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">IFSC Code</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{ifscCode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Transfer Mode</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{transferMode}</span>
                </div>
                <div className="border-t border-gray-300 dark:border-gray-600 pt-3">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Amount</span>
                    <span className="text-gray-900 dark:text-white">₹{amountNum.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Charges</span>
                    <span className="text-gray-900 dark:text-white">₹{charges}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg mt-2">
                    <span className="text-gray-900 dark:text-white">Total</span>
                    <span className="text-blue-600 dark:text-blue-400">₹{totalAmount.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>

              {/* TPIN Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Enter TPIN to Authorize
                </label>
                <div className="relative">
                  <input
                    type={showTpin ? 'text' : 'password'}
                    value={tpin}
                    onChange={(e) => setTpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter 4-digit TPIN"
                    maxLength={4}
                  />
                  <button
                    type="button"
                    onClick={() => setShowTpin(!showTpin)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500"
                  >
                    {showTpin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex justify-between pt-4">
                <button
                  onClick={() => setStep('verify')}
                  disabled={transferring}
                  className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={handleTransfer}
                  disabled={transferring || tpin.length !== 4}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {transferring ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Transfer ₹{totalAmount.toLocaleString('en-IN')}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Result */}
          {step === 'result' && transferResult && (
            <div className="space-y-4 text-center">
              <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full ${
                transferResult.status === 'SUCCESS' ? 'bg-green-100 dark:bg-green-900' :
                transferResult.status === 'FAILED' ? 'bg-red-100 dark:bg-red-900' :
                'bg-yellow-100 dark:bg-yellow-900'
              }`}>
                {transferResult.status === 'SUCCESS' ? (
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                ) : transferResult.status === 'FAILED' ? (
                  <XCircle className="w-8 h-8 text-red-600" />
                ) : (
                  <Clock className="w-8 h-8 text-yellow-600" />
                )}
              </div>

              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {transferResult.status === 'SUCCESS' ? 'Transfer Successful!' :
                 transferResult.status === 'FAILED' ? 'Transfer Failed' :
                 'Transfer Processing'}
              </h3>

              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-left space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Transaction ID</span>
                  <span className="font-mono text-gray-900 dark:text-white">{transferResult.client_ref_id}</span>
                </div>
                {transferResult.rrn && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">RRN</span>
                    <span className="font-mono text-gray-900 dark:text-white">{transferResult.rrn}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Beneficiary</span>
                  <span className="text-gray-900 dark:text-white">{transferResult.account_holder_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Account</span>
                  <span className="text-gray-900 dark:text-white">{transferResult.account_number}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Amount</span>
                  <span className="font-semibold text-gray-900 dark:text-white">₹{transferResult.amount.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Status</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getStatusColor(transferResult.status)}`}>
                    {transferResult.status}
                  </span>
                </div>
              </div>

              <button
                onClick={handleReset}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition-colors"
              >
                New Transfer
              </button>
            </div>
          )}
        </div>
      )}

      {/* Transaction History */}
      {activeView === 'history' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Transfers</h3>
          
          {loadingTransactions ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : recentTransactions.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">No transfers found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Beneficiary</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Account</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Mode</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {recentTransactions.map(tx => (
                    <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200">
                        {new Date(tx.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200">{tx.account_holder_name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-gray-200">{tx.account_number}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-200">₹{tx.amount.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-200">{tx.transfer_mode}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getStatusColor(tx.status)}`}>
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}

