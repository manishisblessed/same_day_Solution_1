'use client'

import { useState, useMemo } from 'react'
import { apiFetch } from '@/lib/api-client'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wallet, Send, Search, CheckCircle2, XCircle, Loader2,
  AlertCircle, ChevronRight, ChevronDown, Copy, RotateCcw,
  Zap, ArrowRight, Hash, Building2, User, IndianRupee,
  Clock, Shield, Terminal,
} from 'lucide-react'

type TestStep = 'balance' | 'transfer' | 'status'
type StepStatus = 'idle' | 'running' | 'success' | 'failed'

interface StepResult {
  status: StepStatus
  request?: any
  response?: any
  duration?: number
  error?: string
}

const STEPS: { key: TestStep; label: string; description: string; icon: any; api: string }[] = [
  { key: 'balance', label: 'Check Balance', description: 'GET /api/shadval-pay/balance', icon: Wallet, api: 'Wallet Balance API' },
  { key: 'transfer', label: 'Bank Transfer', description: 'POST /api/shadval-pay/transfer', icon: Send, api: 'Initiate Transfer API' },
  { key: 'status', label: 'Check Status', description: 'POST /api/shadval-pay/status', icon: Search, api: 'Transaction Status API' },
]

export default function ShadvalPayApiTester() {
  const [activeStep, setActiveStep] = useState<TestStep>('balance')
  const [results, setResults] = useState<Record<TestStep, StepResult>>({
    balance: { status: 'idle' },
    transfer: { status: 'idle' },
    status: { status: 'idle' },
  })
  const [expandedJson, setExpandedJson] = useState<Record<TestStep, boolean>>({
    balance: true, transfer: true, status: true,
  })

  // Transfer form fields
  const [accountNumber, setAccountNumber] = useState('9632587410')
  const [ifscCode, setIfscCode] = useState('SBIN0001234')
  const [beneficiaryName, setBeneficiaryName] = useState('Test User')
  const [amount, setAmount] = useState('1')
  const [transferMode, setTransferMode] = useState<'IMPS' | 'NEFT' | 'RTGS'>('IMPS')
  const [narration, setNarration] = useState('UAT API Test')

  // Status check
  const [statusRefId, setStatusRefId] = useState('')

  // Derived from transfer result
  const lastTransferRefId = results.transfer.response?.data?.reference_id || ''

  const amountNum = useMemo(() => {
    const n = parseFloat(amount)
    return isNaN(n) ? 0 : n
  }, [amount])

  const generateRefId = (): string => {
    const ts = Date.now().toString(36).toUpperCase()
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
    return `SDSTEST_${ts}${rand}`
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const currentStepIdx = STEPS.findIndex(s => s.key === activeStep)
  const allPassed = STEPS.every(s => results[s.key].status === 'success')

  // ── Step 1: Balance ──────────────────────────────────────────
  const runBalanceTest = async () => {
    setResults(prev => ({ ...prev, balance: { status: 'running' } }))
    const start = performance.now()

    try {
      const res = await apiFetch('/api/shadval-pay/balance')
      const data = await res.json()
      const duration = Math.round(performance.now() - start)

      if (data.success) {
        setResults(prev => ({
          ...prev,
          balance: { status: 'success', response: data, duration, request: { method: 'GET', url: '/api/shadval-pay/balance' } },
        }))
      } else {
        setResults(prev => ({
          ...prev,
          balance: { status: 'failed', response: data, duration, error: data.error, request: { method: 'GET', url: '/api/shadval-pay/balance' } },
        }))
      }
    } catch (err: any) {
      const duration = Math.round(performance.now() - start)
      setResults(prev => ({
        ...prev,
        balance: { status: 'failed', duration, error: err.message || 'Network error', request: { method: 'GET', url: '/api/shadval-pay/balance' } },
      }))
    }
  }

  // ── Step 2: Transfer ─────────────────────────────────────────
  const runTransferTest = async () => {
    const refId = generateRefId()
    const body = {
      amount: amountNum,
      mode: transferMode,
      account_number: accountNumber,
      ifsc: ifscCode.toUpperCase(),
      beneficiary_name: beneficiaryName,
      contact_name: 'Test User',
      contact_email: 'test@example.com',
      contact_mobile: '9999999999',
      reference_id: refId,
      narration: narration || 'UAT API Test',
    }

    setResults(prev => ({ ...prev, transfer: { status: 'running' } }))
    const start = performance.now()

    try {
      const res = await apiFetch('/api/shadval-pay/transfer', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      const duration = Math.round(performance.now() - start)

      if (data.success) {
        setStatusRefId(data.data?.reference_id || refId)
        setResults(prev => ({
          ...prev,
          transfer: { status: 'success', response: data, duration, request: { method: 'POST', url: '/api/shadval-pay/transfer', body } },
        }))
      } else {
        setResults(prev => ({
          ...prev,
          transfer: { status: 'failed', response: data, duration, error: data.error, request: { method: 'POST', url: '/api/shadval-pay/transfer', body } },
        }))
      }
    } catch (err: any) {
      const duration = Math.round(performance.now() - start)
      setResults(prev => ({
        ...prev,
        transfer: { status: 'failed', duration, error: err.message || 'Network error', request: { method: 'POST', url: '/api/shadval-pay/transfer', body } },
      }))
    }
  }

  // ── Step 3: Status ───────────────────────────────────────────
  const runStatusTest = async () => {
    const ref = statusRefId || lastTransferRefId
    if (!ref) return

    const body = { reference_id: ref }
    setResults(prev => ({ ...prev, status: { status: 'running' } }))
    const start = performance.now()

    try {
      const res = await apiFetch('/api/shadval-pay/status', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      const duration = Math.round(performance.now() - start)

      if (data.success) {
        setResults(prev => ({
          ...prev,
          status: { status: 'success', response: data, duration, request: { method: 'POST', url: '/api/shadval-pay/status', body } },
        }))
      } else {
        setResults(prev => ({
          ...prev,
          status: { status: 'failed', response: data, duration, error: data.error, request: { method: 'POST', url: '/api/shadval-pay/status', body } },
        }))
      }
    } catch (err: any) {
      const duration = Math.round(performance.now() - start)
      setResults(prev => ({
        ...prev,
        status: { status: 'failed', duration, error: err.message || 'Network error', request: { method: 'POST', url: '/api/shadval-pay/status', body } },
      }))
    }
  }

  // ── Run All ──────────────────────────────────────────────────
  const runAllTests = async () => {
    setActiveStep('balance')
    await runBalanceTest()
    setActiveStep('transfer')
    await runTransferTest()
    setActiveStep('status')
    await runStatusTest()
  }

  const resetAll = () => {
    setResults({
      balance: { status: 'idle' },
      transfer: { status: 'idle' },
      status: { status: 'idle' },
    })
    setActiveStep('balance')
    setStatusRefId('')
  }

  const statusIcon = (s: StepStatus) => {
    switch (s) {
      case 'idle': return <div className="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-600" />
      case 'running': return <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
      case 'success': return <CheckCircle2 className="w-6 h-6 text-emerald-500" />
      case 'failed': return <XCircle className="w-6 h-6 text-red-500" />
    }
  }

  const statusBadge = (s: StepStatus) => {
    const base = 'px-2.5 py-0.5 rounded-full text-xs font-semibold'
    switch (s) {
      case 'idle': return <span className={`${base} bg-gray-100 dark:bg-gray-800 text-gray-500`}>Pending</span>
      case 'running': return <span className={`${base} bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400`}>Running...</span>
      case 'success': return <span className={`${base} bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400`}>PASSED</span>
      case 'failed': return <span className={`${base} bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400`}>FAILED</span>
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 text-blue-600" />
            API Test Console
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Test all 3 ShadvalPay APIs step by step — Balance, Transfer, Status
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={resetAll}
            className="px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-all flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            onClick={runAllTests}
            disabled={STEPS.some(s => results[s.key].status === 'running')}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
          >
            <Zap className="w-3.5 h-3.5" />
            Run All Tests
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      {STEPS.some(s => results[s.key].status !== 'idle') && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-2xl border flex items-center justify-between ${
            allPassed
              ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
              : STEPS.some(s => results[s.key].status === 'failed')
              ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
              : 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800'
          }`}
        >
          <div className="flex items-center gap-3">
            {allPassed ? (
              <Shield className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-blue-600" />
            )}
            <span className="font-medium text-sm text-gray-900 dark:text-white">
              {allPassed
                ? 'All 3 API tests passed! ShadvalPay integration is fully operational.'
                : `${STEPS.filter(s => results[s.key].status === 'success').length}/3 tests completed`}
            </span>
          </div>
          <div className="flex gap-1.5">
            {STEPS.map(s => (
              <div key={s.key} className="w-3 h-3 rounded-full" style={{
                backgroundColor:
                  results[s.key].status === 'success' ? '#10b981'
                  : results[s.key].status === 'failed' ? '#ef4444'
                  : results[s.key].status === 'running' ? '#3b82f6'
                  : '#d1d5db',
              }} />
            ))}
          </div>
        </motion.div>
      )}

      {/* Stepper */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {STEPS.map((step, idx) => {
          const result = results[step.key]
          const isActive = activeStep === step.key
          const StepIcon = step.icon

          return (
            <div key={step.key} className="flex items-center gap-2">
              <button
                onClick={() => setActiveStep(step.key)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all min-w-[180px] ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                    : result.status === 'success'
                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10'
                    : result.status === 'failed'
                    ? 'border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300'
                }`}
              >
                {statusIcon(result.status)}
                <div className="text-left">
                  <p className={`text-sm font-semibold ${isActive ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>
                    Step {idx + 1}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{step.label}</p>
                </div>
              </button>
              {idx < STEPS.length - 1 && (
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0" />
              )}
            </div>
          )
        })}
      </div>

      {/* Active Step Panel */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeStep}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -15 }}
          transition={{ duration: 0.2 }}
        >
          {/* ═══ STEP 1: BALANCE ═══ */}
          {activeStep === 'balance' && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Wallet className="w-5 h-5 text-blue-600" />
                    Step 1: Wallet Balance API
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
                    GET /api/shadval-pay/balance
                  </p>
                </div>
                {statusBadge(results.balance.status)}
              </div>

              <div className="p-5 space-y-4">
                <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    This API checks the SHADVAL PAY wallet balance. No parameters needed — it uses the configured API key for authentication.
                  </p>
                </div>

                <button
                  onClick={runBalanceTest}
                  disabled={results.balance.status === 'running'}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  {results.balance.status === 'running' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Testing...</>
                  ) : (
                    <><Zap className="w-4 h-4" /> Test Balance API</>
                  )}
                </button>

                <StepResultPanel step="balance" result={results.balance} expanded={expandedJson.balance} onToggle={() => setExpandedJson(prev => ({ ...prev, balance: !prev.balance }))} onCopy={copyToClipboard} />

                {results.balance.status === 'success' && (
                  <button
                    onClick={() => setActiveStep('transfer')}
                    className="w-full py-2.5 rounded-xl border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 font-medium hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all flex items-center justify-center gap-2"
                  >
                    Next: Test Bank Transfer <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ═══ STEP 2: TRANSFER ═══ */}
          {activeStep === 'transfer' && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Send className="w-5 h-5 text-blue-600" />
                    Step 2: Bank Transfer API
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
                    POST /api/shadval-pay/transfer
                  </p>
                </div>
                {statusBadge(results.transfer.status)}
              </div>

              <div className="p-5 space-y-4">
                {/* UAT Test Data Hint */}
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                  <p className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      <strong>UAT Test Accounts:</strong>{' '}
                      <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">9632587410</code> = SUCCESS,{' '}
                      <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">1234569870</code> = FAILED
                    </span>
                  </p>
                </div>

                {/* Transfer Form */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Number</label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono"
                        maxLength={18}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">IFSC Code</label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={ifscCode}
                        onChange={(e) => setIfscCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono"
                        maxLength={11}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Beneficiary Name</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={beneficiaryName}
                        onChange={(e) => setBeneficiaryName(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (INR)</label>
                    <div className="relative">
                      <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        min="1"
                        step="0.01"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* Mode selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Transfer Mode</label>
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Narration</label>
                  <input
                    type="text"
                    value={narration}
                    onChange={(e) => setNarration(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    maxLength={50}
                  />
                </div>

                <button
                  onClick={runTransferTest}
                  disabled={results.transfer.status === 'running' || !amountNum || !accountNumber || !ifscCode}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  {results.transfer.status === 'running' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Sending Transfer...</>
                  ) : (
                    <><Send className="w-4 h-4" /> Test Bank Transfer</>
                  )}
                </button>

                <StepResultPanel step="transfer" result={results.transfer} expanded={expandedJson.transfer} onToggle={() => setExpandedJson(prev => ({ ...prev, transfer: !prev.transfer }))} onCopy={copyToClipboard} />

                {results.transfer.status === 'success' && (
                  <button
                    onClick={() => setActiveStep('status')}
                    className="w-full py-2.5 rounded-xl border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 font-medium hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all flex items-center justify-center gap-2"
                  >
                    Next: Check Transaction Status <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ═══ STEP 3: STATUS ═══ */}
          {activeStep === 'status' && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Search className="w-5 h-5 text-blue-600" />
                    Step 3: Transaction Status API
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
                    POST /api/shadval-pay/status
                  </p>
                </div>
                {statusBadge(results.status.status)}
              </div>

              <div className="p-5 space-y-4">
                <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Check the status of a previously initiated transfer using its Reference ID.
                    {lastTransferRefId && (
                      <span className="block mt-1 text-blue-600 dark:text-blue-400">
                        Auto-filled from Step 2: <code className="bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded font-mono text-xs">{lastTransferRefId}</code>
                      </span>
                    )}
                  </p>
                </div>

                {/* Reference ID Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reference ID</label>
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={statusRefId}
                        onChange={(e) => setStatusRefId(e.target.value)}
                        placeholder="Enter reference ID from Step 2"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono"
                      />
                    </div>
                    {lastTransferRefId && statusRefId !== lastTransferRefId && (
                      <button
                        onClick={() => setStatusRefId(lastTransferRefId)}
                        className="px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all whitespace-nowrap"
                      >
                        Use Step 2 Ref
                      </button>
                    )}
                  </div>
                </div>

                <button
                  onClick={runStatusTest}
                  disabled={results.status.status === 'running' || (!statusRefId && !lastTransferRefId)}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-purple-700 text-white font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  {results.status.status === 'running' ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Checking Status...</>
                  ) : (
                    <><Search className="w-4 h-4" /> Test Status API</>
                  )}
                </button>

                <StepResultPanel step="status" result={results.status} expanded={expandedJson.status} onToggle={() => setExpandedJson(prev => ({ ...prev, status: !prev.status }))} onCopy={copyToClipboard} />
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ── Reusable result panel ─────────────────────────────────────
function StepResultPanel({
  step,
  result,
  expanded,
  onToggle,
  onCopy,
}: {
  step: string
  result: StepResult
  expanded: boolean
  onToggle: () => void
  onCopy: (s: string) => void
}) {
  if (result.status === 'idle' || result.status === 'running') return null

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="space-y-3"
    >
      {/* Quick Summary */}
      <div className={`p-4 rounded-xl border ${
        result.status === 'success'
          ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
          : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {result.status === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <XCircle className="w-5 h-5 text-red-500" />
            )}
            <span className="font-semibold text-sm text-gray-900 dark:text-white">
              {result.status === 'success' ? 'API Response: SUCCESS' : 'API Response: FAILED'}
            </span>
          </div>
          {result.duration !== undefined && (
            <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <Clock className="w-3 h-3" />
              {result.duration}ms
            </span>
          )}
        </div>

        {/* Key data points based on step */}
        {result.response && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs mt-3">
            {result.response.balance !== undefined && (
              <div className="p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-gray-500">Balance</span>
                <p className="font-bold text-gray-900 dark:text-white">Rs. {Number(result.response.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              </div>
            )}
            {result.response.payout_available !== undefined && (
              <div className="p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-gray-500">Payout Available</span>
                <p className="font-bold text-gray-900 dark:text-white">{result.response.payout_available ? 'Yes' : 'No'}</p>
              </div>
            )}
            {result.response.data?.reference_id && (
              <div className="p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-gray-500">Reference ID</span>
                <p className="font-mono font-bold text-gray-900 dark:text-white truncate">{result.response.data.reference_id}</p>
              </div>
            )}
            {result.response.data?.order_id && (
              <div className="p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-gray-500">Order ID</span>
                <p className="font-mono font-bold text-gray-900 dark:text-white truncate">{result.response.data.order_id}</p>
              </div>
            )}
            {result.response.data?.utr && (
              <div className="p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-gray-500">UTR</span>
                <p className="font-mono font-bold text-gray-900 dark:text-white">{result.response.data.utr}</p>
              </div>
            )}
            {result.response.data?.trans_amount !== undefined && (
              <div className="p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-gray-500">Amount</span>
                <p className="font-bold text-gray-900 dark:text-white">Rs. {result.response.data.trans_amount}</p>
              </div>
            )}
            {result.response.data?.txn_status && (
              <div className="p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-gray-500">Txn Status</span>
                <p className="font-bold text-gray-900 dark:text-white">{result.response.data.txn_status}</p>
              </div>
            )}
            {result.response.data?.mode && (
              <div className="p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-gray-500">Mode</span>
                <p className="font-bold text-gray-900 dark:text-white">{result.response.data.mode}</p>
              </div>
            )}
            {result.response.data?.wallet?.charges !== undefined && (
              <div className="p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-gray-500">Charges</span>
                <p className="font-bold text-gray-900 dark:text-white">Rs. {result.response.data.wallet.charges}</p>
              </div>
            )}
            {result.response.data?.wallet?.transaction?.charges !== undefined && (
              <div className="p-2 bg-white/60 dark:bg-gray-800/60 rounded-lg">
                <span className="text-gray-500">Charges</span>
                <p className="font-bold text-gray-900 dark:text-white">Rs. {result.response.data.wallet.transaction.charges}</p>
              </div>
            )}
          </div>
        )}

        {result.error && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-2">{result.error}</p>
        )}
      </div>

      {/* Raw JSON Toggle */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5" />
            Raw JSON Response
          </span>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <div className="relative">
                <button
                  onClick={() => onCopy(JSON.stringify(result.response || result.error, null, 2))}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors z-10"
                  title="Copy JSON"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <pre className="p-4 bg-gray-900 text-gray-100 text-xs overflow-x-auto max-h-[300px] overflow-y-auto font-mono leading-relaxed">
                  {JSON.stringify(result.response || { error: result.error }, null, 2)}
                </pre>
              </div>
              {result.request && (
                <div className="border-t border-gray-700">
                  <div className="px-4 py-2 bg-gray-800 text-xs text-gray-400">
                    <span className="font-semibold text-gray-300">Request:</span>{' '}
                    <span className="text-blue-400">{result.request.method}</span>{' '}
                    <span className="text-gray-300">{result.request.url}</span>
                  </div>
                  {result.request.body && (
                    <pre className="px-4 py-2 bg-gray-900 text-gray-300 text-xs overflow-x-auto max-h-[150px] overflow-y-auto font-mono">
                      {JSON.stringify(result.request.body, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
