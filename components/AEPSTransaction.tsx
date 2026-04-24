'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wallet, CreditCard, Receipt, FileText, RefreshCw,
  Loader2, CheckCircle, XCircle, AlertCircle, ArrowLeft,
  Fingerprint, Building2, Phone, User, IndianRupee,
  Download, Printer, Copy, Eye, EyeOff, Info, Smartphone
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
    description: 'Check account balance',
    icon: Wallet,
    color: 'from-blue-500 to-blue-600',
    requiresAmount: false,
  },
  {
    id: 'cash_withdrawal' as AEPSTransactionType,
    title: 'Cash Withdrawal',
    description: 'Withdraw cash from account',
    icon: IndianRupee,
    color: 'from-green-500 to-green-600',
    requiresAmount: true,
  },
  {
    id: 'cash_deposit' as AEPSTransactionType,
    title: 'Cash Deposit',
    description: 'Deposit cash to account',
    icon: CreditCard,
    color: 'from-purple-500 to-purple-600',
    requiresAmount: true,
  },
  {
    id: 'mini_statement' as AEPSTransactionType,
    title: 'Mini Statement',
    description: 'View last 5 transactions',
    icon: FileText,
    color: 'from-orange-500 to-orange-600',
    requiresAmount: false,
  },
];

export default function AEPSTransaction({ merchantId: propMerchantId, onTransactionComplete }: AEPSTransactionProps) {
  const { user } = useAuth();
  
  // State
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
  const [loginStatus, setLoginStatus] = useState<{ loggedIn: boolean; wadh?: string } | null>(null);

  // Load banks on mount
  useEffect(() => {
    if (merchantId) {
      loadBanks();
      checkLoginStatus();
    }
  }, [merchantId]);

  // Load wallet balance
  useEffect(() => {
    loadWalletBalance();
  }, []);

  const loadBanks = async () => {
    try {
      const response = await apiFetchJson(`/api/aeps/banks?merchantId=${merchantId}`);
      if (response.success && response.data) {
        setBanks(response.data);
      }
    } catch (err) {
      console.error('Failed to load banks:', err);
      // Set default banks
      setBanks([
        { iin: '607094', bankName: 'HDFC Bank' },
        { iin: '607152', bankName: 'State Bank of India' },
        { iin: '505290', bankName: 'Axis Bank' },
        { iin: '607095', bankName: 'ICICI Bank' },
      ]);
    }
  };

  const checkLoginStatus = async () => {
    try {
      const response = await apiFetchJson('/api/aeps/login-status', {
        method: 'POST',
        body: JSON.stringify({ merchantId, type: 'withdraw' }),
      });
      setLoginStatus({
        loggedIn: response.data?.loginStatus || false,
        wadh: response.data?.wadh,
      });
      setIsMockMode(response.isMockMode || false);
      if (response.data?.bankList?.length > 0) {
        setBanks(response.data.bankList);
      }
    } catch (err) {
      console.error('Failed to check login status:', err);
    }
  };

  const loadWalletBalance = async () => {
    try {
      const response = await apiFetchJson('/api/wallet/balance?wallet_type=aeps');
      if (response.balance !== undefined) {
        setWalletBalance(response.balance);
      }
    } catch (err) {
      console.error('Failed to load wallet balance:', err);
    }
  };

  const handleTypeSelect = (type: AEPSTransactionType) => {
    setSelectedType(type);
    setStep('input');
    setError(null);
  };

  const validateInputs = (): boolean => {
    // Validate Aadhaar
    const cleanAadhaar = customerAadhaar.replace(/\s/g, '');
    if (!/^\d{12}$/.test(cleanAadhaar)) {
      setError('Aadhaar must be exactly 12 digits');
      return false;
    }

    // Validate Mobile
    const cleanMobile = customerMobile.replace(/\s/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      setError('Mobile must be a valid 10-digit Indian number');
      return false;
    }

    // Validate Bank
    if (!selectedBank) {
      setError('Please select a bank');
      return false;
    }

    // Validate Amount for financial transactions
    const typeConfig = transactionTypes.find(t => t.id === selectedType);
    if (typeConfig?.requiresAmount) {
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        setError('Please enter a valid amount');
        return false;
      }
      if (numAmount < 100) {
        setError('Minimum amount is ₹100');
        return false;
      }
      if (numAmount > 10000) {
        setError('Maximum amount is ₹10,000');
        return false;
      }
      if (selectedType === 'cash_withdrawal' && numAmount > walletBalance) {
        setError('Insufficient wallet balance');
        return false;
      }
    }

    return true;
  };

  const handleProceed = () => {
    if (validateInputs()) {
      setStep('confirm');
    }
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
  };

  const formatAadhaar = (value: string): string => {
    const digits = value.replace(/\D/g, '').slice(0, 12);
    const parts = [];
    for (let i = 0; i < digits.length; i += 4) {
      parts.push(digits.slice(i, i + 4));
    }
    return parts.join(' ');
  };

  const maskAadhaar = (aadhaar: string): string => {
    const clean = aadhaar.replace(/\s/g, '');
    if (clean.length !== 12) return aadhaar;
    return `XXXX XXXX ${clean.slice(-4)}`;
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Render Transaction Type Selection
  const renderTypeSelection = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">AEPS Transaction</h2>
          <p className="text-sm text-gray-600 mt-1">Select transaction type</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">AEPS Wallet Balance</p>
          <p className="text-lg font-bold text-green-600">{formatCurrency(walletBalance)}</p>
        </div>
      </div>

      {isMockMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
          <Info className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">
            <strong>Test Mode:</strong> Using mock API (no real device needed)
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {transactionTypes.map((type) => {
          const Icon = type.icon;
          return (
            <motion.button
              key={type.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleTypeSelect(type.id)}
              className="relative overflow-hidden rounded-xl border-2 border-gray-200 bg-white p-5 text-left transition-all hover:border-primary-500 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${type.color} opacity-5`} />
              <div className="relative">
                <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${type.color} text-white mb-3`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-gray-900">{type.title}</h3>
                <p className="text-sm text-gray-500 mt-1">{type.description}</p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );

  // Render Input Form
  const renderInputForm = () => {
    const typeConfig = transactionTypes.find(t => t.id === selectedType);
    const Icon = typeConfig?.icon || Wallet;

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStep('select')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br ${typeConfig?.color} text-white`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{typeConfig?.title}</h2>
            <p className="text-sm text-gray-500">{typeConfig?.description}</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          {/* Bank Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <Building2 className="w-4 h-4 inline mr-1" />
              Select Bank
            </label>
            <select
              value={selectedBank?.iin || ''}
              onChange={(e) => {
                const bank = banks.find(b => b.iin === e.target.value);
                setSelectedBank(bank || null);
              }}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">Select a bank</option>
              {banks.map((bank) => (
                <option key={bank.iin} value={bank.iin}>
                  {bank.bankName}
                </option>
              ))}
            </select>
          </div>

          {/* Aadhaar Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <Fingerprint className="w-4 h-4 inline mr-1" />
              Customer Aadhaar Number
            </label>
            <div className="relative">
              <input
                type={showAadhaar ? 'text' : 'password'}
                value={customerAadhaar}
                onChange={(e) => setCustomerAadhaar(formatAadhaar(e.target.value))}
                placeholder="XXXX XXXX XXXX"
                maxLength={14}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowAadhaar(!showAadhaar)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showAadhaar ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Mobile Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <Phone className="w-4 h-4 inline mr-1" />
              Customer Mobile Number
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">+91</span>
              <input
                type="tel"
                value={customerMobile}
                onChange={(e) => setCustomerMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="9876543210"
                maxLength={10}
                className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono"
              />
            </div>
          </div>

          {/* Amount Input (if required) */}
          {typeConfig?.requiresAmount && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <IndianRupee className="w-4 h-4 inline mr-1" />
                Amount
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter amount"
                  min="100"
                  max="10000"
                  step="100"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Min: ₹100 | Max: ₹10,000</p>
            </div>
          )}

          {/* Quick Amount Selection */}
          {typeConfig?.requiresAmount && (
            <div>
              <p className="text-sm text-gray-500 mb-2">Quick select:</p>
              <div className="flex flex-wrap gap-2">
                {[500, 1000, 2000, 5000, 10000].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setAmount(String(amt))}
                    className={`px-4 py-2 rounded-lg border transition-colors ${
                      amount === String(amt)
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    ₹{amt.toLocaleString('en-IN')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleProceed}
          className="w-full py-3 px-4 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-medium rounded-lg hover:from-primary-700 hover:to-primary-800 transition-all shadow-lg hover:shadow-xl"
        >
          Proceed
        </button>
      </div>
    );
  };

  // Render Confirmation
  const renderConfirmation = () => {
    const typeConfig = transactionTypes.find(t => t.id === selectedType);

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStep('input')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-lg font-bold text-gray-900">Confirm Transaction</h2>
        </div>

        <div className="bg-gray-50 rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Transaction Type</span>
            <span className="font-semibold">{typeConfig?.title}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Bank</span>
            <span className="font-semibold">{selectedBank?.bankName}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Aadhaar</span>
            <span className="font-mono">{maskAadhaar(customerAadhaar)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Mobile</span>
            <span className="font-mono">+91 {customerMobile}</span>
          </div>
          {typeConfig?.requiresAmount && (
            <>
              <hr className="border-gray-200" />
              <div className="flex justify-between items-center text-lg">
                <span className="text-gray-600">Amount</span>
                <span className="font-bold text-primary-600">{formatCurrency(parseFloat(amount))}</span>
              </div>
            </>
          )}
        </div>

        {selectedType === 'cash_withdrawal' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm text-amber-800">
              <strong>Note:</strong> {formatCurrency(parseFloat(amount))} will be debited from your AEPS wallet.
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setStep('input')}
            className="flex-1 py-3 px-4 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Edit Details
          </button>
          <button
            onClick={handleConfirmTransaction}
            className="flex-1 py-3 px-4 bg-gradient-to-r from-green-600 to-green-700 text-white font-medium rounded-lg hover:from-green-700 hover:to-green-800 transition-all shadow-lg"
          >
            Confirm & Pay
          </button>
        </div>
      </div>
    );
  };

  // Render Processing
  const renderProcessing = () => (
    <div className="text-center py-12">
      <div className="relative inline-block">
        <Loader2 className="w-16 h-16 text-primary-600 animate-spin" />
        <Fingerprint className="w-8 h-8 text-primary-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mt-6">Processing Transaction</h3>
      <p className="text-gray-600 mt-2">Please wait while we process your AEPS transaction...</p>
      {isMockMode && (
        <p className="text-xs text-amber-600 mt-4">Using mock API for testing</p>
      )}
    </div>
  );

  // Render Result
  const renderResult = () => {
    const isSuccess = result?.success;
    const typeConfig = transactionTypes.find(t => t.id === selectedType);

    return (
      <div className="space-y-6">
        <div className="text-center">
          {isSuccess ? (
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 mb-4">
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
          ) : (
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-100 mb-4">
              <XCircle className="w-10 h-10 text-red-600" />
            </div>
          )}
          <h3 className={`text-xl font-bold ${isSuccess ? 'text-green-700' : 'text-red-700'}`}>
            {isSuccess ? 'Transaction Successful!' : 'Transaction Failed'}
          </h3>
          <p className="text-gray-600 mt-1">{result?.message}</p>
        </div>

        {isSuccess && result?.data && (
          <div className="bg-gray-50 rounded-xl p-5 space-y-3">
            {result.orderId && (
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Order ID</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{result.orderId}</span>
                  <button onClick={() => copyToClipboard(result.orderId!)} className="text-gray-400 hover:text-gray-600">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
            {result.utr && (
              <div className="flex justify-between items-center">
                <span className="text-gray-600">UTR/RRN</span>
                <span className="font-mono text-sm">{result.utr}</span>
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
              <div className="flex justify-between items-center text-lg">
                <span className="text-gray-600">Balance</span>
                <span className="font-bold text-green-600">₹{result.data.balance}</span>
              </div>
            )}
            {typeConfig?.requiresAmount && result.data.amount !== undefined && (
              <div className="flex justify-between items-center text-lg">
                <span className="text-gray-600">Amount</span>
                <span className="font-bold text-primary-600">{formatCurrency(result.data.amount)}</span>
              </div>
            )}
          </div>
        )}

        {/* Mini Statement */}
        {result?.data?.miniStatement && result.data.miniStatement.length > 0 && (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h4 className="font-semibold text-gray-900">Mini Statement</h4>
            </div>
            <div className="divide-y divide-gray-100">
              {result.data.miniStatement.map((entry, index) => (
                <div key={index} className="px-4 py-3 flex justify-between items-center">
                  <div>
                    <p className="font-medium text-gray-900">{entry.narration}</p>
                    <p className="text-sm text-gray-500">{entry.date}</p>
                  </div>
                  <span className={`font-semibold ${entry.txnType === 'Cr' ? 'text-green-600' : 'text-red-600'}`}>
                    {entry.txnType === 'Cr' ? '+' : '-'}₹{entry.amount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Wallet Balance */}
        {result?.walletBalance !== undefined && (
          <div className="bg-primary-50 rounded-lg p-4 text-center">
            <p className="text-sm text-primary-700">Updated AEPS Wallet Balance</p>
            <p className="text-2xl font-bold text-primary-600">{formatCurrency(result.walletBalance)}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleNewTransaction}
            className="flex-1 py-3 px-4 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-medium rounded-lg hover:from-primary-700 hover:to-primary-800 transition-all"
          >
            New Transaction
          </button>
          {isSuccess && (
            <button
              onClick={() => window.print()}
              className="px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Printer className="w-5 h-5 text-gray-600" />
            </button>
          )}
        </div>
      </div>
    );
  };

  // Main render
  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
      <div className="p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {step === 'select' && renderTypeSelection()}
            {step === 'input' && renderInputForm()}
            {step === 'confirm' && renderConfirmation()}
            {step === 'processing' && renderProcessing()}
            {step === 'result' && renderResult()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
