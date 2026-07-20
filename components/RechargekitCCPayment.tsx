'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CreditCard, Search, ArrowLeft, Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import { apiFetchJson } from '@/lib/api-client'
import { useToast } from '@/components/Toast'

interface Operator {
  operator_id: string
  operator_name: string
  operator_code?: string
  operator_ifsc?: string
}

type Step = 'select-operator' | 'enter-details' | 'payment-result'

export default function RechargekitCCPayment() {
  const { showToast } = useToast()

  const [operators, setOperators] = useState<Operator[]>([])
  const [operatorsLoading, setOperatorsLoading] = useState(true)
  const [operatorsError, setOperatorsError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [step, setStep] = useState<Step>('select-operator')
  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(null)

  const [accountNo, setAccountNo] = useState('')
  const [mobileNo, setMobileNo] = useState('')
  const [beneficiaryName, setBeneficiaryName] = useState('')
  const [bankName, setBankName] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [tpin, setTpin] = useState('')
  const [payLoading, setPayLoading] = useState(false)
  const [payResult, setPayResult] = useState<{
    success: boolean
    pending?: boolean
    order_id?: string
    operator_reference?: string
    amount?: number | string
    charge?: number
    request_id?: string
    message?: string
    error?: string
  } | null>(null)

  const [chargesData, setChargesData] = useState<{
    base_charge: number
    gst_percent: number
    gst_amount: number
    total_charge: number
  } | null>(null)
  const [loadingCharges, setLoadingCharges] = useState(false)

  useEffect(() => {
    fetchOperators()
  }, [])

  useEffect(() => {
    const amountNum = parseFloat(payAmount)
    if (!amountNum || amountNum <= 0 || step !== 'enter-details') {
      setChargesData(null)
      return
    }

    const timer = setTimeout(async () => {
      setLoadingCharges(true)
      try {
        const data = await apiFetchJson(`/api/rechargekit/charges?amount=${amountNum}`)
        if (data.success && data.charges) {
          setChargesData(data.charges)
        } else {
          setChargesData(null)
        }
      } catch {
        setChargesData(null)
      } finally {
        setLoadingCharges(false)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [payAmount, step])

  const fetchOperators = async () => {
    setOperatorsLoading(true)
    setOperatorsError(null)
    try {
      const data = await apiFetchJson('/api/rechargekit/operators')
      if (data.success) {
        setOperators(data.operators || [])
      } else {
        setOperatorsError(data.error || 'Failed to fetch operators')
      }
    } catch (e: any) {
      setOperatorsError(e.message || 'Failed to fetch operators')
    } finally {
      setOperatorsLoading(false)
    }
  }

  const filteredOperators = useMemo(() => {
    if (!search.trim()) return operators
    const q = search.toLowerCase()
    return operators.filter((o) => o.operator_name.toLowerCase().includes(q))
  }, [operators, search])

  const handleSelectOperator = (op: Operator) => {
    setSelectedOperator(op)
    setBankName(op.operator_name)
    setIfsc(op.operator_ifsc?.trim() || '')
    setStep('enter-details')
    setAccountNo('')
    setMobileNo('')
    setBeneficiaryName('')
    setPayAmount('')
    setTpin('')
    setPayResult(null)
  }

  const handlePay = async () => {
    if (!selectedOperator) return

    const cardDigits = accountNo.replace(/\s+/g, '').replace(/\D/g, '')
    if (cardDigits.length < 12 || cardDigits.length > 19) {
      showToast('Enter a valid credit card number', 'error')
      return
    }
    if (!/^\d{10}$/.test(mobileNo.replace(/\D/g, ''))) {
      showToast('Enter a valid 10-digit mobile number', 'error')
      return
    }
    if (!beneficiaryName.trim()) {
      showToast('Enter card holder name', 'error')
      return
    }
    if (!bankName.trim()) {
      showToast('Enter bank name', 'error')
      return
    }
    const ifscCode = ifsc.trim().toUpperCase()
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      showToast('Enter a valid IFSC code', 'error')
      return
    }
    const amount = parseFloat(payAmount)
    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid amount', 'error')
      return
    }
    if (!tpin || tpin.length < 4) {
      showToast('T-PIN is required (4 digits)', 'error')
      return
    }

    setPayLoading(true)
    try {
      const data = await apiFetchJson('/api/rechargekit/pay', {
        method: 'POST',
        body: JSON.stringify({
          mobile_no: mobileNo.replace(/\D/g, ''),
          account_no: cardDigits,
          ifsc: ifscCode,
          bank_name: bankName.trim(),
          beneficiary_name: beneficiaryName.trim(),
          amount,
          operator_code: selectedOperator.operator_code || selectedOperator.operator_id,
          operator_name: selectedOperator.operator_name,
          tpin,
        }),
      })

      setPayResult(data)
      setStep('payment-result')

      if (data.success && data.pending) {
        showToast(data.message || 'Payment pending with provider', 'info')
      } else if (data.success) {
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
    setStep('select-operator')
    setSelectedOperator(null)
    setAccountNo('')
    setMobileNo('')
    setBeneficiaryName('')
    setBankName('')
    setIfsc('')
    setPayAmount('')
    setTpin('')
    setPayResult(null)
    setChargesData(null)
  }

  const totalPayable =
    payAmount && chargesData
      ? (parseFloat(payAmount) + chargesData.total_charge).toFixed(2)
      : null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {step !== 'select-operator' && (
          <button
            onClick={step === 'payment-result' ? resetFlow : () => setStep('select-operator')}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {step === 'select-operator' && 'Credit Card-2'}
              {step === 'enter-details' && selectedOperator?.operator_name}
              {step === 'payment-result' && 'Payment Result'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {step === 'select-operator' && 'Pay any credit card bill'}
              {step === 'enter-details' && 'Enter card & payment details'}
              {step === 'payment-result' && selectedOperator?.operator_name}
            </p>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {step === 'select-operator' && (
          <motion.div key="operators" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search operator..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              {operatorsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                  <span className="ml-2 text-gray-500">Loading operators...</span>
                </div>
              ) : operatorsError ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                  <p className="text-red-500 text-sm">{operatorsError}</p>
                  <button onClick={fetchOperators} className="mt-3 text-sm text-purple-500 hover:underline">
                    Retry
                  </button>
                </div>
              ) : filteredOperators.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">No operators found</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[500px] overflow-y-auto">
                  {filteredOperators.map((op) => (
                    <button
                      key={op.operator_id}
                      onClick={() => handleSelectOperator(op)}
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all text-left"
                    >
                      <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                        <CreditCard className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200 line-clamp-2">
                        {op.operator_name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {step === 'enter-details' && selectedOperator && (
          <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Credit Card Number *
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={accountNo}
                  onChange={(e) => setAccountNo(e.target.value.replace(/[^\d\s]/g, '').slice(0, 23))}
                  placeholder="Enter full card number"
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Mobile Number *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={mobileNo}
                    onChange={(e) => setMobileNo(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Card Holder Name *
                  </label>
                  <input
                    type="text"
                    value={beneficiaryName}
                    onChange={(e) => setBeneficiaryName(e.target.value)}
                    placeholder="Name on card"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Bank Name *
                  </label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="Bank name"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    CC IFSC Code *
                  </label>
                  <input
                    type="text"
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))}
                    placeholder="e.g. SBIN0001234"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-purple-500 uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Amount (₹) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="Enter amount"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    T-PIN *
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={tpin}
                    onChange={(e) => setTpin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="4-6 digit T-PIN"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              {(loadingCharges || chargesData) && (
                <div className="rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800 p-3 text-sm space-y-1">
                  {loadingCharges ? (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Loader2 className="w-4 h-4 animate-spin" /> Calculating charges...
                    </div>
                  ) : chargesData ? (
                    <>
                      <div className="flex justify-between text-gray-600 dark:text-gray-300">
                        <span>Service charge</span>
                        <span>₹{chargesData.base_charge.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-gray-600 dark:text-gray-300">
                        <span>GST ({chargesData.gst_percent}%)</span>
                        <span>₹{chargesData.gst_amount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-gray-900 dark:text-white pt-1 border-t border-purple-200 dark:border-purple-700">
                        <span>Total debit</span>
                        <span>₹{totalPayable}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              <button
                onClick={handlePay}
                disabled={payLoading}
                className="w-full py-3 rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-semibold text-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {payLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                  </>
                ) : (
                  <>Pay {totalPayable ? `₹${totalPayable}` : 'Now'}</>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {step === 'payment-result' && payResult && (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-6 text-center space-y-4">
              {payResult.success && payResult.pending ? (
                <Clock className="w-14 h-14 text-amber-500 mx-auto" />
              ) : payResult.success ? (
                <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
              ) : (
                <AlertCircle className="w-14 h-14 text-red-500 mx-auto" />
              )}

              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {payResult.success && payResult.pending
                    ? 'Payment Pending'
                    : payResult.success
                      ? 'Payment Successful'
                      : 'Payment Failed'}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {payResult.message || payResult.error || selectedOperator?.operator_name}
                </p>
              </div>

              {(payResult.order_id || payResult.request_id || payResult.operator_reference) && (
                <div className="text-left rounded-lg bg-gray-50 dark:bg-gray-700/50 p-4 text-sm space-y-2">
                  {payResult.request_id && (
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-500">Request ID</span>
                      <span className="font-mono text-gray-800 dark:text-gray-200">{payResult.request_id}</span>
                    </div>
                  )}
                  {payResult.order_id && (
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-500">Txn ID</span>
                      <span className="font-mono text-gray-800 dark:text-gray-200">{payResult.order_id}</span>
                    </div>
                  )}
                  {payResult.operator_reference && (
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-500">Operator Ref</span>
                      <span className="font-mono text-gray-800 dark:text-gray-200">{payResult.operator_reference}</span>
                    </div>
                  )}
                  {payResult.amount != null && (
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-500">Amount</span>
                      <span className="font-semibold">₹{payResult.amount}</span>
                    </div>
                  )}
                  {payResult.charge != null && (
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-500">Charge (incl. GST)</span>
                      <span>₹{payResult.charge}</span>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={resetFlow}
                className="w-full py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                New Payment
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
