'use client'

import { useState, useEffect } from 'react'
import { 
  Search, Loader2, CheckCircle, XCircle, Wallet, Receipt, 
  AlertCircle, RefreshCw, FileText, Clock, MessageSquare, History
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface BBPSBiller {
  biller_id: string
  biller_name: string
  category?: string
  category_name?: string
  biller_alias?: string
  is_active?: boolean
  params?: string[]
  amount_exactness?: 'EXACT' | 'INEXACT' | 'ANY'
  support_bill_fetch?: boolean
  support_partial_payment?: boolean
}

interface BillDetails {
  biller_id: string
  consumer_number: string
  bill_amount: number
  due_date?: string
  bill_date?: string
  bill_number?: string
  consumer_name?: string
  additional_info?: Record<string, any>
  reqId?: string
}

interface PaymentResult {
  success: boolean
  transaction_id?: string
  agent_transaction_id?: string
  bbps_transaction_id?: string
  status?: string
  payment_status?: string
  error_code?: string
  error_message?: string
  wallet_balance?: number
}

interface TransactionStatus {
  transaction_id: string
  status: string
  payment_status?: string
  amount?: number
  response_code?: string
  response_reason?: string
}

export default function BBPSPayment() {
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [loadingBalance, setLoadingBalance] = useState(true)
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [billers, setBillers] = useState<BBPSBiller[]>([])
  const [filteredBillers, setFilteredBillers] = useState<BBPSBiller[]>([])
  const [loadingBillers, setLoadingBillers] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBiller, setSelectedBiller] = useState<BBPSBiller | null>(null)
  const [consumerNumber, setConsumerNumber] = useState('')
  const [loadingBill, setLoadingBill] = useState(false)
  const [billDetails, setBillDetails] = useState<BillDetails | null>(null)
  const [paying, setPaying] = useState(false)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | null>(null)
  const [showComplaintForm, setShowComplaintForm] = useState(false)
  const [complaintDescription, setComplaintDescription] = useState('')
  const [submittingComplaint, setSubmittingComplaint] = useState(false)
  const [activeView, setActiveView] = useState<'payment' | 'history'>('payment')

  // Fetch wallet balance
  useEffect(() => {
    fetchWalletBalance()
  }, [])

  // Fetch categories
  useEffect(() => {
    fetchCategories()
  }, [])

  // Fetch billers when category changes
  useEffect(() => {
    if (selectedCategory) {
      fetchBillers(selectedCategory)
    }
  }, [selectedCategory])

  // Filter billers based on search
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredBillers(billers)
    } else {
      const query = searchQuery.toLowerCase()
      setFilteredBillers(
        billers.filter(
          (b) =>
            b.biller_name.toLowerCase().includes(query) ||
            b.biller_alias?.toLowerCase().includes(query) ||
            b.category_name?.toLowerCase().includes(query)
        )
      )
    }
  }, [searchQuery, billers])

  const fetchWalletBalance = async () => {
    try {
      setLoadingBalance(true)
      const response = await fetch('/api/wallet/balance')
      const data = await response.json()
      if (data.success) {
        setWalletBalance(data.balance)
      }
    } catch (error: any) {
      console.error('Error fetching wallet balance:', error)
    } finally {
      setLoadingBalance(false)
    }
  }

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/bbps/categories')
      const data = await response.json()
      if (data.success) {
        const cats = data.categories || []
        setCategories(cats)
        if (cats.length > 0 && !selectedCategory) {
          setSelectedCategory(cats[0])
        }
      } else {
        setError(data.error || 'Failed to fetch categories')
      }
    } catch (error: any) {
      console.error('Error fetching categories:', error)
      setError(error.message || 'Failed to fetch categories')
    }
  }

  const fetchBillers = async (category?: string) => {
    if (!category) {
      setBillers([])
      setFilteredBillers([])
      return
    }

    try {
      setLoadingBillers(true)
      setError(null)
      const url = `/api/bbps/billers?category=${encodeURIComponent(category)}`
      const response = await fetch(url)
      const data = await response.json()
      
      if (data.success) {
        const billersList = data.billers || []
        setBillers(billersList)
        setFilteredBillers(billersList)
        
        if (billersList.length === 0) {
          setError(`No billers found for category: ${category}`)
        }
      } else {
        setError(data.error || 'Failed to fetch billers')
      }
    } catch (error: any) {
      console.error('Error fetching billers:', error)
      setError(error.message || 'Failed to fetch billers. Please check your API credentials and network connection.')
    } finally {
      setLoadingBillers(false)
    }
  }

  const fetchBill = async () => {
    if (!selectedBiller || !consumerNumber.trim()) {
      setError('Please select a biller and enter consumer number')
      return
    }

    try {
      setLoadingBill(true)
      setError(null)
      setBillDetails(null)
      setPaymentResult(null)
      setTransactionStatus(null)

      const response = await fetch('/api/bbps/bill/fetch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          biller_id: selectedBiller.biller_id,
          consumer_number: consumerNumber.trim(),
        }),
      })

      const data = await response.json()
      if (data.success && data.bill) {
        setBillDetails(data.bill)
      } else {
        setError(data.error || 'Failed to fetch bill details')
      }
    } catch (error: any) {
      console.error('Error fetching bill:', error)
      setError(error.message || 'Failed to fetch bill details')
    } finally {
      setLoadingBill(false)
    }
  }

  const payBill = async () => {
    if (!selectedBiller || !billDetails) {
      return
    }

    try {
      setPaying(true)
      setError(null)
      setPaymentResult(null)
      setTransactionStatus(null)

      const response = await fetch('/api/bbps/bill/pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          biller_id: selectedBiller.biller_id,
          biller_name: selectedBiller.biller_name,
          consumer_number: consumerNumber.trim(),
          amount: billDetails.bill_amount,
          consumer_name: billDetails.consumer_name,
          due_date: billDetails.due_date,
          bill_date: billDetails.bill_date,
          bill_number: billDetails.bill_number,
          additional_info: billDetails.additional_info,
        }),
      })

      const data = await response.json()
      setPaymentResult(data)
      
      if (data.success) {
        // Refresh wallet balance
        await fetchWalletBalance()
        // Auto-check transaction status after 2 seconds
        if (data.bbps_transaction_id) {
          setTimeout(() => {
            checkTransactionStatus(data.bbps_transaction_id)
          }, 2000)
        }
      }
    } catch (error: any) {
      console.error('Error paying bill:', error)
      setError(error.message || 'Payment failed')
    } finally {
      setPaying(false)
    }
  }

  const checkTransactionStatus = async (transactionId: string) => {
    if (!transactionId) return

    try {
      setCheckingStatus(true)
      setError(null)

      const response = await fetch('/api/bbps/transaction-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction_id: transactionId,
          track_type: 'TRANS_REF_ID',
        }),
      })

      const data = await response.json()
      if (data.success && data.status) {
        setTransactionStatus(data.status)
      } else {
        setError(data.error || 'Failed to check transaction status')
      }
    } catch (error: any) {
      console.error('Error checking transaction status:', error)
      setError(error.message || 'Failed to check transaction status')
    } finally {
      setCheckingStatus(false)
    }
  }

  const registerComplaint = async () => {
    if (!paymentResult?.bbps_transaction_id || !complaintDescription.trim()) {
      setError('Please enter a complaint description')
      return
    }

    try {
      setSubmittingComplaint(true)
      setError(null)

      const response = await fetch('/api/bbps/complaint/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction_id: paymentResult.bbps_transaction_id,
          complaint_type: 'Transaction',
          description: complaintDescription.trim(),
          complaint_disposition: 'Amount deducted multiple times',
        }),
      })

      const data = await response.json()
      if (data.success) {
        setError(null)
        setShowComplaintForm(false)
        setComplaintDescription('')
        alert(`Complaint registered successfully! Complaint ID: ${data.complaint_id}`)
      } else {
        setError(data.error || 'Failed to register complaint')
      }
    } catch (error: any) {
      console.error('Error registering complaint:', error)
      setError(error.message || 'Failed to register complaint')
    } finally {
      setSubmittingComplaint(false)
    }
  }

  const resetForm = () => {
    setSelectedBiller(null)
    setConsumerNumber('')
    setBillDetails(null)
    setPaymentResult(null)
    setTransactionStatus(null)
    setError(null)
    setShowComplaintForm(false)
    setComplaintDescription('')
  }

  return (
    <div className="space-y-4">
      {/* View Toggle */}
      <div className="flex gap-2 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-1">
        <button
          onClick={() => setActiveView('payment')}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === 'payment'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          <Receipt className="w-4 h-4 inline mr-2" />
          Make Payment
        </button>
        <button
          onClick={() => setActiveView('history')}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === 'history'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          <History className="w-4 h-4 inline mr-2" />
          Transaction History
        </button>
      </div>

      {activeView === 'payment' ? (
        <>
          {/* Wallet Balance Card */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm font-medium mb-1">Wallet Balance</p>
                {loadingBalance ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-2xl font-bold">Loading...</span>
                  </div>
                ) : (
                  <p className="text-3xl font-bold">
                    ₹{walletBalance?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                  </p>
                )}
              </div>
              <button
                onClick={fetchWalletBalance}
                className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                title="Refresh balance"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>
          </motion.div>

          {/* Error Message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-800 dark:text-red-200">Error</p>
                  <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
                </div>
                <button
                  onClick={() => setError(null)}
                  className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Payment Result */}
          <AnimatePresence>
            {paymentResult && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`rounded-lg p-4 border ${
                  paymentResult.success
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                }`}
              >
                <div className="flex items-start gap-3">
                  {paymentResult.success ? (
                    <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${paymentResult.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                      {paymentResult.success ? 'Payment Successful' : 'Payment Failed'}
                    </p>
                    {paymentResult.success && (
                      <div className="mt-2 space-y-1 text-sm text-green-700 dark:text-green-300">
                        <p><strong>Transaction ID:</strong> {paymentResult.agent_transaction_id}</p>
                        {paymentResult.bbps_transaction_id && (
                          <p><strong>BBPS Transaction:</strong> {paymentResult.bbps_transaction_id}</p>
                        )}
                        {paymentResult.wallet_balance !== undefined && (
                          <p><strong>New Balance:</strong> ₹{paymentResult.wallet_balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        )}
                      </div>
                    )}
                    {paymentResult.error_message && (
                      <p className="text-sm text-red-700 dark:text-red-300 mt-1">{paymentResult.error_message}</p>
                    )}
                    {paymentResult.success && paymentResult.bbps_transaction_id && (
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => checkTransactionStatus(paymentResult.bbps_transaction_id!)}
                          disabled={checkingStatus}
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-1"
                        >
                          {checkingStatus ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Check Status
                        </button>
                        <button
                          onClick={() => setShowComplaintForm(true)}
                          className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded hover:bg-orange-700 flex items-center gap-1"
                        >
                          <MessageSquare className="w-3 h-3" />
                          Register Complaint
                        </button>
                        <button
                          onClick={resetForm}
                          className="px-3 py-1.5 text-xs bg-gray-600 text-white rounded hover:bg-gray-700"
                        >
                          New Payment
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Transaction Status */}
          <AnimatePresence>
            {transactionStatus && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4"
              >
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Transaction Status</p>
                    <div className="mt-2 space-y-1 text-sm text-blue-700 dark:text-blue-300">
                      <p><strong>Status:</strong> {transactionStatus.status}</p>
                      {transactionStatus.payment_status && (
                        <p><strong>Payment Status:</strong> {transactionStatus.payment_status}</p>
                      )}
                      {transactionStatus.response_code && (
                        <p><strong>Response Code:</strong> {transactionStatus.response_code}</p>
                      )}
                      {transactionStatus.response_reason && (
                        <p><strong>Reason:</strong> {transactionStatus.response_reason}</p>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Complaint Form */}
          <AnimatePresence>
            {showComplaintForm && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4"
              >
                <h4 className="text-sm font-medium text-orange-800 dark:text-orange-200 mb-3">Register Complaint</h4>
                <textarea
                  value={complaintDescription}
                  onChange={(e) => setComplaintDescription(e.target.value)}
                  placeholder="Describe your complaint..."
                  className="w-full px-3 py-2 border border-orange-300 dark:border-orange-700 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-3"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    onClick={registerComplaint}
                    disabled={submittingComplaint || !complaintDescription.trim()}
                    className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-gray-400 flex items-center gap-2"
                  >
                    {submittingComplaint ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <MessageSquare className="w-4 h-4" />
                    )}
                    Submit Complaint
                  </button>
                  <button
                    onClick={() => {
                      setShowComplaintForm(false)
                      setComplaintDescription('')
                    }}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Biller Selection */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Select Biller</h3>
            
            {/* Category Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Select Category *
              </label>
              {categories.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400 py-2">Loading categories...</div>
              ) : (
                <select
                  value={selectedCategory}
                  onChange={(e) => {
                    setSelectedCategory(e.target.value)
                    setSelectedBiller(null)
                    setBillDetails(null)
                    setPaymentResult(null)
                    setError(null)
                    setBillers([])
                    setFilteredBillers([])
                  }}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a category...</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              )}
            </div>
            
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search billers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Billers List */}
            {!selectedCategory ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                Please select a category to view billers
              </div>
            ) : loadingBillers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                <span className="ml-2 text-gray-600 dark:text-gray-400">Loading billers...</span>
              </div>
            ) : filteredBillers.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                {searchQuery ? 'No billers found matching your search' : 'No billers available for this category'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
                {filteredBillers.map((biller) => (
                  <button
                    key={biller.biller_id}
                    onClick={() => {
                      setSelectedBiller(biller)
                      setBillDetails(null)
                      setPaymentResult(null)
                      setError(null)
                    }}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      selectedBiller?.biller_id === biller.biller_id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <p className="font-medium text-gray-900 dark:text-white">{biller.biller_name}</p>
                    {biller.category_name && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{biller.category_name}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Consumer Number Input */}
          {selectedBiller && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4"
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Enter Consumer Details</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Consumer Number *
                  </label>
                  <input
                    type="text"
                    value={consumerNumber}
                    onChange={(e) => setConsumerNumber(e.target.value)}
                    placeholder="Enter consumer number"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={fetchBill}
                  disabled={!consumerNumber.trim() || loadingBill}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loadingBill ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Fetching Bill...
                    </>
                  ) : (
                    <>
                      <Receipt className="w-4 h-4" />
                      Fetch Bill Details
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* Bill Details */}
          {billDetails && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4"
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Bill Details</h3>
              <div className="space-y-3">
                {billDetails.consumer_name && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Consumer Name:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{billDetails.consumer_name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Consumer Number:</span>
                  <span className="font-medium text-gray-900 dark:text-white">{billDetails.consumer_number}</span>
                </div>
                {billDetails.bill_number && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Bill Number:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{billDetails.bill_number}</span>
                  </div>
                )}
                {billDetails.due_date && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Due Date:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {new Date(billDetails.due_date).toLocaleDateString('en-IN')}
                    </span>
                  </div>
                )}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-medium text-gray-900 dark:text-white">Amount to Pay:</span>
                    <span className="text-2xl font-bold text-green-600 dark:text-green-400">
                      ₹{billDetails.bill_amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
                <button
                  onClick={payBill}
                  disabled={paying || (walletBalance !== null && walletBalance < billDetails.bill_amount)}
                  className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-semibold mt-4"
                >
                  {paying ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing Payment...
                    </>
                  ) : walletBalance !== null && walletBalance < billDetails.bill_amount ? (
                    <>
                      <AlertCircle className="w-5 h-5" />
                      Insufficient Balance
                    </>
                  ) : (
                    <>
                      <Wallet className="w-5 h-5" />
                      Pay Bill
                    </>
                  )}
                </button>
                {walletBalance !== null && walletBalance < billDetails.bill_amount && (
                  <p className="text-sm text-red-600 dark:text-red-400 text-center mt-2">
                    Required: ₹{billDetails.bill_amount.toLocaleString('en-IN')} | Available: ₹{walletBalance.toLocaleString('en-IN')}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Transaction History</h3>
          <p className="text-gray-600 dark:text-gray-400 text-center py-8">
            Transaction history feature coming soon...
          </p>
        </div>
      )}
    </div>
  )
}
