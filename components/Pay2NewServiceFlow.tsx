'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, ArrowLeft, Loader2, CheckCircle2, AlertCircle, Receipt, Zap,
} from 'lucide-react'
import { apiFetchJson } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'

export interface Pay2NewServiceFlowProps {
  serviceId: number
  title: string
  subtitle?: string
  icon?: React.ReactNode
  /** 'bill' uses billFetch -> billPayment. 'recharge' goes straight to /apis/v1/recharge */
  mode: 'bill' | 'recharge'
  /** Label of the primary "number" input. e.g. "Mobile Number", "Consumer Number", "Last 4 Digits of Card" */
  numberLabel: string
  numberPlaceholder?: string
  numberMaxLength?: number
  numberDigitsOnly?: boolean
  /** Show optional secondary input (e.g. registered mobile for CC) */
  showOptional1?: boolean
  optional1Label?: string
  optional1Placeholder?: string
  /** Color theme accent (tailwind color name) */
  accent?: 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'red' | 'cyan' | 'indigo'
}

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

type BillStep = 'select-biller' | 'enter-details' | 'bill-fetched' | 'payment-result'
type RechargeStep = 'select-biller' | 'enter-details' | 'payment-result'

const ACCENT: Record<NonNullable<Pay2NewServiceFlowProps['accent']>, { bg: string; text: string; ring: string; grad: string }> = {
  blue:   { bg: 'bg-blue-100 dark:bg-blue-900/30',     text: 'text-blue-600 dark:text-blue-400',     ring: 'focus:ring-blue-500',     grad: 'from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800' },
  green:  { bg: 'bg-green-100 dark:bg-green-900/30',   text: 'text-green-600 dark:text-green-400',   ring: 'focus:ring-green-500',    grad: 'from-green-600 to-green-700 hover:from-green-700 hover:to-green-800' },
  purple: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400', ring: 'focus:ring-purple-500',   grad: 'from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800' },
  orange: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-400', ring: 'focus:ring-orange-500',   grad: 'from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700' },
  pink:   { bg: 'bg-pink-100 dark:bg-pink-900/30',     text: 'text-pink-600 dark:text-pink-400',     ring: 'focus:ring-pink-500',     grad: 'from-pink-600 to-pink-700 hover:from-pink-700 hover:to-pink-800' },
  red:    { bg: 'bg-red-100 dark:bg-red-900/30',       text: 'text-red-600 dark:text-red-400',       ring: 'focus:ring-red-500',      grad: 'from-red-600 to-red-700 hover:from-red-700 hover:to-red-800' },
  cyan:   { bg: 'bg-cyan-100 dark:bg-cyan-900/30',     text: 'text-cyan-600 dark:text-cyan-400',     ring: 'focus:ring-cyan-500',     grad: 'from-cyan-600 to-cyan-700 hover:from-cyan-700 hover:to-cyan-800' },
  indigo: { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-600 dark:text-indigo-400', ring: 'focus:ring-indigo-500',   grad: 'from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800' },
}

export default function Pay2NewServiceFlow(props: Pay2NewServiceFlowProps) {
  const {
    serviceId, title, subtitle, icon, mode,
    numberLabel, numberPlaceholder = 'Enter number',
    numberMaxLength, numberDigitsOnly = true,
    showOptional1 = false, optional1Label = 'Mobile Number', optional1Placeholder = '10-digit mobile',
    accent = 'blue',
  } = props

  const accentCls = ACCENT[accent]

  const { user } = useAuth()
  const { showToast } = useToast()

  const [billers, setBillers] = useState<Biller[]>([])
  const [billersLoading, setBillersLoading] = useState(true)
  const [billersError, setBillersError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [step, setStep] = useState<BillStep | RechargeStep>('select-biller')
  const [selectedBiller, setSelectedBiller] = useState<Biller | null>(null)

  const [number, setNumber] = useState('')
  const [optional1, setOptional1] = useState('')

  // Bill flow state
  const [fetchLoading, setFetchLoading] = useState(false)
  const [billData, setBillData] = useState<BillData | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Common pay
  const [payAmount, setPayAmount] = useState('')
  const [tpin, setTpin] = useState('')
  const [payLoading, setPayLoading] = useState(false)
  const [payResult, setPayResult] = useState<{
    success: boolean
    order_id?: string
    operator_reference?: string
    amount?: number | string
    charge?: number
    error?: string
  } | null>(null)

  // Charges preview (for credit card / bill payments)
  const [chargesData, setChargesData] = useState<{ base_charge: number; gst_percent: number; gst_amount: number; total_charge: number } | null>(null)
  const [loadingCharges, setLoadingCharges] = useState(false)

  useEffect(() => {
    fetchBillers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId])

  // Fetch charges when payment amount changes (bill mode only)
  useEffect(() => {
    if (mode !== 'bill') return
    const amountNum = parseFloat(payAmount)
    if (!amountNum || amountNum <= 0 || step !== 'bill-fetched') {
      setChargesData(null)
      return
    }

    const timer = setTimeout(async () => {
      setLoadingCharges(true)
      try {
        const data = await apiFetchJson(`/api/pay2new/charges?amount=${amountNum}`)
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
  }, [payAmount, step, mode])

  const fetchBillers = async () => {
    setBillersLoading(true)
    setBillersError(null)
    try {
      const data = await apiFetchJson(`/api/pay2new/billers?service_id=${serviceId}`)
      if (data.success) {
        setBillers(data.billers || [])
      } else {
        setBillersError(data.error || 'Failed to fetch operators')
      }
    } catch (e: any) {
      setBillersError(e.message || 'Failed to fetch operators')
    } finally {
      setBillersLoading(false)
    }
  }

  const filteredBillers = useMemo(() => {
    if (!search.trim()) return billers
    const q = search.toLowerCase()
    return billers.filter((b) => b.product_name.toLowerCase().includes(q))
  }, [billers, search])

  const resetSelection = () => {
    setSelectedBiller(null)
    setNumber('')
    setOptional1('')
    setBillData(null)
    setOrderId(null)
    setFetchError(null)
    setPayResult(null)
    setPayAmount('')
    setTpin('')
  }

  const handleSelectBiller = (biller: Biller) => {
    setSelectedBiller(biller)
    setStep('enter-details')
    setNumber('')
    setOptional1('')
    setBillData(null)
    setOrderId(null)
    setFetchError(null)
    setPayResult(null)
    setPayAmount('')
  }

  const handleFetchBill = async () => {
    if (!selectedBiller || !number) return
    if (numberMaxLength && number.length !== numberMaxLength) {
      setFetchError(`Please enter exactly ${numberMaxLength} digits`)
      return
    }

    setFetchLoading(true)
    setFetchError(null)
    setBillData(null)

    try {
      const data = await apiFetchJson('/api/pay2new/bill/fetch', {
        method: 'POST',
        body: JSON.stringify({
          number,
          product_code: selectedBiller.product_code,
          optional1: optional1 || '',
          customer_number: optional1 || number,
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
    if (!tpin || tpin.length < 4) {
      showToast('T-PIN is required (4 digits)', 'error')
      return
    }

    setPayLoading(true)
    try {
      const data = await apiFetchJson('/api/pay2new/bill/pay', {
        method: 'POST',
        body: JSON.stringify({
          number,
          amount,
          product_code: selectedBiller.product_code,
          product_name: selectedBiller.product_name,
          bill_fetch_ref: orderId,
          optional1: optional1 || '',
          customer_number: optional1 || number,
          user_id: user?.id,
          tpin,
        }),
      })

      setPayResult(data)
      setStep('payment-result')

      if (data.success) showToast('Payment successful!', 'success')
      else showToast(data.error || 'Payment failed', 'error')
    } catch (e: any) {
      setPayResult({ success: false, error: e.message || 'Payment failed' })
      setStep('payment-result')
      showToast(e.message || 'Payment failed', 'error')
    } finally {
      setPayLoading(false)
    }
  }

  const handleRecharge = async () => {
    if (!selectedBiller || !number || !payAmount) return
    const amount = parseFloat(payAmount)
    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid amount', 'error')
      return
    }

    setPayLoading(true)
    try {
      const data = await apiFetchJson('/api/pay2new/recharge', {
        method: 'POST',
        body: JSON.stringify({
          number,
          amount,
          product_code: selectedBiller.product_code,
          optional1: optional1 || '',
          customer_number: number,
          user_id: user?.id,
        }),
      })

      setPayResult(data)
      setStep('payment-result')

      if (data.success) showToast('Recharge successful!', 'success')
      else showToast(data.error || 'Recharge failed', 'error')
    } catch (e: any) {
      setPayResult({ success: false, error: e.message || 'Recharge failed' })
      setStep('payment-result')
      showToast(e.message || 'Recharge failed', 'error')
    } finally {
      setPayLoading(false)
    }
  }

  const goBack = () => {
    if (step === 'payment-result') {
      resetSelection()
      setStep('select-biller')
    } else if (step === 'bill-fetched') {
      setStep('enter-details')
    } else if (step === 'enter-details') {
      resetSelection()
      setStep('select-biller')
    }
  }

  const dueDate = billData?.dueDate || billData?.bill_due_date
  const billDate = billData?.billDate || billData?.bill_date
  const minDue = billData?.['Minimum Amount Due']
  const maxPermissible = billData?.['Maximum Permissible Amount']

  const handleNumberChange = (v: string) => {
    let val = v
    if (numberDigitsOnly) val = val.replace(/\D/g, '')
    if (numberMaxLength) val = val.slice(0, numberMaxLength)
    setNumber(val)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        {step !== 'select-biller' && (
          <button
            onClick={goBack}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="flex items-center gap-3">
          {icon && (
            <div className={`p-2 rounded-lg ${accentCls.bg}`}>
              <span className={accentCls.text}>{icon}</span>
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {step === 'select-biller' && title}
              {step === 'enter-details' && selectedBiller?.product_name}
              {step === 'bill-fetched' && 'Bill Details'}
              {step === 'payment-result' && (mode === 'recharge' ? 'Recharge Result' : 'Payment Result')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {step === 'select-biller' && (subtitle || 'Select operator')}
              {step === 'enter-details' && (mode === 'bill' ? 'Enter details to fetch bill' : 'Enter details to recharge')}
              {step === 'bill-fetched' && selectedBiller?.product_name}
              {step === 'payment-result' && selectedBiller?.product_name}
            </p>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Select operator */}
        {step === 'select-biller' && (
          <motion.div key="billers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder={`Search operator...`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={`w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 ${accentCls.ring} focus:border-transparent`}
                />
              </div>

              {billersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className={`w-6 h-6 animate-spin ${accentCls.text}`} />
                  <span className="ml-2 text-gray-500">Loading operators...</span>
                </div>
              ) : billersError ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                  <p className="text-red-500 text-sm">{billersError}</p>
                  <button onClick={fetchBillers} className={`mt-3 text-sm ${accentCls.text} hover:underline`}>
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
                      <div className={`p-2 rounded-lg ${accentCls.bg}`}>
                        <span className={accentCls.text}>
                          {icon || <Receipt className="w-5 h-5" />}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{biller.product_name}</p>
                      </div>
                    </button>
                  ))}
                  {filteredBillers.length === 0 && (
                    <p className="col-span-full text-center text-gray-400 py-8">No operators found</p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Step 2: Enter details */}
        {step === 'enter-details' && (
          <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-6 max-w-md">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {numberLabel} *
                  </label>
                  <input
                    type="text"
                    maxLength={numberMaxLength}
                    placeholder={numberPlaceholder}
                    value={number}
                    onChange={(e) => handleNumberChange(e.target.value)}
                    className={`w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 ${accentCls.ring}`}
                  />
                </div>

                {showOptional1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {optional1Label}
                    </label>
                    <input
                      type="tel"
                      maxLength={10}
                      placeholder={optional1Placeholder}
                      value={optional1}
                      onChange={(e) => setOptional1(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      className={`w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 ${accentCls.ring}`}
                    />
                  </div>
                )}

                {mode === 'recharge' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Amount (₹) *
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      placeholder="Enter amount"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className={`w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 ${accentCls.ring}`}
                    />
                  </div>
                )}

                {fetchError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                    <p className="text-sm text-red-600 dark:text-red-400">{fetchError}</p>
                  </div>
                )}

                {mode === 'bill' ? (
                  <button
                    onClick={handleFetchBill}
                    disabled={
                      fetchLoading ||
                      !number ||
                      (numberMaxLength ? number.length !== numberMaxLength : false)
                    }
                    className={`w-full py-3 bg-gradient-to-r ${accentCls.grad} text-white rounded-lg font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2`}
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
                ) : (
                  <button
                    onClick={handleRecharge}
                    disabled={payLoading || !number || !payAmount || parseFloat(payAmount) <= 0}
                    className={`w-full py-3 bg-gradient-to-r ${accentCls.grad} text-white rounded-lg font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2`}
                  >
                    {payLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        Recharge ₹{payAmount ? parseFloat(payAmount).toLocaleString('en-IN') : '0'}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* Step 3 (bill mode): Bill fetched */}
        {step === 'bill-fetched' && billData && mode === 'bill' && (
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
                    <span className="text-lg font-bold text-red-600">
                      ₹{parseFloat(billData.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  {minDue && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-500">Minimum Due</span>
                      <span className="text-sm font-medium">
                        ₹{parseFloat(minDue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  {maxPermissible && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-500">Max Permissible</span>
                      <span className="text-sm font-medium">
                        ₹{parseFloat(maxPermissible).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
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
                    className={`w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:ring-2 ${accentCls.ring}`}
                  />
                  <div className="flex gap-2 mt-2 flex-wrap">
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

                {/* Charges breakdown - Settlement style */}
                {parseFloat(payAmount) > 0 && (
                  <div className="space-y-3">
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800">
                      <p className="text-green-600 dark:text-green-400 text-xs font-medium mb-1">Payment Amount</p>
                      <p className="text-lg font-bold text-green-700 dark:text-green-300">₹{parseFloat(payAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
                      <p className="text-amber-600 dark:text-amber-400 text-xs font-medium mb-1">
                        Service Charges incl. GST (Wallet Debit)
                        {loadingCharges && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}
                      </p>
                      <p className="text-lg font-bold text-amber-700 dark:text-amber-300">
                        ₹{(chargesData?.total_charge ?? 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Transaction PIN (TPIN) *
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={tpin}
                    onChange={(e) => setTpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Enter 4-digit TPIN"
                    maxLength={4}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm tracking-[0.5em] text-center focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Required for every transaction. Set it under Settings if not configured.
                  </p>
                </div>

                <button
                  onClick={handlePayBill}
                  disabled={payLoading || !payAmount || parseFloat(payAmount) <= 0 || tpin.length < 4}
                  className="w-full py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg font-medium text-sm hover:from-green-700 hover:to-green-800 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {payLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing Payment...
                    </>
                  ) : (
                    <>
                      <Receipt className="w-4 h-4" />
                      Pay ₹{payAmount ? (parseFloat(payAmount) + (chargesData?.total_charge || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Step 4: Result */}
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
                    <h3 className="text-xl font-bold text-green-600">
                      {mode === 'recharge' ? 'Recharge Successful!' : 'Payment Successful!'}
                    </h3>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 mx-auto bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                      <AlertCircle className="w-10 h-10 text-red-600" />
                    </div>
                    <h3 className="text-xl font-bold text-red-600">
                      {mode === 'recharge' ? 'Recharge Failed' : 'Payment Failed'}
                    </h3>
                    <p className="text-sm text-red-500">{payResult.error}</p>
                  </>
                )}

                {payResult.success && (
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-left space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-500">Amount</span>
                      <span className="font-bold text-green-600">₹{payResult.amount}</span>
                    </div>
                    {payResult.order_id && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">Order ID</span>
                        <span className="text-sm font-mono">{payResult.order_id}</span>
                      </div>
                    )}
                    {payResult.operator_reference && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-500">Operator Reference</span>
                        <span className="text-sm font-mono">{payResult.operator_reference}</span>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={() => {
                    resetSelection()
                    setStep('select-biller')
                  }}
                  className={`w-full py-3 bg-gradient-to-r ${accentCls.grad} text-white rounded-lg font-medium text-sm`}
                >
                  {mode === 'recharge' ? 'New Recharge' : 'Make Another Payment'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
