'use client'

import { useState, useEffect, useRef } from 'react'
import { 
  Search, Loader2, CheckCircle, XCircle, Wallet, Receipt, 
  AlertCircle, RefreshCw, FileText, Clock, MessageSquare, History
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { paiseToRupees, formatPaiseAsRupees } from '@/lib/bbps/currency'
import { apiFetch, apiFetchJson } from '@/lib/api-client'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'

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
  metadata?: {
    billerInputParams?: {
      paramInfo?: Array<{
        paramName: string
        dataType?: string
        isOptional?: string
        minLength?: string
        maxLength?: string
        regEx?: string
        visibility?: string
      }>
    }
    paramInfo?: Array<{
      paramName: string
      dataType?: string
      isOptional?: string
      minLength?: string
      maxLength?: string
      regEx?: string
      visibility?: string
    }>
    [key: string]: any
  }
}

interface InputParam {
  paramName: string
  paramValue: string
  dataType?: string
  isOptional?: string
  minLength?: string
  maxLength?: string
  regEx?: string
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

interface PaymentConfirmation {
  amount: number // Amount to pay in rupees
  charges: number // Transaction charges in rupees
  totalDeduction: number // Total deduction from wallet
  showTpinInput: boolean
  tpin: string
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

// Categories that are prepaid (don't require bill fetch - direct recharge)
const PREPAID_CATEGORIES = [
  'Mobile Prepaid',
  'DTH',
  'Fastag',
  'NCMC Recharge',
  'Prepaid meter',
]

// Helper to check if a category is prepaid
const isPrepaidCategory = (category: string): boolean => {
  return PREPAID_CATEGORIES.some(pc => 
    category.toLowerCase().includes(pc.toLowerCase()) ||
    pc.toLowerCase().includes(category.toLowerCase())
  )
}

interface BBPSPaymentProps {
  categoryFilter?: string[]
  title?: string
}

export default function BBPSPayment({ categoryFilter, title }: BBPSPaymentProps = {}) {
  const { user } = useAuth()
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
  const [inputParams, setInputParams] = useState<Record<string, string>>({})
  const [inputParamFields, setInputParamFields] = useState<InputParam[]>([])
  const [loadingBill, setLoadingBill] = useState(false)
  const [billDetails, setBillDetails] = useState<BillDetails | null>(null)
  const [paying, setPaying] = useState(false)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus | null>(null)
  const [showComplaintForm, setShowComplaintForm] = useState(false)
  const [complaintDescription, setComplaintDescription] = useState('')
  const [submittingComplaint, setSubmittingComplaint] = useState(false)
  const [activeView, setActiveView] = useState<'payment' | 'history'>('payment')
  
  // Payment confirmation flow states
  const [paymentStep, setPaymentStep] = useState<'bill' | 'amount' | 'confirm'>('bill')
  const [customAmount, setCustomAmount] = useState<string>('')
  const [amountType, setAmountType] = useState<'full' | 'minimum' | 'custom'>('full')
  const [paymentCharges, setPaymentCharges] = useState<number>(0)
  const [loadingCharges, setLoadingCharges] = useState(false)
  const [tpin, setTpin] = useState('')
  const [tpinError, setTpinError] = useState<string | null>(null)
  
  // Prepaid recharge states
  const [prepaidAmount, setPrepaidAmount] = useState<string>('')
  const [showPrepaidConfirm, setShowPrepaidConfirm] = useState(false)
  const [prepaidCharges, setPrepaidCharges] = useState<number>(0)

  // Ref for auto-scrolling to consumer details form
  const consumerDetailsRef = useRef<HTMLDivElement>(null)

  // Fetch wallet balance when user is available
  useEffect(() => {
    if (user?.partner_id) {
      fetchWalletBalance()
    }
  }, [user?.partner_id])

  // Fetch categories (re-fetch when categoryFilter changes)
  useEffect(() => {
    // Reset state when filter changes
    setSelectedCategory('')
    setSelectedBiller(null)
    setBillDetails(null)
    setPaymentResult(null)
    setBillers([])
    setFilteredBillers([])
    setError(null)
    setPrepaidAmount('')
    setShowPrepaidConfirm(false)
    
    fetchCategories()
  }, [categoryFilter])

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

  // Extract input parameters when biller is selected
  useEffect(() => {
    if (selectedBiller) {
      // Get input parameters from metadata - check multiple possible locations
      // Priority: billerInputParams.paramInfo > paramInfo > direct on biller
      const paramInfo = 
        selectedBiller.metadata?.billerInputParams?.paramInfo || 
        selectedBiller.metadata?.paramInfo ||
        (selectedBiller.metadata as any)?.billerInputParams?.paramInfo ||
        (selectedBiller.metadata as any)?.paramInfo ||
        (selectedBiller as any)?.billerInputParams?.paramInfo ||
        (selectedBiller as any)?.paramInfo ||
        []
      
      console.log('Selected biller:', {
        biller_id: selectedBiller.biller_id,
        biller_name: selectedBiller.biller_name,
        hasMetadata: !!selectedBiller.metadata,
        metadataKeys: selectedBiller.metadata ? Object.keys(selectedBiller.metadata) : [],
        billerInputParams: selectedBiller.metadata?.billerInputParams,
        paramInfo: selectedBiller.metadata?.paramInfo,
      })
      console.log('Extracted paramInfo:', paramInfo)
      
      if (paramInfo && Array.isArray(paramInfo) && paramInfo.length > 0) {
        // Use dynamic input parameters
        const fields = paramInfo.map((p: any) => ({
          paramName: p.paramName,
          paramValue: '',
          dataType: p.dataType,
          isOptional: p.isOptional,
          minLength: p.minLength,
          maxLength: p.maxLength,
          regEx: p.regEx,
        }))
        console.log('✅ Setting inputParamFields:', fields)
        setInputParamFields(fields)
        setInputParams({})
        setConsumerNumber('') // Clear consumer number when using dynamic params
      } else {
        // Use default consumer number field
        console.log('⚠️ No input params found, using default consumer number field')
        console.log('Biller metadata structure:', JSON.stringify(selectedBiller.metadata, null, 2))
        setInputParamFields([])
        setInputParams({})
      }
    } else {
      setInputParamFields([])
      setInputParams({})
      setConsumerNumber('')
    }
  }, [selectedBiller])

  const fetchWalletBalance = async () => {
    if (!user?.partner_id) {
      setLoadingBalance(false)
      return
    }
    
    try {
      setLoadingBalance(true)
      setError(null)
      
      // Use Supabase directly instead of API route (avoids cookie auth issues)
      // Try new function first
      const { data: newBalance, error: newError } = await supabase.rpc('get_wallet_balance_v2', {
        p_user_id: user.partner_id,
        p_wallet_type: 'primary'
      })

      if (!newError && newBalance !== null) {
        setWalletBalance(newBalance)
      } else if (user.role === 'retailer') {
        // Fallback to old function for retailers
        const { data: oldBalance, error: oldError } = await supabase.rpc('get_wallet_balance', {
          p_retailer_id: user.partner_id
        })
        if (!oldError) {
          setWalletBalance(oldBalance || 0)
        } else {
          console.error('Error fetching wallet balance:', oldError)
          setWalletBalance(0)
        }
      } else {
        setWalletBalance(0)
      }
    } catch (error: any) {
      console.error('Error fetching wallet balance:', error)
      setWalletBalance(0)
    } finally {
      setLoadingBalance(false)
    }
  }

  // Calculate BBPS charges for a given amount
  const fetchBBPSCharges = async (amountInRupees: number): Promise<number> => {
    try {
      setLoadingCharges(true)
      
      // Try to get charge from Supabase RPC
      const { data: chargeData, error } = await supabase.rpc('calculate_transaction_charge', {
        p_amount: amountInRupees,
        p_transaction_type: 'bbps'
      })
      
      if (!error && chargeData !== null) {
        return chargeData
      }
      
      // Fallback: Calculate charge locally based on common BBPS slabs
      // These are typical charges - should match backend
      if (amountInRupees <= 500) return 5
      if (amountInRupees <= 1000) return 10
      if (amountInRupees <= 2000) return 15
      if (amountInRupees <= 5000) return 20
      if (amountInRupees <= 10000) return 25
      return 30 // Default for amounts > 10000
    } catch (error) {
      console.error('Error fetching BBPS charges:', error)
      return 20 // Default fallback charge
    } finally {
      setLoadingCharges(false)
    }
  }

  // Helper to get minimum amount from bill details
  const getMinimumAmount = (): number | null => {
    // Try multiple paths to find the additional info
    const additionalInfo = billDetails?.additional_info?.additionalInfo?.info || 
                          billDetails?.additional_info?.billerResponse?.additionalInfo?.info ||
                          billDetails?.additional_info?.info ||
                          []
    
    // Debug logging
    console.log('getMinimumAmount - billDetails.additional_info:', billDetails?.additional_info)
    console.log('getMinimumAmount - additionalInfo array:', additionalInfo)
    
    if (!additionalInfo || additionalInfo.length === 0) {
      console.log('getMinimumAmount - No additionalInfo found')
      return null
    }
    
    const minAmountInfo = additionalInfo.find((item: { infoName: string; infoValue: string }) => 
      item.infoName?.toLowerCase().includes('minimum') || 
      item.infoName?.toLowerCase().includes('min due') ||
      item.infoName?.toLowerCase().includes('min payable')
    )
    
    console.log('getMinimumAmount - minAmountInfo found:', minAmountInfo)
    
    if (minAmountInfo?.infoValue) {
      const parsed = parseFloat(minAmountInfo.infoValue)
      const billAmountRupees = billDetails ? paiseToRupees(billDetails.bill_amount) : 0
      console.log('getMinimumAmount - parsed:', parsed, 'billAmountRupees:', billAmountRupees, 'condition:', parsed < billAmountRupees)
      return isNaN(parsed) ? null : parsed
    }
    return null
  }

  // Get selected amount based on amount type
  const getSelectedAmount = (): number => {
    if (!billDetails) return 0
    const billAmountInRupees = paiseToRupees(billDetails.bill_amount)
    
    switch (amountType) {
      case 'full':
        return billAmountInRupees
      case 'minimum':
        return getMinimumAmount() || billAmountInRupees
      case 'custom':
        return customAmount ? parseFloat(customAmount) : 0
      default:
        return billAmountInRupees
    }
  }

  // Handle amount selection and proceed to confirmation
  const proceedToConfirmation = async () => {
    if (!billDetails) return
    
    const billAmountInRupees = paiseToRupees(billDetails.bill_amount)
    const selectedAmount = getSelectedAmount()
    
    if (isNaN(selectedAmount) || selectedAmount <= 0) {
      setError('Please enter a valid amount')
      return
    }
    
    // Check if amount is valid for the biller
    if (selectedBiller?.amount_exactness === 'EXACT' && selectedAmount !== billAmountInRupees) {
      setError('This biller requires exact bill amount payment')
      return
    }
    
    if (selectedAmount > billAmountInRupees) {
      setError('Amount cannot exceed bill amount')
      return
    }
    
    // Fetch charges for the selected amount
    const charges = await fetchBBPSCharges(selectedAmount)
    setPaymentCharges(charges)
    
    // Check wallet balance
    const totalDeduction = selectedAmount + charges
    if (walletBalance !== null && walletBalance < totalDeduction) {
      setError(`Insufficient balance. Required: ₹${totalDeduction.toFixed(2)}, Available: ₹${walletBalance.toFixed(2)}`)
      return
    }
    
    // Proceed to confirmation step
    setPaymentStep('confirm')
    setError(null)
  }

  // Go back to amount selection
  const goBackToAmount = () => {
    setPaymentStep('amount')
    setTpin('')
    setTpinError(null)
  }

  // Go back to bill details
  const goBackToBill = () => {
    setPaymentStep('bill')
    setCustomAmount('')
    setAmountType('full')
    setTpin('')
    setTpinError(null)
    setPaymentCharges(0)
  }

  const fetchCategories = async () => {
    try {
      const data = await apiFetchJson<{ success: boolean; categories?: string[]; error?: string }>('/api/bbps/categories', {
        method: 'GET',
      })
      if (data.success) {
        let cats = data.categories || []
        
        // Filter categories if categoryFilter prop is provided
        if (categoryFilter && categoryFilter.length > 0) {
          cats = cats.filter(cat => 
            categoryFilter.some(filterCat => 
              cat.toLowerCase().includes(filterCat.toLowerCase()) ||
              filterCat.toLowerCase().includes(cat.toLowerCase())
            )
          )
        }
        
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
      setInfoMessage(null)
      // Use billers-by-category endpoint to get full biller details including inputParams
      const data = await apiFetchJson<{ success: boolean; data?: any[]; error?: string; msg?: string }>('/api/bbps/billers-by-category', {
        method: 'POST',
        body: JSON.stringify({
          fieldValue: category,
          paymentChannelName1: 'AGT',
          paymentChannelName2: '',
          paymentChannelName3: '',
        }),
      })
      
      if (data.success && data.data) {
        // The service already returns properly formatted BBPSBiller objects with metadata
        // Use them directly, but ensure metadata is preserved
        const billersList: BBPSBiller[] = (data.data || []).map((biller: any) => {
          // If biller already has the correct structure (from service), use it
          if (biller.biller_id && biller.metadata) {
            return biller as BBPSBiller
          }
          
          // Otherwise, transform from API response format
          return {
            biller_id: biller.billerId || biller.biller_id || '',
            biller_name: biller.billerName || biller.biller_name || '',
            category: biller.billerCategory || biller.category || category,
            category_name: biller.billerCategory || biller.category_name || category,
            biller_alias: biller.billerAlias || biller.biller_alias,
            is_active: biller.is_active !== false,
            support_bill_fetch: biller.support_bill_fetch !== false,
            support_partial_payment: biller.support_partial_payment || false,
            amount_exactness: biller.amount_exactness,
            metadata: {
              // Preserve existing metadata if present
              ...(biller.metadata || {}),
              // Ensure billerInputParams and paramInfo are at the top level of metadata
              billerInputParams: biller.billerInputParams || biller.metadata?.billerInputParams,
              paramInfo: biller.paramInfo || biller.metadata?.paramInfo,
              // Include other important fields
              _id: biller._id,
              billerId: biller.billerId,
              billerName: biller.billerName,
              billerCategory: biller.billerCategory,
              billerPaymentModes: biller.billerPaymentModes,
              billerPaymentChannels: biller.billerPaymentChannels,
              // Include all other biller properties
              ...Object.fromEntries(
                Object.entries(biller).filter(([key]) => 
                  !['billerId', 'biller_id', 'billerName', 'biller_name', 'billerCategory', 'category', 'category_name'].includes(key)
                )
              ),
            },
          } as BBPSBiller
        })
        
        console.log('Fetched billers with metadata:', billersList.map(b => ({
          biller_id: b.biller_id,
          biller_name: b.biller_name,
          hasMetadata: !!b.metadata,
          hasBillerInputParams: !!b.metadata?.billerInputParams,
          hasParamInfo: !!b.metadata?.paramInfo,
          billerInputParams: b.metadata?.billerInputParams,
          paramInfo: b.metadata?.paramInfo,
        })))
        
        setBillers(billersList)
        setFilteredBillers(billersList)
        
        if (billersList.length === 0) {
          setError(`No billers found for category: ${category}`)
        }
      } else {
        setError(data.error || data.msg || 'Failed to fetch billers')
      }
    } catch (error: any) {
      console.error('Error fetching billers:', error)
      setError(error.message || 'Failed to fetch billers. Please check your API credentials and network connection.')
    } finally {
      setLoadingBillers(false)
    }
  }

  const fetchBill = async () => {
    if (!selectedBiller) {
      setError('Please select a biller')
      return
    }

    // Check if this biller requires input parameters but they're not available
    const requiresInputParams = selectedBiller.metadata?.billerInputParams?.paramInfo || 
                                selectedBiller.metadata?.paramInfo ||
                                (selectedBiller.metadata as any)?.billerInputParams?.paramInfo ||
                                (selectedBiller.metadata as any)?.paramInfo
    
    if (requiresInputParams && requiresInputParams.length > 0 && inputParamFields.length === 0) {
      setError('Input Parameters not found. Please refresh the page and try again.')
      console.error('Biller requires input params but they were not extracted:', {
        biller: selectedBiller,
        metadata: selectedBiller.metadata,
        requiresInputParams,
      })
      return
    }

    // Validate inputs based on whether we're using dynamic params or consumer number
    if (inputParamFields.length > 0) {
      // Validate all dynamic input parameters
      const missingParams = inputParamFields.filter(field => {
        const value = inputParams[field.paramName] || ''
        return field.isOptional !== 'true' && !value.trim()
      })
      
      if (missingParams.length > 0) {
        setError(`Please fill in all required fields: ${missingParams.map(p => p.paramName).join(', ')}`)
        return
      }

      // Validate format for each field
      for (const field of inputParamFields) {
        const value = inputParams[field.paramName] || ''
        if (value.trim()) {
          // Check min/max length
          if (field.minLength && value.length < parseInt(field.minLength)) {
            setError(`${field.paramName} must be at least ${field.minLength} characters`)
            return
          }
          if (field.maxLength && value.length > parseInt(field.maxLength)) {
            setError(`${field.paramName} must be at most ${field.maxLength} characters`)
            return
          }
          // Check regex pattern if provided
          if (field.regEx && field.dataType === 'NUMERIC') {
            const regex = new RegExp(field.regEx)
            if (!regex.test(value)) {
              setError(`${field.paramName} format is invalid`)
              return
            }
          }
        }
      }
    } else {
      // Validate consumer number
      if (!consumerNumber.trim()) {
        setError('Please enter consumer number')
        return
      }
    }

    try {
      setLoadingBill(true)
      setError(null)
      setInfoMessage(null)
      setInfoMessage(null)
      setBillDetails(null)
      setPaymentResult(null)
      setTransactionStatus(null)

      // Build request body
      const requestBody: any = {
        biller_id: selectedBiller.biller_id,
        // Include user_id for fallback auth when cookie auth doesn't work
        user_id: user?.partner_id,
      }

      // Add input_params if using dynamic parameters
      if (inputParamFields.length > 0) {
        requestBody.input_params = inputParamFields.map(field => ({
          paramName: field.paramName,
          paramValue: inputParams[field.paramName] || '',
        }))
        // Use first param value as consumer_number for backward compatibility
        requestBody.consumer_number = inputParams[inputParamFields[0].paramName] || ''
      } else {
        // Use consumer number for regular billers
        requestBody.consumer_number = consumerNumber.trim()
      }

      console.log('Sending fetch bill request:', requestBody)
      
      const data = await apiFetchJson<{ success?: boolean; bill?: BillDetails; reqId?: string; error?: string; message?: string; messageType?: string }>('/api/bbps/bill/fetch', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })
      
      console.log('Fetch bill response:', data)
      
      // Check if this is an informational message (not an error)
      const message = data.error || data.message || 'Failed to fetch bill details'
      const isInfoMessage = data.messageType === 'info' || 
                           message.toLowerCase().includes('no bill due') ||
                           message.toLowerCase().includes('no bill') ||
                           message.toLowerCase().includes('no data available') ||
                           message.toLowerCase().includes('payment received') ||
                           message.toLowerCase().includes('already paid')
      
      // Handle successful response
      if (data.success && data.bill) {
        // Check if this is a "no bill due" info response
        if (data.bill.additional_info?.noBillDue) {
          const infoMsg = data.bill.additional_info?.message || 'No bill is currently due for this account'
          setInfoMessage(infoMsg)
        } else {
          // CRITICAL: Ensure reqId is captured from all possible locations
          // The reqId is essential for the payment to succeed
          const billWithReqId = {
            ...data.bill,
            // Prioritize reqId from: bill.reqId > data.reqId > bill.additional_info.reqId
            reqId: data.bill.reqId || data.reqId || data.bill.additional_info?.reqId,
          }
          console.log('📋 Bill fetched with reqId:', billWithReqId.reqId || 'NOT FOUND - Payment will fail!')
          if (!billWithReqId.reqId) {
            console.error('❌ CRITICAL: No reqId found in bill response! Full response:', data)
          }
          setBillDetails(billWithReqId)
        }
      } else if (isInfoMessage) {
        // Even if success is false, if it's an info message, show it as info
        setInfoMessage(message)
      } else {
        setError(message)
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

    // Validate T-PIN format if provided
    // T-PIN is optional if not configured for the account
    if (tpin && tpin.length > 0 && tpin.length < 4) {
      setTpinError('T-PIN must be at least 4 digits')
      return
    }

    // Clear any previous T-PIN errors
    setTpinError(null)

    try {
      setPaying(true)
      setError(null)
      setInfoMessage(null)
      setPaymentResult(null)
      setTransactionStatus(null)

      // Calculate the amount to pay
      const selectedAmount = getSelectedAmount()
      
      // Convert back to paise for the API (BBPS API expects paise)
      const amountInPaise = selectedAmount * 100

      // Get consumer number from input params or direct input
      const effectiveConsumerNumber = inputParamFields.length > 0
        ? inputParams[inputParamFields[0].paramName] || ''
        : consumerNumber.trim()

      // CRITICAL: Extract reqId for payment correlation
      const paymentReqId = billDetails.reqId || billDetails.additional_info?.reqId
      console.log('💳 Initiating payment with reqId:', paymentReqId || 'NOT FOUND!')
      if (!paymentReqId) {
        console.error('❌ CRITICAL: No reqId available for payment! This will cause "No fetch data found" error.')
        console.error('Bill details:', billDetails)
      }

      const data = await apiFetchJson<PaymentResult>('/api/bbps/bill/pay', {
        method: 'POST',
        body: JSON.stringify({
          biller_id: selectedBiller.biller_id,
          biller_name: selectedBiller.biller_name,
          biller_category: selectedBiller.category || selectedBiller.category_name || selectedCategory,
          consumer_number: effectiveConsumerNumber,
          amount: amountInPaise, // Send in paise to API
          consumer_name: billDetails.consumer_name,
          due_date: billDetails.due_date,
          bill_date: billDetails.bill_date,
          bill_number: billDetails.bill_number,
          // CRITICAL: Pass reqId from fetchBill to correlate with BBPS provider
          reqId: billDetails.reqId || billDetails.additional_info?.reqId,
          additional_info: {
            ...billDetails.additional_info,
            inputParams: inputParamFields.length > 0 
              ? inputParamFields.map(f => ({ paramName: f.paramName, paramValue: inputParams[f.paramName] || '' }))
              : undefined,
          },
          // Include user_id for fallback auth when cookie auth doesn't work
          user_id: user?.partner_id,
          // Include T-PIN for server-side verification
          tpin: tpin,
        }),
      })
      setPaymentResult(data)
      
      if (data.success) {
        // Refresh wallet balance
        await fetchWalletBalance()
        // Reset payment flow
        setPaymentStep('bill')
        setCustomAmount('')
        setAmountType('full')
        setTpin('')
        setPaymentCharges(0)
        // Auto-check transaction status after 2 seconds
        if (data.bbps_transaction_id) {
          const transactionId = data.bbps_transaction_id
          setTimeout(() => {
            checkTransactionStatus(transactionId)
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
      setInfoMessage(null)

      const data = await apiFetchJson<{ success: boolean; status?: TransactionStatus; error?: string }>('/api/bbps/transaction-status', {
        method: 'POST',
        body: JSON.stringify({
          transaction_id: transactionId,
          track_type: 'TRANS_REF_ID',
        }),
      })
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
      setInfoMessage(null)

      const data = await apiFetchJson<{ success: boolean; complaint_id?: string; error?: string }>('/api/bbps/complaint/register', {
        method: 'POST',
        body: JSON.stringify({
          transaction_id: paymentResult.bbps_transaction_id,
          complaint_type: 'Transaction',
          description: complaintDescription.trim(),
          complaint_disposition: 'Amount deducted multiple times',
        }),
      })
      if (data.success) {
        setError(null)
        setInfoMessage(null)
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
    // Reset payment flow states
    setPaymentStep('bill')
    setCustomAmount('')
    setAmountType('full')
    setPaymentCharges(0)
    setTpin('')
    setTpinError(null)
    // Reset prepaid states
    setPrepaidAmount('')
    setShowPrepaidConfirm(false)
    setPrepaidCharges(0)
  }

  // Check if current category is prepaid
  const isPrepaid = isPrepaidCategory(selectedCategory)

  // Proceed to prepaid confirmation
  const proceedToPrepaidConfirmation = async () => {
    if (!selectedBiller) {
      setError('Please select a biller')
      return
    }

    const amount = parseFloat(prepaidAmount)
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid recharge amount')
      return
    }

    if (amount < 10) {
      setError('Minimum recharge amount is ₹10')
      return
    }

    if (amount > 10000) {
      setError('Maximum recharge amount is ₹10,000')
      return
    }

    // Fetch charges
    const charges = await fetchBBPSCharges(amount)
    setPrepaidCharges(charges)

    // Check wallet balance
    const totalDeduction = amount + charges
    if (walletBalance !== null && walletBalance < totalDeduction) {
      setError(`Insufficient balance. Required: ₹${totalDeduction.toFixed(2)}, Available: ₹${walletBalance.toFixed(2)}`)
      return
    }

    setError(null)
    setShowPrepaidConfirm(true)
  }

  // Pay prepaid recharge directly (no bill fetch)
  const payPrepaid = async () => {
    if (!selectedBiller) {
      setError('Please select a biller')
      return
    }

    const amount = parseFloat(prepaidAmount)
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid amount')
      return
    }

    // Validate T-PIN if provided
    if (tpin && tpin.length > 0 && tpin.length < 4) {
      setTpinError('T-PIN must be at least 4 digits')
      return
    }

    setTpinError(null)

    try {
      setPaying(true)
      setError(null)
      setInfoMessage(null)
      setPaymentResult(null)
      setTransactionStatus(null)

      // Convert to paise for the API
      const amountInPaise = amount * 100

      // Get consumer number from input params or direct input
      const effectiveConsumerNumber = inputParamFields.length > 0
        ? inputParams[inputParamFields[0].paramName] || ''
        : consumerNumber.trim()

      const data = await apiFetchJson<PaymentResult>('/api/bbps/bill/pay', {
        method: 'POST',
        body: JSON.stringify({
          biller_id: selectedBiller.biller_id,
          biller_name: selectedBiller.biller_name,
          biller_category: selectedBiller.category || selectedBiller.category_name || selectedCategory,
          consumer_number: effectiveConsumerNumber,
          amount: amountInPaise,
          // For prepaid, we don't have bill details
          is_prepaid: true,
          additional_info: {
            inputParams: inputParamFields.length > 0
              ? inputParamFields.map(f => ({ paramName: f.paramName, paramValue: inputParams[f.paramName] || '' }))
              : undefined,
            recharge_type: 'prepaid',
          },
          user_id: user?.partner_id,
          tpin: tpin,
        }),
      })

      setPaymentResult(data)

      if (data.success) {
        // Refresh wallet balance
        await fetchWalletBalance()
        // Reset prepaid flow
        setPrepaidAmount('')
        setShowPrepaidConfirm(false)
        setPrepaidCharges(0)
        setTpin('')
        // Auto-check transaction status
        if (data.bbps_transaction_id) {
          const transactionId = data.bbps_transaction_id
          setTimeout(() => {
            checkTransactionStatus(transactionId)
          }, 2000)
        }
      }
    } catch (error: any) {
      console.error('Error processing prepaid recharge:', error)
      setError(error.message || 'Recharge failed')
    } finally {
      setPaying(false)
    }
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

          {/* Info Message (Success/Info) - No Bill Due */}
          <AnimatePresence>
            {infoMessage && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border-2 border-green-300 dark:border-green-700 rounded-xl p-6 shadow-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-lg">
                      <CheckCircle className="w-8 h-8 text-white" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-green-800 dark:text-green-200">All Clear!</h3>
                    <p className="text-base text-green-700 dark:text-green-300 mt-1">{infoMessage}</p>
                  </div>
                  <button
                    onClick={() => setInfoMessage(null)}
                    className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 p-2 hover:bg-green-100 dark:hover:bg-green-800/30 rounded-full transition-colors"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

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
                    setInfoMessage(null)
                    setBillers([])
                    setFilteredBillers([])
                    // Reset prepaid states
                    setPrepaidAmount('')
                    setShowPrepaidConfirm(false)
                    setPrepaidCharges(0)
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
                      setInfoMessage(null)
                      // Reset prepaid states
                      setPrepaidAmount('')
                      setShowPrepaidConfirm(false)
                      setPrepaidCharges(0)
                      setTpin('')
                      // Auto-scroll to consumer details form
                      setTimeout(() => {
                        consumerDetailsRef.current?.scrollIntoView({ 
                          behavior: 'smooth', 
                          block: 'start' 
                        })
                      }, 100)
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

          {/* Consumer Details Input */}
          {selectedBiller && (
            <motion.div
              ref={consumerDetailsRef}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4"
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Enter Consumer Details</h3>
              <div className="space-y-4">
                {inputParamFields.length > 0 ? (
                  // Dynamic input fields based on biller parameters
                  inputParamFields.map((field, index) => (
                    <div key={index}>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {field.paramName} {field.isOptional !== 'true' && '*'}
                        {field.minLength && field.maxLength && (
                          <span className="text-xs text-gray-500 ml-2">
                            ({field.minLength}-{field.maxLength} {field.dataType === 'NUMERIC' ? 'digits' : 'characters'})
                          </span>
                        )}
                      </label>
                      <input
                        type={field.dataType === 'NUMERIC' ? 'tel' : 'text'}
                        value={inputParams[field.paramName] || ''}
                        onChange={(e) => {
                          let value = e.target.value
                          // For numeric fields, only allow digits
                          if (field.dataType === 'NUMERIC') {
                            value = value.replace(/\D/g, '')
                            // Enforce max length
                            if (field.maxLength && value.length > parseInt(field.maxLength)) {
                              value = value.slice(0, parseInt(field.maxLength))
                            }
                          }
                          setInputParams(prev => ({
                            ...prev,
                            [field.paramName]: value,
                          }))
                        }}
                        placeholder={`Enter ${field.paramName.toLowerCase()}`}
                        maxLength={field.maxLength ? parseInt(field.maxLength) : undefined}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  ))
                ) : (
                  // Default consumer number field
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
                )}
                {/* Prepaid Amount Input */}
                {isPrepaid && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Recharge Amount (₹) *
                    </label>
                    <input
                      type="number"
                      value={prepaidAmount}
                      onChange={(e) => setPrepaidAmount(e.target.value)}
                      placeholder="Enter recharge amount (₹10 - ₹10,000)"
                      min="10"
                      max="10000"
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Min: ₹10 | Max: ₹10,000
                    </p>
                  </div>
                )}

                {/* Fetch Bill Button (for postpaid/bill-based) OR Proceed to Pay (for prepaid) */}
                {isPrepaid ? (
                  <button
                    onClick={proceedToPrepaidConfirmation}
                    disabled={
                      loadingCharges ||
                      !prepaidAmount ||
                      parseFloat(prepaidAmount) < 10 ||
                      (inputParamFields.length > 0 
                        ? inputParamFields.some(field => field.isOptional !== 'true' && !inputParams[field.paramName]?.trim())
                        : !consumerNumber.trim())
                    }
                    className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loadingCharges ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Calculating...
                      </>
                    ) : (
                      <>
                        <Wallet className="w-4 h-4" />
                        Proceed to Recharge
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={fetchBill}
                    disabled={
                      loadingBill || 
                      (inputParamFields.length > 0 
                        ? inputParamFields.some(field => field.isOptional !== 'true' && !inputParams[field.paramName]?.trim())
                        : !consumerNumber.trim())
                    }
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
                )}
              </div>
            </motion.div>
          )}

          {/* Prepaid Confirmation */}
          {isPrepaid && showPrepaidConfirm && selectedBiller && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4"
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Confirm Recharge</h3>
              
              {/* Recharge Summary */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mb-4">
                <table className="w-full">
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Biller</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{selectedBiller.biller_name}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">
                        {inputParamFields.length > 0 ? inputParamFields[0].paramName : 'Mobile Number'}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                        {inputParamFields.length > 0 ? inputParams[inputParamFields[0].paramName] : consumerNumber}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Recharge Amount</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">₹{parseFloat(prepaidAmount).toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Service Charges</td>
                      <td className="px-4 py-3 text-sm font-medium text-orange-600 dark:text-orange-400">₹{prepaidCharges.toFixed(2)}</td>
                    </tr>
                    <tr className="bg-blue-50 dark:bg-blue-900/20">
                      <td className="px-4 py-3 text-sm font-semibold text-blue-700 dark:text-blue-300">Total Deduction</td>
                      <td className="px-4 py-3 text-sm font-bold text-blue-700 dark:text-blue-300">
                        ₹{(parseFloat(prepaidAmount) + prepaidCharges).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* T-PIN Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  T-PIN (Optional)
                </label>
                <input
                  type="password"
                  value={tpin}
                  onChange={(e) => {
                    setTpin(e.target.value.replace(/\D/g, '').slice(0, 6))
                    setTpinError(null)
                  }}
                  placeholder="Enter T-PIN if configured"
                  maxLength={6}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {tpinError && (
                  <p className="text-xs text-red-500 mt-1">{tpinError}</p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowPrepaidConfirm(false)
                    setTpin('')
                    setTpinError(null)
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Back
                </button>
                <button
                  onClick={payPrepaid}
                  disabled={paying}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {paying ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Confirm & Pay ₹{(parseFloat(prepaidAmount) + prepaidCharges).toFixed(2)}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* Bill Details - Step 1: Show Bill Details */}
          {billDetails && paymentStep === 'bill' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Bill Details</h3>
                <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                  {selectedBiller?.biller_name}
                </span>
              </div>
              
              {/* Bill Details Table */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mb-4">
                <table className="w-full">
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {billDetails.consumer_name && (
                      <tr>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Customer Name</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{billDetails.consumer_name}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Bill Amount</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{formatPaiseAsRupees(billDetails.bill_amount)}</td>
                    </tr>
                    {billDetails.bill_date && (
                      <tr>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Bill Date</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                          {new Date(billDetails.bill_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                      </tr>
                    )}
                    {billDetails.due_date && (
                      <tr>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Due Date</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                          {new Date(billDetails.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Biller Name</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{selectedBiller?.biller_name}</td>
                    </tr>
                    {/* Minimum Amount Due - from additional info */}
                    {(() => {
                      const additionalInfo = billDetails.additional_info?.additionalInfo?.info || 
                                            billDetails.additional_info?.billerResponse?.additionalInfo?.info || []
                      const minAmount = additionalInfo.find((info: any) => 
                        info.infoName?.toLowerCase().includes('minimum') || 
                        info.infoName?.toLowerCase().includes('min due') ||
                        info.infoName?.toLowerCase().includes('min payable')
                      )
                      if (minAmount) {
                        return (
                          <tr className="bg-green-50 dark:bg-green-900/20">
                            <td className="px-4 py-3 text-sm text-green-700 dark:text-green-400 font-medium">Minimum Amount Due</td>
                            <td className="px-4 py-3 text-sm font-bold text-green-700 dark:text-green-300">
                              ₹{parseFloat(minAmount.infoValue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        )
                      }
                      return null
                    })()}
                  </tbody>
                </table>
              </div>

              {/* Amount Selection */}
              <div className="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Select Payment Amount
                  </label>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    You can pay any amount between minimum and full
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {/* Full Amount Button */}
                  <button
                    onClick={() => {
                      setAmountType('full')
                      setCustomAmount('')
                    }}
                    className={`px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                      amountType === 'full'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-xs uppercase tracking-wide mb-1 opacity-70">Full Amount</div>
                    <div className="font-bold">{formatPaiseAsRupees(billDetails.bill_amount)}</div>
                  </button>

                  {/* Minimum Amount Button - Only show if minimum amount is available */}
                  {(() => {
                    const minAmount = getMinimumAmount()
                    const billAmtInRupees = paiseToRupees(billDetails.bill_amount)
                    console.log('MIN BUTTON CHECK:', { 
                      minAmount, 
                      billAmountRaw: billDetails.bill_amount,
                      billAmtInRupees,
                      condition1: minAmount !== null,
                      condition2: minAmount && minAmount > 0,
                      condition3: minAmount && minAmount < billAmtInRupees,
                      shouldShow: minAmount !== null && minAmount > 0 && minAmount < billAmtInRupees
                    })
                    if (minAmount !== null && minAmount > 0 && minAmount < billAmtInRupees) {
                      return (
                        <button
                          onClick={() => {
                            setAmountType('minimum')
                            setCustomAmount('')
                          }}
                          disabled={selectedBiller?.amount_exactness === 'EXACT'}
                          className={`px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                            amountType === 'minimum'
                              ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                              : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={selectedBiller?.amount_exactness === 'EXACT' ? 'This biller requires exact amount payment' : 'Pay minimum amount due'}
                        >
                          <div className="text-xs uppercase tracking-wide mb-1 opacity-70">Minimum Due</div>
                          <div className="font-bold">₹{minAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                        </button>
                      )
                    }
                    return null
                  })()}

                  {/* Custom Amount Button - Always visible */}
                  <button
                    onClick={() => setAmountType('custom')}
                    disabled={selectedBiller?.amount_exactness === 'EXACT'}
                    className={`px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                      amountType === 'custom'
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 ring-2 ring-purple-200 dark:ring-purple-800'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-purple-300 dark:hover:border-purple-600'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={selectedBiller?.amount_exactness === 'EXACT' ? 'This biller requires exact amount payment' : 'Pay any custom amount between minimum and full amount'}
                  >
                    <div className="text-xs uppercase tracking-wide mb-1 opacity-70">Custom Amount</div>
                    <div className="font-bold">{customAmount ? `₹${parseFloat(customAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'Enter Amount'}</div>
                  </button>
                </div>

                {amountType === 'custom' && (
                  <div className="mt-3 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">₹</span>
                      <input
                        type="number"
                        value={customAmount}
                        onChange={(e) => {
                          const value = e.target.value
                          const billAmtInRupees = paiseToRupees(billDetails.bill_amount)
                          const minAmt = getMinimumAmount()
                          const maxValue = Math.min(parseFloat(value) || 0, billAmtInRupees)
                          const minValue = minAmt || 1
                          if (value === '' || (parseFloat(value) >= minValue && parseFloat(value) <= billAmtInRupees)) {
                            setCustomAmount(value)
                          }
                        }}
                        placeholder={`Enter amount (Min: ₹${getMinimumAmount()?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '1'})`}
                        max={paiseToRupees(billDetails.bill_amount)}
                        min={getMinimumAmount() || 1}
                        className="w-full pl-8 pr-4 py-3 border-2 border-purple-300 dark:border-purple-700 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-lg font-semibold"
                        autoFocus
                      />
                    </div>
                    <div className="flex items-center justify-between mt-2 text-xs">
                      <span className="text-gray-600 dark:text-gray-400">
                        Min: ₹{getMinimumAmount()?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '1'}
                      </span>
                      <span className="text-gray-600 dark:text-gray-400">
                        Max: {formatPaiseAsRupees(billDetails.bill_amount)}
                      </span>
                    </div>
                    {customAmount && parseFloat(customAmount) > 0 && (
                      <div className="mt-2 text-xs text-purple-700 dark:text-purple-300 font-medium">
                        You will pay: ₹{parseFloat(customAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={proceedToConfirmation}
                disabled={loadingCharges || (amountType === 'custom' && (!customAmount || parseFloat(customAmount) <= 0))}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-semibold mt-4"
              >
                {loadingCharges ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Calculating Charges...
                  </>
                ) : (
                  <>
                    Verify
                  </>
                )}
              </button>
            </motion.div>
          )}

          {/* Step 2: Confirmation with Charges and T-PIN */}
          {billDetails && paymentStep === 'confirm' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {selectedCategory.toUpperCase()} PAYMENT
                </h3>
                <button
                  onClick={goBackToBill}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  GO BACK
                </button>
              </div>

              {/* Bill Summary Table */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mb-4">
                <table className="w-full">
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {billDetails.consumer_name && (
                      <tr>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Customer Name</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{billDetails.consumer_name}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Bill Amount</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{formatPaiseAsRupees(billDetails.bill_amount)}</td>
                    </tr>
                    {billDetails.bill_date && (
                      <tr>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Bill Date</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                          {new Date(billDetails.bill_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                      </tr>
                    )}
                    {billDetails.due_date && (
                      <tr>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Due Date</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                          {new Date(billDetails.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Biller Name</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{selectedBiller?.biller_name}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Payment Breakdown */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mb-4">
                <table className="w-full">
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">
                        Amount
                        {amountType === 'minimum' && <span className="ml-1 text-xs text-green-600">(Min Due)</span>}
                        {amountType === 'custom' && <span className="ml-1 text-xs text-purple-600">(Custom)</span>}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                        ₹{getSelectedAmount().toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">Charges</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                        ₹{paymentCharges.toFixed(2)}
                      </td>
                    </tr>
                    <tr className="bg-blue-50 dark:bg-blue-900/20">
                      <td className="px-4 py-3 text-sm font-semibold text-blue-700 dark:text-blue-300">Deduction</td>
                      <td className="px-4 py-3 text-sm font-bold text-blue-700 dark:text-blue-300">
                        ₹{(getSelectedAmount() + paymentCharges).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* T-PIN Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  T-PIN
                  <span className="text-xs text-gray-500 ml-1">(Optional - if configured)</span>
                </label>
                <input
                  type="password"
                  value={tpin}
                  onChange={(e) => {
                    setTpin(e.target.value.replace(/\D/g, '').slice(0, 6))
                    setTpinError(null)
                  }}
                  placeholder="Enter T-PIN (if set)"
                  maxLength={6}
                  className={`w-full px-4 py-3 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    tpinError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {tpinError && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">{tpinError}</p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Leave empty if you haven't set up T-PIN in Settings
                </p>
              </div>

              {/* Wallet Balance Info */}
              {walletBalance !== null && (
                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Available Balance:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      ₹{walletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={payBill}
                disabled={paying || (tpin.length > 0 && tpin.length < 4)}
                className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-semibold"
              >
                {paying ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing Payment...
                  </>
                ) : (
                  <>
                    <Wallet className="w-5 h-5" />
                    Confirm
                  </>
                )}
              </button>
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
