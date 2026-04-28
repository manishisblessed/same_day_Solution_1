'use client';

/**
 * AEPS Transaction Component - Beautiful Production-Ready UI
 * Handles balance inquiry, cash withdrawal, cash deposit, and mini statement
 */

import { useState, useEffect } from 'react';
import {
  Wallet, CreditCard, FileText, Loader2, CheckCircle, XCircle, AlertCircle, ArrowLeft,
  Fingerprint, Building2, Phone, IndianRupee, Copy, Eye, EyeOff, Info, Banknote,
  Receipt, Sparkles, ArrowRight, BadgeCheck, Shield, Clock, Download, Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetchJson } from '@/lib/api-client';
import type { AEPSBank, AEPSTransactionType, MiniStatementEntry } from '@/types/aeps.types';

interface AEPSTransactionProps {
  merchantId?: string;
  onTransactionComplete?: (result: TransactionResult) => void;
}

interface TransactionResult {
  success: boolean;
  transactionId?: string;
  orderId?: string;
  utr?: string;
  status: string;
  message: string;
  data?: {
    bankName?: string;
    accountNumber?: string;
    amount?: number;
    balance?: string;
    miniStatement?: MiniStatementEntry[];
  };
  walletBalance?: number;
}

type Step = 'select' | 'input' | 'confirm' | 'processing' | 'result';

const transactionTypes = [
  {
    id: 'balance_inquiry' as AEPSTransactionType,
    title: 'Balance Inquiry',
    description: 'Check bank account balance',
    icon: Wallet,
    gradient: 'from-blue-500 to-cyan-500',
    bgLight: 'bg-blue-50',
    textColor: 'text-blue-600',
    requiresAmount: false,
  },
  {
    id: 'cash_withdrawal' as AEPSTransactionType,
    title: 'Cash Withdrawal',
    description: 'Withdraw cash from bank',
    icon: Banknote,
    gradient: 'from-green-500 to-emerald-500',
    bgLight: 'bg-green-50',
    textColor: 'text-green-600',
    requiresAmount: true,
  },
  {
    id: 'cash_deposit' as AEPSTransactionType,
    title: 'Cash Deposit',
    description: 'Deposit money to account',
    icon: CreditCard,
    gradient: 'from-purple-500 to-violet-500',
    bgLight: 'bg-purple-50',
    textColor: 'text-purple-600',
    requiresAmount: true,
  },
  {
    id: 'mini_statement' as AEPSTransactionType,
    title: 'Mini Statement',
    description: 'View recent transactions',
    icon: Receipt,
    gradient: 'from-orange-500 to-amber-500',
    bgLight: 'bg-orange-50',
    textColor: 'text-orange-600',
    requiresAmount: false,
  },
];

const stepVariants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, x: -20, transition: { duration: 0.2 } }
};

export default function AEPSTransaction({ merchantId: propMerchantId, onTransactionComplete }: AEPSTransactionProps) {
  const { user } = useAuth();
  
  const [step, setStep] = useState<Step>('select');
  const [selectedType, setSelectedType] = useState<AEPSTransactionType | null>(null);
  const [banks, setBanks] = useState<AEPSBank[]>([]);
  const [selectedBank, setSelectedBank] = useState<AEPSBank | null>(null);
  const [customerAadhaar, setCustomerAadhaar] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [amount, setAmount] = useState('');
  const [showAadhaar, setShowAadhaar] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransactionResult | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [isMockMode, setIsMockMode] = useState(false);
  const [merchantId, setMerchantId] = useState(propMerchantId || '');
  const [bankSearchQuery, setBankSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (merchantId) {
      loadBanks();
      checkLoginStatus();
    }
    loadWalletBalance();
  }, [merchantId]);

  const loadBanks = async () => {
    try {
      const response = await apiFetchJson(`/api/aeps/banks?merchantId=${merchantId}`);
      if (response.success && response.data) {
        setBanks(response.data);
      }
    } catch (err) {
      setBanks([
        { iin: '607094', bankName: 'HDFC Bank' },
        { iin: '607152', bankName: 'State Bank of India' },
        { iin: '505290', bankName: 'Axis Bank' },
        { iin: '607095', bankName: 'ICICI Bank' },
        { iin: '508534', bankName: 'Punjab National Bank' },
        { iin: '607387', bankName: 'Bank of Baroda' },
      ]);
    }
  };

  const checkLoginStatus = async () => {
    try {
      const response = await apiFetchJson('/api/aeps/login-status', {
        method: 'POST',
        body: JSON.stringify({ merchantId, type: 'withdraw' }),
      });
      setIsMockMode(response.isMockMode || false);
      if (response.data?.bankList?.length > 0) {
        setBanks(response.data.bankList);
      }
    } catch (err) {
      console.error('Login status check failed:', err);
    }
  };

  const loadWalletBalance = async () => {
    try {
      const response = await apiFetchJson('/api/wallet/balance?wallet_type=aeps');
      if (response.balance !== undefined) {
        setWalletBalance(response.balance);
      }
    } catch (err) {
      console.error('Wallet balance load failed:', err);
    }
  };

  const validateInputs = (): boolean => {
    const cleanAadhaar = customerAadhaar.replace(/\s/g, '');
    if (!/^\d{12}$/.test(cleanAadhaar)) {
      setError('Please enter a valid 12-digit Aadhaar number');
      return false;
    }
    if (!/^[6-9]\d{9}$/.test(customerMobile)) {
      setError('Please enter a valid 10-digit mobile number');
      return false;
    }
    if (!selectedBank) {
      setError('Please select a bank');
      return false;
    }
    const typeConfig = transactionTypes.find(t => t.id === selectedType);
    if (typeConfig?.requiresAmount) {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount < 100) {
        setError('Minimum amount is ₹100');
        return false;
      }
      if (numAmount > 10000) {
        setError('Maximum amount is ₹10,000');
        return false;
      }
      if (selectedType === 'cash_withdrawal' && numAmount > walletBalance) {
        setError(`Insufficient balance. Available: ₹${walletBalance.toLocaleString('en-IN')}`);
        return false;
      }
    }
    return true;
  };

  const handleConfirmTransaction = async () => {
    setStep('processing');
    setError(null);
    setIsLoading(true);

    try {
      const typeConfig = transactionTypes.find(t => t.id === selectedType);
      const response = await apiFetchJson('/api/aeps/transact', {
        method: 'POST',
        body: JSON.stringify({
          merchantId,
          transactionType: selectedType,
          amount: typeConfig?.requiresAmount ? parseFloat(amount) : 0,
          customerAadhaar: customerAadhaar.replace(/\s/g, ''),
          customerMobile: customerMobile.replace(/\s/g, ''),
          bankIin: selectedBank?.iin,
          bankName: selectedBank?.bankName,
        }),
      });

      setResult(response);
      setStep('result');
      if (response.walletBalance !== undefined) {
        setWalletBalance(response.walletBalance);
      }
      onTransactionComplete?.(response);
    } catch (err: any) {
      setError(err.message || 'Transaction failed');
      setStep('input');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewTransaction = () => {
    setStep('select');
    setSelectedType(null);
    setSelectedBank(null);
    setCustomerAadhaar('');
    setCustomerMobile('');
    setAmount('');
    setError(null);
    setResult(null);
    setBankSearchQuery('');
  };

  const formatAadhaar = (value: string): string => {
    const digits = value.replace(/\D/g, '').slice(0, 12);
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  };

  const maskAadhaar = (aadhaar: string): string => {
    const clean = aadhaar.replace(/\s/g, '');
    return clean.length === 12 ? `XXXX XXXX ${clean.slice(-4)}` : aadhaar;
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(amount);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredBanks = banks.filter(bank => 
    bank.bankName.toLowerCase().includes(bankSearchQuery.toLowerCase())
  );

  // ============ RENDER: TYPE SELECTION ============
  const renderTypeSelection = () => (
    <motion.div variants={stepVariants} initial="hidden" animate="visible" exit="exit" className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-100">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AEPS Transaction</h2>
          <p className="text-gray-500 mt-1">Select a service to proceed</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Wallet Balance</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(walletBalance)}</p>
        </div>
      </div>

      {/* Mock Mode Indicator */}
      {isMockMode && (
        <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-xl">
          <Sparkles className="w-5 h-5 text-amber-500" />
          <p className="text-sm text-amber-800"><strong>Test Mode Active</strong> - No real biometric needed</p>
        </div>
      )}

      {/* Service Cards */}
      <div className="grid grid-cols-2 gap-4">
        {transactionTypes.map((type, i) => (
          <motion.button
            key={type.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0, transition: { delay: i * 0.1 } }}
            whileHover={{ scale: 1.03, y: -4 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => { setSelectedType(type.id); setStep('input'); setError(null); }}
            className="relative group p-5 bg-white rounded-2xl border-2 border-gray-100 hover:border-orange-200 text-left overflow-hidden transition-all hover:shadow-lg"
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${type.gradient} opacity-0 group-hover:opacity-5 transition-opacity`} />
            <div className="relative z-10">
              <div className={`inline-flex items-center justify-center w-12 h-12 ${type.bgLight} rounded-xl mb-3 group-hover:scale-110 transition-transform`}>
                <type.icon className={`w-6 h-6 ${type.textColor}`} />
              </div>
              <h3 className="font-bold text-gray-900">{type.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{type.description}</p>
            </div>
            <ArrowRight className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300 group-hover:text-orange-500 group-hover:translate-x-1 transition-all" />
          </motion.button>
        ))}
      </div>
    </motion.div>
  );

  // ============ RENDER: INPUT FORM ============
  const renderInputForm = () => {
    const typeConfig = transactionTypes.find(t => t.id === selectedType);
    if (!typeConfig) return null;

    return (
      <motion.div variants={stepVariants} initial="hidden" animate="visible" exit="exit" className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4 pb-4 border-b border-gray-100">
          <button onClick={() => setStep('select')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className={`p-3 rounded-xl bg-gradient-to-br ${typeConfig.gradient}`}>
            <typeConfig.icon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{typeConfig.title}</h2>
            <p className="text-sm text-gray-500">{typeConfig.description}</p>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-800">Validation Error</p>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </motion.div>
        )}

        {/* Form Fields */}
        <div className="space-y-5">
          {/* Bank Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <Building2 className="w-4 h-4 inline mr-2 text-gray-500" />
              Customer's Bank
            </label>
            <input
              type="text"
              placeholder="Search bank..."
              value={bankSearchQuery}
              onChange={(e) => setBankSearchQuery(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all mb-2"
            />
            <div className="max-h-40 overflow-y-auto border-2 border-gray-200 rounded-xl divide-y divide-gray-100">
              {filteredBanks.slice(0, 10).map((bank) => (
                <button
                  key={bank.iin}
                  type="button"
                  onClick={() => { setSelectedBank(bank); setBankSearchQuery(bank.bankName); }}
                  className={`w-full px-4 py-3 text-left hover:bg-orange-50 transition-colors flex items-center justify-between ${
                    selectedBank?.iin === bank.iin ? 'bg-orange-50' : ''
                  }`}
                >
                  <span className="font-medium text-gray-800">{bank.bankName}</span>
                  {selectedBank?.iin === bank.iin && <CheckCircle className="w-5 h-5 text-orange-600" />}
                </button>
              ))}
            </div>
          </div>

          {/* Aadhaar Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <Fingerprint className="w-4 h-4 inline mr-2 text-gray-500" />
              Customer Aadhaar Number
            </label>
            <div className="relative">
              <input
                type={showAadhaar ? 'text' : 'password'}
                value={customerAadhaar}
                onChange={(e) => setCustomerAadhaar(formatAadhaar(e.target.value))}
                placeholder="XXXX XXXX XXXX"
                maxLength={14}
                className="w-full px-4 py-3 pr-12 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all font-mono text-lg"
              />
              <button type="button" onClick={() => setShowAadhaar(!showAadhaar)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showAadhaar ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Mobile Input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <Phone className="w-4 h-4 inline mr-2 text-gray-500" />
              Customer Mobile Number
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">+91</span>
              <input
                type="tel"
                value={customerMobile}
                onChange={(e) => setCustomerMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="9876543210"
                maxLength={10}
                className="w-full pl-14 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all font-mono text-lg"
              />
            </div>
          </div>

          {/* Amount Input */}
          {typeConfig.requiresAmount && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                <IndianRupee className="w-4 h-4 inline mr-2 text-gray-500" />
                Amount
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-gray-400">₹</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter amount"
                  min="100" max="10000" step="100"
                  className="w-full pl-12 pr-4 py-4 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all text-2xl font-bold"
                />
              </div>
              <p className="text-sm text-gray-500 mt-2">Min: ₹100 | Max: ₹10,000</p>
              
              {/* Quick Amount Buttons */}
              <div className="flex flex-wrap gap-2 mt-3">
                {[500, 1000, 2000, 5000, 10000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAmount(String(amt))}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
                      amount === String(amt)
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    ₹{amt.toLocaleString('en-IN')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Proceed Button */}
        <button
          onClick={() => { if (validateInputs()) setStep('confirm'); }}
          className="w-full py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold text-lg rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all shadow-lg shadow-orange-200 hover:shadow-xl flex items-center justify-center gap-2"
        >
          Continue <ArrowRight className="w-5 h-5" />
        </button>
      </motion.div>
    );
  };

  // ============ RENDER: CONFIRMATION ============
  const renderConfirmation = () => {
    const typeConfig = transactionTypes.find(t => t.id === selectedType);
    if (!typeConfig) return null;

    return (
      <motion.div variants={stepVariants} initial="hidden" animate="visible" exit="exit" className="space-y-6">
        <div className="flex items-center gap-4 pb-4 border-b border-gray-100">
          <button onClick={() => setStep('input')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-xl font-bold text-gray-900">Confirm Transaction</h2>
        </div>

        {/* Transaction Summary Card */}
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-4 pb-4 border-b border-gray-200">
            <div className={`p-3 rounded-xl bg-gradient-to-br ${typeConfig.gradient}`}>
              <typeConfig.icon className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Transaction Type</p>
              <p className="font-bold text-gray-900">{typeConfig.title}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Bank</p>
              <p className="font-semibold text-gray-900">{selectedBank?.bankName}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Aadhaar</p>
              <p className="font-mono text-gray-900">{maskAadhaar(customerAadhaar)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Mobile</p>
              <p className="font-mono text-gray-900">+91 {customerMobile}</p>
            </div>
            {typeConfig.requiresAmount && (
              <div>
                <p className="text-sm text-gray-500">Amount</p>
                <p className="text-xl font-bold text-orange-600">{formatCurrency(parseFloat(amount))}</p>
              </div>
            )}
          </div>
        </div>

        {/* Warning for withdrawals */}
        {selectedType === 'cash_withdrawal' && (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              <strong>{formatCurrency(parseFloat(amount))}</strong> will be debited from your AEPS wallet.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-4">
          <button onClick={() => setStep('input')} className="flex-1 py-4 border-2 border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all">
            Edit Details
          </button>
          <button onClick={handleConfirmTransaction} className="flex-1 py-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl hover:from-green-600 hover:to-emerald-700 transition-all shadow-lg shadow-green-200 flex items-center justify-center gap-2">
            <BadgeCheck className="w-5 h-5" /> Confirm & Pay
          </button>
        </div>
      </motion.div>
    );
  };

  // ============ RENDER: PROCESSING ============
  const renderProcessing = () => (
    <motion.div variants={stepVariants} initial="hidden" animate="visible" className="py-16 text-center">
      <div className="relative inline-block mb-8">
        <div className="w-28 h-28 rounded-full bg-gradient-to-br from-orange-100 to-orange-200 animate-pulse" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-14 h-14 text-orange-600 animate-spin" />
        </div>
        <Fingerprint className="w-8 h-8 text-orange-400 absolute bottom-2 right-2" />
      </div>
      <h3 className="text-2xl font-bold text-gray-900">Processing Transaction</h3>
      <p className="text-gray-500 mt-2">Please wait while we complete your request...</p>
      {isMockMode && (
        <p className="text-sm text-amber-600 mt-6 flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4" /> Test Mode - Simulating transaction
        </p>
      )}
    </motion.div>
  );

  // ============ RENDER: RESULT ============
  const renderResult = () => {
    const isSuccess = result?.success;
    const typeConfig = transactionTypes.find(t => t.id === selectedType);

    return (
      <motion.div variants={stepVariants} initial="hidden" animate="visible" className="space-y-6">
        {/* Result Header */}
        <div className={`rounded-2xl p-8 text-center ${isSuccess ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-red-500 to-rose-600'}`}>
          <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-4 ${isSuccess ? 'bg-white/20' : 'bg-white/20'}`}>
            {isSuccess ? <CheckCircle className="w-10 h-10 text-white" /> : <XCircle className="w-10 h-10 text-white" />}
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">
            {isSuccess ? 'Transaction Successful!' : 'Transaction Failed'}
          </h3>
          <p className="text-white/80">{result?.message}</p>
        </div>

        {/* Transaction Details */}
        {isSuccess && result?.data && (
          <div className="bg-gray-50 rounded-2xl p-6 space-y-4">
            {result.orderId && (
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Order ID</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm bg-white px-3 py-1 rounded-lg border">{result.orderId}</span>
                  <button onClick={() => copyToClipboard(result.orderId!)} className={`p-2 rounded-lg transition-colors ${copied ? 'bg-green-100 text-green-600' : 'hover:bg-gray-200 text-gray-500'}`}>
                    {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
            {result.utr && (
              <div className="flex justify-between items-center">
                <span className="text-gray-600">UTR/RRN</span>
                <span className="font-mono font-semibold">{result.utr}</span>
              </div>
            )}
            {result.data.bankName && (
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Bank</span>
                <span className="font-semibold">{result.data.bankName}</span>
              </div>
            )}
            {result.data.accountNumber && (
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Account</span>
                <span className="font-mono">{result.data.accountNumber}</span>
              </div>
            )}
            {result.data.balance && (
              <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                <span className="text-gray-700 font-medium">Account Balance</span>
                <span className="text-2xl font-bold text-green-600">₹{result.data.balance}</span>
              </div>
            )}
            {typeConfig?.requiresAmount && result.data.amount !== undefined && (
              <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                <span className="text-gray-700 font-medium">Transaction Amount</span>
                <span className="text-2xl font-bold text-orange-600">{formatCurrency(result.data.amount)}</span>
              </div>
            )}
          </div>
        )}

        {/* Mini Statement */}
        {result?.data?.miniStatement && result.data.miniStatement.length > 0 && (
          <div className="rounded-2xl border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-5 py-4 border-b border-gray-200">
              <h4 className="font-bold text-gray-900 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-gray-600" />
                Mini Statement
              </h4>
            </div>
            <div className="divide-y divide-gray-100">
              {result.data.miniStatement.map((entry, index) => (
                <div key={index} className="px-5 py-4 flex justify-between items-center hover:bg-gray-50 transition-colors">
                  <div>
                    <p className="font-medium text-gray-900">{entry.narration}</p>
                    <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                      <Clock className="w-3 h-3" /> {entry.date}
                    </p>
                  </div>
                  <span className={`text-lg font-bold ${entry.txnType === 'Cr' ? 'text-green-600' : 'text-red-600'}`}>
                    {entry.txnType === 'Cr' ? '+' : '-'}₹{entry.amount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Updated Wallet Balance */}
        {result?.walletBalance !== undefined && (
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-2xl p-6 text-center border border-orange-200">
            <p className="text-sm text-orange-700 uppercase tracking-wider mb-1">Updated Wallet Balance</p>
            <p className="text-3xl font-bold text-orange-600">{formatCurrency(result.walletBalance)}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-4">
          <button onClick={handleNewTransaction} className="flex-1 py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all shadow-lg shadow-orange-200">
            New Transaction
          </button>
          {isSuccess && (
            <button onClick={() => window.print()} className="px-6 py-4 border-2 border-gray-200 rounded-xl hover:bg-gray-50 transition-colors flex items-center gap-2 text-gray-700">
              <Download className="w-5 h-5" /> Receipt
            </button>
          )}
        </div>
      </motion.div>
    );
  };

  // ============ MAIN RENDER ============
  return (
    <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
      <div className="p-6 md:p-8">
        <AnimatePresence mode="wait">
          {step === 'select' && renderTypeSelection()}
          {step === 'input' && renderInputForm()}
          {step === 'confirm' && renderConfirmation()}
          {step === 'processing' && renderProcessing()}
          {step === 'result' && renderResult()}
        </AnimatePresence>
      </div>
    </div>
  );
}
