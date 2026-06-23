'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CreditCard, Search, ArrowLeft, Loader2, CheckCircle2, AlertCircle, Receipt } from 'lucide-react'
import { apiFetchJson } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'

interface Biller {
  product_code: string
  product_name: string
  service_id: string
}

interface BillData {
  customer_name: string
  amount: string
  bill_period?: string
  bill_date?: string
  bill_due_date?: string
  bill_number?: string
  billDate?: string
  dueDate?: string
  'Minimum Amount Due'?: string
  'Maximum Permissible Amount'?: string
}

type Step = 'select-biller' | 'enter-details' | 'bill-fetched' | 'payment-result'

export default function Pay2NewCCPayment() {
  const { user } = useAuth()
  const { showToast } = useToast()

  const [billers, setBillers] = useState<Biller[]>([])
  const [billersLoading, setBillersLoading] = useState(true)
  const [billersError, setBillersError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [step, setStep] = useState<Step>('select-biller')
  const [selectedBiller, setSelectedBiller] = useState<Biller | null>(null)

  // Bill fetch fields
  const [cardLast4, setCardLast4] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
  const [fetchLoading, setFetchLoading] = useState(false)
  const [billData, setBillData] = useState<BillData | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Bill payment fields
  const [payAmount, setPayAmount] = useState('')
  const [payLoading, setPayLoading] = useState(false)
  const [payResult, setPayResult] = useState<{
    success: boolean
    order_id?: string
    operator_reference?: string
    amount?: number | string
    balance?: string
    error?: string
  } | null>(null)

  useEffect(() => {
    fetchBillers()
  }, [])

  const fetchBillers = async () => {
    setBillersLoading(true)
    setBillersError(null)
    try {
      const data = await apiFetchJson('/api/pay2new/billers')
      if (data.success) {
        setBillers(data.billers || [])
      } else {
        setBillersError(data.error || 'Failed to fetch billers')
      }
    } catch (e: any) {
      setBillersError(e.message || 'Failed to fetch billers')
    } finally {
      setBillersLoading(false)
    }
  }

  const filteredBillers = useMemo(() => {
    if (!search.trim()) return billers
    const q = search.toLowerCase()
    return billers.filter((b) => b.product_name.toLowerCase().includes(q))
  }, [billers, search])

  const handleSelectBiller = (biller: Biller) => {
    setSelectedBiller(biller)
    setStep('enter-details')
    setCardLast4('')
    setMobileNumber('')
    setBillData(null)
    setOrderId(null)
    setFetchError(null)
    setPayResult(null)
  }

  const handleFetchBill = async () => {
    if (!selectedBiller || !cardLast4) return
    if (cardLast4.length !== 4) {
      setFetchError('Please enter exactly 4 digits')
      return
    }

    setFetchLoading(true)
    setFetchError(null)
    setBillData(null)

    try {
      const data = await apiFetchJson('/api/pay2new/bill/fetch', {
        method: 'POST',
        body: JSON.stringify({
          number: cardLast4,
          product_code: selectedBiller.product_code,
          optional1: mobileNumber || '',
          customer_number: mobileNumber || user?.phone || '',
          user_id: user?.id,
        }),
      })

      if (data.success && data.data && !Array.isArray(data.data)) {
        setBillData(data.data)
        setOrderId(data.order_id)
        setPayAmount(data.data.amount || '')
        setStep('bill-fetched')
      } else {
        setFetchError(data.error || 'Failed to fetch bill details')
      }
    } catch (e: any) {
      setFetchError(e.message || 'Bill fetch failed')
    } finally {
      setFetchLoading(false)
    }
  }

  const handlePayBill = async () => {
    if (!selectedBiller || !orderId || !payAmount) return
    const amount = parseFloat(payAmount)
    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid amount', 'error')
      return
    }

    setPayLoading(true)
    try {
      const data = await apiFetchJson('/api/pay2new/bill/pay', {
        method: 'POST',
        body: JSON.stringify({
          number: cardLast4,
          amount,
          product_code: selectedBiller.product_code,
          bill_fetch_ref: orderId,
          optional1: mobileNumber || '',
          customer_number: mobileNumber || user?.phone || '',
          user_id: user?.id,
        }),
      })

      setPayResult(data)
      setStep('payment-result')

      if (data.success) {
        showToast('Payment successful!', 'success')
      } else {
        showToast(data.error || 'Payment failed', 'error')
      }
    } catch (e: any) {
      setPayResult({ success: false, error: e.message || 'Payment failed' })
      setStep('payment-result')
      showToast(e.message || 'Payment failed', 'error')
    } finally {
      setPayLoading(false)
    }
  }

  const resetFlow = () => {
    setStep('select-biller')
    setSelectedBiller(null)
    setCardLast4('')
    setMobileNumber('')
    setBillData(null)
    setOrderId(null)
    setFetchError(null)
    setPayResult(null)
    setPayAmount('')
  }

  const dueDate = billData?.dueDate || billData?.bill_due_date
  const billDate = billData?.billDate || billData?.bill_date
  const minDue = billData?.['Minimum Amount Due']
  const maxPermissible = billData?.['Maximum Permissible Amount']

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        {step !== 'select-biller' && (
          <button
            onClick={step === 'payment-result' ? resetFlow : () => setStep(step === 'bill-fetched' ? 'enter-details' : 'select-biller')}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {step === 'select-biller' && 'Credit Card Bill Payment'}
            {step === 'enter-details' && selectedBiller?.product_name}
            {step === 'bill-fetched' && 'Bill Details'}
            {step === 'payment-result' && 'Payment Result'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {step === 'select-biller' && 'Select your credit card issuer'}
            {step === 'enter-details' && 'Enter card details to fetch bill'}
            {step === 'bill-fetched' && `${selectedBiller?.product_name}`}
            {step === 'payment-result' && `${selectedBiller?.product_name}`}
          </p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Select Biller */}
        {step === 'select-biller' && (
          <motion.div key="billers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search credit card issuer..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {billersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                  <span className="ml-2 text-gray-500">Loading billers...</span>
                </div>
              ) : billersError ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                  <p className="text-red-500 text-sm">{billersError}</p>
                  <button onClick={fetchBillers} className="mt-3 text-sm text-blue-500 hover:underline">
                    Retry
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[500px] overflow-y-auto">
                  {filteredBillers.map((biller) => (
                    <button
                      key={biller.product_code}
                      onClick={() => handleSelectBiller(biller)}
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-left"
                    >
                      <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                        <CreditCard className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{biller.product_name}</p>
                        <p className="text-xs text-gray-500">Code: {biller.product_code}</p>
                      </div>
                    </button>
                  ))}
                  {filteredBillers.length === 0 && (
                    <p className="col-span-full text-center text-gray-400 py-8">No billers found</p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Step 2: Enter Details */}
        {step === 'enter-details' && (
          <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-6 max-w-md">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Last 4 Digits of Credit Card *
                  </label>
                  <input
                    type="text"
                    maxLength={4}
                    placeholder="e.g. 1266"
                    value={cardLast4}
                    onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Registered Mobile Number (Optional)
                  </label>
                  <input
                    type="tel"
                    maxLength={10}
                    placeholder="e.g. 9876543210"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {fetchError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                    <p className="text-sm text-red-600 dark:text-red-400">{fetchError}</p>
                  </div>
                )}

                <button
                  onClick={handleFetchBill}
                  disabled={fetchLoading || cardLast4.length !== 4}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg font-medium text-sm hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {fetchLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Fetching Bill...
                    </>
                  ) : (
                    <>
                      <Receipt className="w-4 h-4" />
                      Fetch Bill
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Step 3: Bill Fetched */}
        {step === 'bill-fetched' && billData && (
          <motion.div key="bill" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-6 max-w-lg">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">Bill Found</span>
                </div>

                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Customer Name</span>
                    <span className="text-sm font-medium">{billData.customer_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Total Amount Due</span>
                    <span className="text-lg font-bold text-red-600">₹{parseFloat(billData.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {minDue && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-500">Minimum Due</span>
                      <span className="text-sm font-medium">₹{parseFloat(minDue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {maxPermissible && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-500">Max Permissible</span>
                      <span className="text-sm font-medium">₹{parseFloat(maxPermissible).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {billDate && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-500">Bill Date</span>
                      <span className="text-sm">{billDate}</span>
                    </div>
                  )}
                  {dueDate && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-500">Due Date</span>
                      <span className="text-sm font-medium text-orange-600">{dueDate}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Payment Amount (₹) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="Enter amount"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex gap-2 mt-2">
                    {minDue && (
                      <button
                        onClick={() => setPayAmount(minDue)}
                        className="text-xs px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 hover:bg-blue-200"
                      >
                        Min Due: ₹{parseFloat(minDue).toLocaleString('en-IN')}
                      </button>
                    )}
                    <button
                      onClick={() => setPayAmount(billData.amount)}
                      className="text-xs px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 hover:bg-green-200"
                    >
                      Full: ₹{parseFloat(billData.amount).toLocaleString('en-IN')}
                    </button>
                  </div>
                </div>

                <button
                  onClick={handlePayBill}
                  disabled={payLoading || !payAmount || parseFloat(payAmount) <= 0}
                  className="w-full py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg font-medium text-sm hover:from-green-700 hover:to-green-800 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {payLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing Payment...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" />
                      Pay ₹{payAmount ? parseFloat(payAmount).toLocaleString('en-IN') : '0'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Step 4: Payment Result */}
        {step === 'payment-result' && payResult && (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-md border p-6 max-w-lg ${
              payResult.success ? 'border-green-200 dark:border-green-800' : 'border-red-200 dark:border-red-800'
            }`}>
              <div className="text-center space-y-4">
                {payResult.success ? (
                  <>
                    <div className="w-16 h-16 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="w-10 h-10 text-green-600" />
                    </div>
                    <h3 className="text-xl font-bold text-green-600">Payment Successful!</h3>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 mx-auto bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                      <AlertCircle className="w-10 h-10 text-red-600" />
                    </div>
                    <h3 className="text-xl font-bold text-red-600">Payment Failed</h3>
                    <p className="text-sm text-red-500">{payResult.error}</p>
                  </>
                )}

                {payResult.success && (
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-left space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-500">Amount Paid</span>
                      <span className="font-bold text-green-600">₹{payResult.amount}</span>
                    </div>
                    {payResult.order_id && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">Pay2New Order ID</span>
                        <span className="text-sm font-mono">{payResult.order_id}</span>
                      </div>
                    )}
                    {payResult.operator_reference && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">Operator Reference</span>
                        <span className="text-sm font-mono">{payResult.operator_reference}</span>
                      </div>
                    )}
                    {payResult.balance && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">Pay2New Balance</span>
                        <span className="text-sm">₹{payResult.balance}</span>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={resetFlow}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg font-medium text-sm hover:from-blue-700 hover:to-blue-800"
                >
                  Make Another Payment
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
