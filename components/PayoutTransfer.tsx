'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase/client'
import { apiFetchJson } from '@/lib/api-client'
import { motion } from 'framer-motion'
import {
  Search, X, RefreshCw, Info, AlertCircle, AlertTriangle, Check, Building2, 
  CreditCard, User, Hash, IndianRupee, Zap, Clock, ArrowRight,
  CheckCircle2, XCircle, Loader2, Wallet, Send, Eye, EyeOff,
  Star, Trash2, Plus, BookUser
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

interface SavedBeneficiary {
  id: string
  account_number: string
  ifsc_code: string
  account_holder_name: string
  bank_id?: number
  bank_name: string
  beneficiary_mobile?: string
  nickname?: string
  is_default: boolean
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
    is_saved_account?: boolean // True if using saved account without fresh verification
  } | null>(null)
  
  // Transfer state
  const [step, setStep] = useState<'details' | 'verify' | 'confirm' | 'result'>('details')
  const [transferring, setTransferring] = useState(false)
  const [transferResult, setTransferResult] = useState<PayoutTransaction | null>(null)
  const [isPollingStatus, setIsPollingStatus] = useState(false)
  
  // UI state
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  
  // Recent transactions
  const [recentTransactions, setRecentTransactions] = useState<PayoutTransaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [activeView, setActiveView] = useState<'transfer' | 'history'>('transfer')
  
  // Saved beneficiaries - Show saved accounts first if available
  const [savedBeneficiaries, setSavedBeneficiaries] = useState<SavedBeneficiary[]>([])
  const [loadingBeneficiaries, setLoadingBeneficiaries] = useState(true) // Start as true since we load on mount
  const [showSavedBeneficiaries, setShowSavedBeneficiaries] = useState(false)
  const [savingBeneficiary, setSavingBeneficiary] = useState(false)
  const [showNewAccountForm, setShowNewAccountForm] = useState(false) // Track if user wants to add new account
  
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
      // Use API endpoint instead of direct Supabase call
      const result = await apiFetchJson<{
        success: boolean
        transactions?: any[]
        error?: string
      }>(`/api/payout/status?user_id=${user.partner_id}&list=true`)
      
      if (result.success && result.transactions) {
        setRecentTransactions(result.transactions.map((tx: any) => ({
          id: tx.id,
          client_ref_id: tx.client_ref_id,
          provider_txn_id: tx.transaction_id,
          rrn: tx.rrn,
          status: tx.status?.toUpperCase() || 'PENDING',
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

  // Poll transaction status for pending/processing transactions
  const pollTransactionStatus = useCallback(async (transactionId: string) => {
    if (!user?.partner_id || !transactionId) return
    
    try {
      const result = await apiFetchJson<{
        success: boolean
        transaction?: {
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
        error?: string
      }>(`/api/payout/status?transactionId=${transactionId}&user_id=${user.partner_id}`)
      
      if (result.success && result.transaction) {
        const updatedTx = result.transaction
        // Update the transfer result with the latest status
        setTransferResult(prev => prev ? {
          ...prev,
          status: updatedTx.status,
          rrn: updatedTx.rrn || prev.rrn,
          provider_txn_id: updatedTx.provider_txn_id || prev.provider_txn_id,
          failure_reason: updatedTx.failure_reason,
          completed_at: updatedTx.completed_at,
        } : null)
        
        // Return the status for the polling effect
        return updatedTx.status
      }
    } catch (err) {
      console.error('Error polling transaction status:', err)
    }
    return null
  }, [user?.partner_id])

  // Fetch saved beneficiaries
  const fetchSavedBeneficiaries = useCallback(async () => {
    if (!user?.partner_id) {
      setLoadingBeneficiaries(false)
      setShowNewAccountForm(true) // Show form if no user
      return
    }
    
    setLoadingBeneficiaries(true)
    try {
      const result = await apiFetchJson<{
        success: boolean
        beneficiaries?: SavedBeneficiary[]
        error?: string
      }>(`/api/beneficiaries?user_id=${user.partner_id}`)
      
      if (result.success && result.beneficiaries) {
        setSavedBeneficiaries(result.beneficiaries)
        // If no saved beneficiaries, show the new account form by default
        if (result.beneficiaries.length === 0) {
          setShowNewAccountForm(true)
        }
      } else {
        // If no beneficiaries or error, show form
        setShowNewAccountForm(true)
      }
    } catch (err) {
      console.error('Error fetching saved beneficiaries:', err)
      setShowNewAccountForm(true) // Show form on error
    } finally {
      setLoadingBeneficiaries(false)
    }
  }, [user?.partner_id])

  // Save beneficiary
  const saveBeneficiary = async () => {
    if (!user?.partner_id || !accountNumber || !ifscCode || !selectedBank) return
    
    setSavingBeneficiary(true)
    try {
      const result = await apiFetchJson<{
        success: boolean
        message?: string
        error?: string
      }>('/api/beneficiaries', {
        method: 'POST',
        body: JSON.stringify({
          account_number: accountNumber,
          ifsc_code: ifscCode,
          account_holder_name: verificationResult?.account_holder_name || accountHolderName || 'Account Holder',
          bank_id: selectedBank.id,
          bank_name: selectedBank.bankName,
          beneficiary_mobile: beneficiaryMobile,
          is_default: savedBeneficiaries.length === 0, // First one is default
          user_id: user.partner_id,
        }),
      })
      
      if (result.success) {
        setInfoMessage('Beneficiary saved successfully!')
        fetchSavedBeneficiaries()
        setTimeout(() => setInfoMessage(null), 3000)
      } else {
        setError(result.error || 'Failed to save beneficiary')
      }
    } catch (err: any) {
      console.error('Error saving beneficiary:', err)
      // Try to extract the actual error message from the response
      let errorMessage = 'Failed to save beneficiary'
      if (err.message && err.message !== 'Server error, please try again later') {
        errorMessage = err.message
      } else if (err.error) {
        errorMessage = err.error
      } else if (typeof err === 'string') {
        errorMessage = err
      }
      setError(errorMessage)
    } finally {
      setSavingBeneficiary(false)
    }
  }

  // Select saved beneficiary
  const selectSavedBeneficiary = (beneficiary: SavedBeneficiary) => {
    setAccountNumber(beneficiary.account_number)
    setConfirmAccountNumber(beneficiary.account_number)
    setIfscCode(beneficiary.ifsc_code)
    setAccountHolderName(beneficiary.account_holder_name)
    setBeneficiaryMobile(beneficiary.beneficiary_mobile || '')
    setBankSearchQuery(beneficiary.bank_name) // Set bank search query to show bank name
    
    // Find and select the matching bank from bank list
    const matchingBank = banks.find(b => 
      b.bankName.toLowerCase() === beneficiary.bank_name.toLowerCase() ||
      (beneficiary.bank_id && b.id === beneficiary.bank_id)
    )
    
    if (matchingBank) {
      setSelectedBank(matchingBank)
    } else {
      // Try to find bank by partial name match (e.g., "ICICI BANK LTD." matches "ICICI BANK")
      const partialMatch = banks.find(b => 
        b.bankName.toLowerCase().includes(beneficiary.bank_name.toLowerCase().split(' ')[0]) ||
        beneficiary.bank_name.toLowerCase().includes(b.bankName.toLowerCase().split(' ')[0])
      )
      
      if (partialMatch) {
        setSelectedBank(partialMatch)
      } else {
        // Create a pseudo-bank entry with a fallback ID (use 1 as default for IMPS-enabled bank)
        // Note: The actual transfer will use bankName for SparkUp API
        setSelectedBank({
          id: beneficiary.bank_id || 1, // Use 1 instead of 0 to pass validation
          bankName: beneficiary.bank_name,
          code: '',
          ifsc: beneficiary.ifsc_code,
          isIMPS: true,
          isNEFT: true,
          isACVerification: true,
          isPopular: false,
        })
      }
    }
    
    setShowSavedBeneficiaries(false)
    setShowNewAccountForm(false) // Hide new account form when selecting saved beneficiary
    setVerified(true)
    setVerificationResult({
      account_holder_name: beneficiary.account_holder_name,
      bank_name: beneficiary.bank_name,
      is_valid: true,
      is_saved_account: true, // Mark as saved account (not freshly verified)
    })
    setStep('verify')
  }

  // Re-verify saved beneficiary account (local validation only - SparkupX not available)
  const handleReVerifyAccount = async () => {
    setError(null)
    
    if (!accountNumber || !ifscCode) {
      setError('Account details are missing')
      return
    }

    // Require account holder name
    if (!accountHolderName || accountHolderName.trim().length < 2) {
      setError('Please enter the account holder name')
      return
    }
    
    setVerifying(true)
    try {
      // Normalize account number and IFSC (remove spaces)
      const normalizedAccountNumber = accountNumber.replace(/\s+/g, '').trim()
      const normalizedIfsc = ifscCode.replace(/\s+/g, '').trim().toUpperCase()
      
      const result = await apiFetchJson<{
        success: boolean
        is_valid?: boolean
        account_holder_name?: string
        bank_name?: string
        verification_charges?: number
        transaction_id?: string
        sparkup_transaction_id?: string
        message?: string
        error?: string
      }>('/api/payout/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountNumber: normalizedAccountNumber,
          ifscCode: normalizedIfsc,
          bankName: selectedBank?.bankName,
          bankId: selectedBank?.id, // Include bankId for better accuracy
          user_id: user?.partner_id, // Fallback auth
        }),
      })
      
      if (result.success && result.is_valid) {
        setVerified(true)
        setVerificationResult({
          account_holder_name: result.account_holder_name || accountHolderName, // Use user-entered name if not from API
          bank_name: result.bank_name,
          is_valid: result.is_valid,
          is_saved_account: false,
        })
        // Update account holder name with the verified name from bank (if provided)
        if (result.account_holder_name) {
          setAccountHolderName(result.account_holder_name)
        }
        
        // Refresh wallet balance after verification (only if charges were deducted)
        if (result.verification_charges && result.verification_charges > 0) {
          await fetchWalletBalance()
        }
        
        // Show success message
        const chargesMsg = result.verification_charges && result.verification_charges > 0
          ? ` ₹${result.verification_charges} charges deducted.`
          : ''
        setInfoMessage(result.message || `Account format validated!${chargesMsg}`)
      } else {
        setError(result.error || 'Account verification failed')
        await fetchWalletBalance()
      }
    } catch (err: any) {
      setError(err.message || 'Account verification failed')
      // Refresh wallet balance on error
      await fetchWalletBalance()
    } finally {
      setVerifying(false)
    }
  }

  // Delete saved beneficiary
  const deleteSavedBeneficiary = async (id: string) => {
    if (!user?.partner_id) return
    
    if (!confirm('Are you sure you want to delete this saved account?')) return
    
    try {
      const result = await apiFetchJson<{
        success: boolean
        error?: string
      }>(`/api/beneficiaries?id=${id}&user_id=${user.partner_id}`, {
        method: 'DELETE',
      })
      
      if (result.success) {
        fetchSavedBeneficiaries()
      }
    } catch (err) {
      console.error('Error deleting beneficiary:', err)
    }
  }

  // Initial load
  useEffect(() => {
    fetchWalletBalance()
    fetchBanks()
    fetchRecentTransactions()
    fetchSavedBeneficiaries()
    
    const interval = setInterval(fetchWalletBalance, 15000)
    return () => clearInterval(interval)
  }, [fetchWalletBalance, fetchBanks, fetchRecentTransactions, fetchSavedBeneficiaries])

  // Auto-poll disabled - user can manually check status via "Check Status" button
  // This prevents unnecessary spinning animations and API calls
  // Status will be updated when user clicks "Check Status" or views "Recent Transfers"
  useEffect(() => {
    if (step !== 'result' || !transferResult?.id) return
    
    const currentStatus = transferResult.status?.toUpperCase()
    // Only do a single status check after 3 seconds for processing transactions
    if (!['PENDING', 'PROCESSING'].includes(currentStatus)) return
    
    // Do ONE status check after 3 seconds, no continuous polling
    const timer = setTimeout(async () => {
      await pollTransactionStatus(transferResult.id)
      fetchRecentTransactions()
    }, 3000)
    
    return () => clearTimeout(timer)
  }, [step, transferResult?.id, transferResult?.status, pollTransactionStatus, fetchRecentTransactions])

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

  // Auto-fill IFSC prefix when bank is selected (only for new accounts, not saved beneficiaries)
  // The user must complete the full 11-character IFSC code
  useEffect(() => {
    if (selectedBank?.ifsc && !ifscCode) {
      // Only set prefix if IFSC is empty (new account entry)
      // Format: First 4 chars (bank code) + "0" as placeholder, user must complete the rest
      setIfscCode(selectedBank.ifsc.substring(0, 4) + '0')
    }
  }, [selectedBank, ifscCode])

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
    
    // Normalize IFSC code (uppercase, remove spaces)
    const normalizedIfsc = ifscCode?.replace(/\s+/g, '').trim().toUpperCase() || ''
    if (!normalizedIfsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
      setError('Please enter a valid IFSC code (e.g., SBIN0001234)')
      return
    }

    if (!beneficiaryMobile || !/^[6-9]\d{9}$/.test(beneficiaryMobile)) {
      setError('Please enter a valid 10-digit beneficiary mobile number')
      return
    }

    // Require account holder name to be entered manually (since SparkupX verification is not available)
    if (!accountHolderName || accountHolderName.trim().length < 2) {
      setError('Please enter the account holder name (required for transfer)')
      return
    }
    
    setVerifying(true)
    try {
      // Normalize account number (remove spaces)
      const normalizedAccountNumber = accountNumber.replace(/\s+/g, '').trim()
      
      const result = await apiFetchJson<{
        success: boolean
        is_valid?: boolean
        account_holder_name?: string
        bank_name?: string
        verification_charges?: number
        transaction_id?: string
        sparkup_transaction_id?: string
        message?: string
        error?: string
      }>('/api/payout/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountNumber: normalizedAccountNumber,
          ifscCode: normalizedIfsc,
          bankName: selectedBank?.bankName,
          bankId: selectedBank?.id, // Include bankId for SparkupX API
          user_id: user?.partner_id, // Fallback auth
        }),
      })
      
      if (result.success && result.is_valid) {
        setVerified(true)
        setVerificationResult({
          account_holder_name: result.account_holder_name || accountHolderName, // Use user-entered name if not from API
          bank_name: result.bank_name,
          is_valid: result.is_valid,
          is_saved_account: false,
        })
        // Update account holder name with the verified name from bank (if provided)
        // If not provided, keep the user-entered name
        if (result.account_holder_name) {
          setAccountHolderName(result.account_holder_name)
        }
        setStep('verify')
        
        // Refresh wallet balance after verification (only if charges were deducted)
        if (result.verification_charges && result.verification_charges > 0) {
          await fetchWalletBalance()
        }
        
        // Show success message
        const chargesMsg = result.verification_charges && result.verification_charges > 0
          ? ` ₹${result.verification_charges} verification charges have been deducted from your wallet.`
          : ''
        setInfoMessage(result.message || `Account format validated!${chargesMsg} Please confirm the beneficiary name before proceeding.`)
      } else {
        setError(result.error || 'Account verification failed')
        setVerified(false)
        // Refresh wallet balance even on failure (charges may have been deducted)
        await fetchWalletBalance()
      }
    } catch (err: any) {
      setError(err.message || 'Account verification failed')
      setVerified(false)
      // Refresh wallet balance on error
      await fetchWalletBalance()
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
      console.error('Transfer error:', err)
      const errorMsg = err.message || 'Transfer failed'
      
      // Handle SparkupX timeout errors specifically
      if (errorMsg.includes('504') || errorMsg.includes('Gateway Time') || errorMsg.includes('timeout') || errorMsg.includes('SparkupX server timeout')) {
        setError('Transfer request timed out at SparkupX server. This does NOT mean the transfer failed - it may still be processing. Please check your transaction history in 2-3 minutes before retrying.')
      } else {
        setError(errorMsg)
      }
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
    // Reset to show saved accounts if available
    setShowNewAccountForm(savedBeneficiaries.length === 0)
  }

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'success': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
      case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
      case 'refunded': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300'
      case 'processing':
      case 'pending': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
      default: return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
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
              {/* Loading Beneficiaries */}
              {loadingBeneficiaries && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  <span className="ml-2 text-gray-600 dark:text-gray-400">Loading saved accounts...</span>
                </div>
              )}

              {/* Show Saved Accounts First - When there are saved beneficiaries and not showing new account form */}
              {!loadingBeneficiaries && savedBeneficiaries.length > 0 && !showNewAccountForm && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Select Account to Transfer</h3>
                    <button
                      onClick={() => setShowNewAccountForm(true)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Add New Account
                    </button>
                  </div>
                  
                  {/* Saved Accounts Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {savedBeneficiaries.map((beneficiary) => (
                      <div
                        key={beneficiary.id}
                        className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 cursor-pointer transition-all shadow-sm hover:shadow-md"
                        onClick={() => selectSavedBeneficiary(beneficiary)}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Building2 className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {beneficiary.bank_name}
                            </span>
                            {beneficiary.is_default && (
                              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                            )}
                          </div>
                          <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                            {beneficiary.account_holder_name}
                          </p>
                          <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">
                            ****{beneficiary.account_number.slice(-4)} • {beneficiary.ifsc_code}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <ArrowRight className="w-5 h-5 text-blue-500" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteSavedBeneficiary(beneficiary.id)
                            }}
                            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                            title="Delete this account"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* New Account Form - Show when there are no saved accounts OR user clicked "Add New" */}
              {!loadingBeneficiaries && (savedBeneficiaries.length === 0 || showNewAccountForm) && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Enter Bank Details</h3>
                    
                    {/* Back to Saved Accounts Button - Only show if there are saved beneficiaries */}
                    {savedBeneficiaries.length > 0 && (
                      <button
                        onClick={() => setShowNewAccountForm(false)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                      >
                        <BookUser className="w-4 h-4" />
                        Back to Saved Accounts
                      </button>
                    )}
                  </div>
              
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
                  <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredBanks.map(bank => (
                      <div
                        key={bank.id}
                        onMouseDown={(e) => {
                          e.preventDefault() // Prevent input blur before click registers
                          handleBankSelect(bank)
                        }}
                        className="w-full px-4 py-2 text-left hover:bg-blue-50 dark:hover:bg-gray-700 flex items-center justify-between cursor-pointer"
                      >
                        <span className="text-gray-900 dark:text-white">{bank.bankName}</span>
                        <div className="flex gap-1">
                          {bank.isIMPS && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">IMPS</span>}
                          {bank.isNEFT && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">NEFT</span>}
                        </div>
                      </div>
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

              {/* Account Holder Name - Manual Entry Required */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <User className="w-4 h-4 inline mr-2" />
                  Account Holder Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter account holder name as per bank records"
                  maxLength={100}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Enter the exact name as it appears in the bank account
                </p>
              </div>

              {/* Important Notice */}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Important: Verify Beneficiary Details
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                      Please ensure the account number and account holder name are correct. 
                      Transfers to wrong accounts cannot be reversed.
                    </p>
                  </div>
                </div>
              </div>

              {/* Verify Button */}
              <div className="flex justify-end pt-4">
                <button
                  onClick={handleVerifyAccount}
                  disabled={verifying || !accountNumber || !confirmAccountNumber || !ifscCode || accountNumber !== confirmAccountNumber || beneficiaryMobile.length !== 10 || !accountHolderName || accountHolderName.trim().length < 2}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {verifying ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Validate & Proceed
                    </>
                  )}
                </button>
              </div>
                </>
              )}
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
                {/* Show different message based on whether account was freshly verified or loaded from saved */}
                {verificationResult?.is_saved_account ? (
                  <div className="mb-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm text-yellow-700 dark:text-yellow-400">
                          <strong>Using saved account details.</strong> To verify account holder name with bank, click Re-verify (₹4 charges).
                        </p>
                      </div>
                      <button
                        onClick={handleReVerifyAccount}
                        disabled={verifying || walletBalance < 4}
                        className="flex-shrink-0 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        {verifying ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Verifying...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-3.5 h-3.5" />
                            Re-verify (₹4)
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                    <p className="text-xs text-blue-700 dark:text-blue-400">
                      <strong>Note:</strong> ₹4 verification charges have been deducted from your wallet.
                    </p>
                  </div>
                )}
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
                
                {/* Save Account Button */}
                {!savedBeneficiaries.some(b => 
                  b.account_number === accountNumber && b.ifsc_code === ifscCode
                ) && (
                  <button
                    onClick={saveBeneficiary}
                    disabled={savingBeneficiary}
                    className="mt-3 flex items-center gap-2 px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                  >
                    {savingBeneficiary ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    Save this account for future transfers
                  </button>
                )}
                {savedBeneficiaries.some(b => 
                  b.account_number === accountNumber && b.ifsc_code === ifscCode
                ) && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <Check className="w-4 h-4 text-green-500" />
                    Account already saved
                  </div>
                )}
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
                'bg-blue-100 dark:bg-blue-900'
              }`}>
                {transferResult.status === 'SUCCESS' ? (
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                ) : transferResult.status === 'FAILED' ? (
                  <XCircle className="w-8 h-8 text-red-600" />
                ) : (
                  <CheckCircle2 className="w-8 h-8 text-blue-600" />
                )}
              </div>

              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {transferResult.status === 'SUCCESS' ? 'Transfer Successful!' :
                 transferResult.status === 'FAILED' ? 'Transfer Failed' :
                 'Transfer Submitted'}
              </h3>

              {/* Processing status indicator - clean static message */}
              {['PENDING', 'PROCESSING'].includes(transferResult.status) && (
                <div className="flex items-center justify-center gap-2 text-sm text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-lg">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Transfer submitted successfully. Amount has been debited from your wallet.</span>
                </div>
              )}

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
                    {transferResult.status === 'PROCESSING' || transferResult.status === 'PENDING' ? 'SUBMITTED' : transferResult.status}
                  </span>
                </div>
                {/* Only show failure reason for FAILED transactions, not for PENDING/PROCESSING */}
                {transferResult.failure_reason && transferResult.status === 'FAILED' && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Reason</span>
                    <span className="text-red-600 dark:text-red-400">{transferResult.failure_reason}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-3 justify-center">
                <button
                  onClick={handleReset}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition-colors"
                >
                  New Transfer
                </button>
                {['PENDING', 'PROCESSING'].includes(transferResult.status) && (
                  <button
                    onClick={() => pollTransactionStatus(transferResult.id)}
                    disabled={isPollingStatus}
                    className="px-6 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    <RefreshCw className={`w-4 h-4 ${isPollingStatus ? 'animate-spin' : ''}`} />
                    Check Status
                  </button>
                )}
              </div>
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

