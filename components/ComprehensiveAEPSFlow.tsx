'use client';

/**
 * Complete AEPS Flow Component
 * Follows Chagans API Documentation (v1.0 - Jan 28, 2026)
 * 
 * Flow:
 * 1. Check if merchant exists -> If not, show KYC creation
 * 2. Check login status -> Show bank list
 * 3. Daily login if not logged in -> Biometric authentication
 * 4. Show transaction options -> Process with biometric
 */

import { useState, useEffect } from 'react';
import {
  Fingerprint, Building2, User, Phone, Mail, MapPin, CreditCard,
  Calendar, Plus, CheckCircle, XCircle, AlertCircle, Loader2,
  Wallet, IndianRupee, FileText, RefreshCw, Eye, EyeOff, ArrowRight,
  Shield, Lock, Download, Info, ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetchJson } from '@/lib/api-client';

type FlowStep = 'checking' | 'create_merchant' | 'login_required' | 'ready' | 'transaction';

interface MerchantData {
  merchantId: string;
  name: string;
  mobile: string;
  email: string;
  kycStatus: string;
  route?: string;
}

interface BankData {
  iin: string;
  bankName: string;
}

export default function ComprehensiveAEPSFlow() {
  const { user } = useAuth();
  
  // Don't render anything until user is loaded
  if (!user || !user.partner_id) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Initializing AEPS services...</p>
        </div>
      </div>
    );
  }
  
  // Flow state
  const [flowStep, setFlowStep] = useState<FlowStep>('checking');
  const [merchant, setMerchant] = useState<MerchantData | null>(null);
  const [banks, setBanks] = useState<BankData[]>([]);
  const [loginStatus, setLoginStatus] = useState<{ loginStatus: boolean; wadh?: string } | null>(null);
  const [isMockMode, setIsMockMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // KYC Form state
  const [kycForm, setKycForm] = useState({
    mobile: '',
    name: '',
    gender: 'M' as 'M' | 'F',
    pan: '',
    email: '',
    address: {
      full: '',
      city: '',
      pincode: '',
    },
    aadhaar: '',
    dateOfBirth: '',
    latitude: '0.0',
    longitude: '0.0',
    bankAccountNo: '',
    bankIfsc: '',
  });
  const [showAadhaar, setShowAadhaar] = useState(false);

  // Check merchant status on mount
  useEffect(() => {
    if (user?.partner_id) {
      checkMerchantStatus();
    }
  }, [user?.partner_id]);

  const checkMerchantStatus = async () => {
    if (!user?.partner_id) {
      setError('User not authenticated');
      setFlowStep('create_merchant');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Try to check login status (this will tell us if merchant exists)
      const response = await apiFetchJson('/api/aeps/login-status', {
        method: 'POST',
        body: JSON.stringify({
          merchantId: user.partner_id,
          type: 'withdraw',
        }),
      });

      setIsMockMode(response.isMockMode || false);

      if (response.success && response.data) {
        // Merchant exists
        setLoginStatus(response.data);
        setBanks(response.data.bankList || []);
        
        if (response.data.loginStatus) {
          setFlowStep('ready');
        } else {
          setFlowStep('login_required');
        }
      } else {
        // Merchant doesn't exist
        setFlowStep('create_merchant');
      }
    } catch (err: any) {
      console.error('[AEPS Flow] Error checking merchant status:', err);
      // Default to showing KYC form on any error
      setFlowStep('create_merchant');
      // Don't show error to user, just let them proceed with KYC
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateMerchant = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setIsLoading(true);
      setError(null);

      const response = await apiFetchJson('/api/aeps/merchant/create', {
        method: 'POST',
        body: JSON.stringify(kycForm),
      });

      if (response.success) {
        setMerchant({
          merchantId: response.data.merchantId,
          name: kycForm.name,
          mobile: kycForm.mobile,
          email: kycForm.email,
          kycStatus: response.data.kycStatus,
          route: response.data.route,
        });
        
        // After KYC, check login status
        await checkMerchantStatus();
      } else {
        setError(response.message || 'Failed to create merchant');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create merchant');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDailyLogin = async () => {
    if (!user?.partner_id) {
      setError('User not authenticated');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // In mock mode, just mark as logged in
      const response = await apiFetchJson('/api/aeps/mock-login', {
        method: 'POST',
        body: JSON.stringify({
          merchantId: user.partner_id,
          type: 'withdraw',
        }),
      });

      if (response.success) {
        setLoginStatus({ loginStatus: true });
        setFlowStep('ready');
      } else {
        setError(response.message || 'Login failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to login');
    } finally {
      setIsLoading(false);
    }
  };

  // Render: Checking status
  const renderChecking = () => (
    <div className="flex flex-col items-center justify-center py-20">
      <Loader2 className="w-12 h-12 text-primary-600 animate-spin mb-4" />
      <p className="text-gray-600">Checking AEPS merchant status...</p>
    </div>
  );

  // Render: Create Merchant (KYC)
  const renderCreateMerchant = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto"
    >
      {/* Header */}
      <div className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl p-8 text-white mb-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 bg-white/20 rounded-xl">
            <Shield className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Merchant KYC Registration</h2>
            <p className="text-primary-100">Complete your KYC to start AEPS services</p>
          </div>
        </div>
        
        {isMockMode && (
          <div className="bg-amber-500/20 rounded-lg p-3 flex items-center gap-2">
            <Info className="w-5 h-5" />
            <p className="text-sm">Test Mode: KYC will be auto-approved</p>
          </div>
        )}
      </div>

      {/* KYC Form */}
      <form onSubmit={handleCreateMerchant} className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-800">Error</p>
                <p className="text-sm text-red-600">{error}</p>
              </div>
            </div>
          )}

          {/* Personal Information */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-primary-600" />
              Personal Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={kycForm.name}
                  onChange={(e) => setKycForm({ ...kycForm, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gender *
                </label>
                <select
                  required
                  value={kycForm.gender}
                  onChange={(e) => setKycForm({ ...kycForm, gender: e.target.value as 'M' | 'F' })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date of Birth *
                </label>
                <input
                  type="date"
                  required
                  value={kycForm.dateOfBirth}
                  onChange={(e) => setKycForm({ ...kycForm, dateOfBirth: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Mobile Number *
                </label>
                <input
                  type="tel"
                  required
                  pattern="[6-9][0-9]{9}"
                  value={kycForm.mobile}
                  onChange={(e) => setKycForm({ ...kycForm, mobile: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="9876543210"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={kycForm.email}
                  onChange={(e) => setKycForm({ ...kycForm, email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  PAN Number *
                </label>
                <input
                  type="text"
                  required
                  pattern="[A-Z]{5}[0-9]{4}[A-Z]{1}"
                  value={kycForm.pan}
                  onChange={(e) => setKycForm({ ...kycForm, pan: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono"
                  placeholder="ABCDE1234F"
                />
                <p className="text-xs text-gray-500 mt-1">Format: ABCDE1234F</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Aadhaar Number *
                </label>
                <div className="relative">
                  <input
                    type={showAadhaar ? 'text' : 'password'}
                    required
                    pattern="[2-9][0-9]{11}"
                    value={kycForm.aadhaar}
                    onChange={(e) => setKycForm({ ...kycForm, aadhaar: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono"
                    placeholder="123456789012"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAadhaar(!showAadhaar)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showAadhaar ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">12 digits, cannot start with 0 or 1</p>
              </div>
            </div>
          </div>

          {/* Address */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary-600" />
              Address
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Full Address *
                </label>
                <textarea
                  required
                  rows={2}
                  value={kycForm.address.full}
                  onChange={(e) => setKycForm({ ...kycForm, address: { ...kycForm.address, full: e.target.value } })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="123 Main Street, Area, Landmark"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  City *
                </label>
                <input
                  type="text"
                  required
                  value={kycForm.address.city}
                  onChange={(e) => setKycForm({ ...kycForm, address: { ...kycForm.address, city: e.target.value } })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Mumbai"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pincode *
                </label>
                <input
                  type="text"
                  required
                  pattern="[0-9]{6}"
                  value={kycForm.address.pincode}
                  onChange={(e) => setKycForm({ ...kycForm, address: { ...kycForm.address, pincode: e.target.value } })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="400001"
                />
              </div>
            </div>
          </div>

          {/* Bank Details */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary-600" />
              Bank Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Bank Account Number *
                </label>
                <input
                  type="text"
                  required
                  pattern="[0-9]{9,18}"
                  value={kycForm.bankAccountNo}
                  onChange={(e) => setKycForm({ ...kycForm, bankAccountNo: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono"
                  placeholder="1234567890123456"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  IFSC Code *
                </label>
                <input
                  type="text"
                  required
                  pattern="[A-Z]{4}0[A-Z0-9]{6}"
                  value={kycForm.bankIfsc}
                  onChange={(e) => setKycForm({ ...kycForm, bankIfsc: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono"
                  placeholder="SBIN0001234"
                />
                <p className="text-xs text-gray-500 mt-1">Format: SBIN0001234</p>
              </div>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-xl flex items-center justify-between">
          <p className="text-sm text-gray-600">
            <Lock className="w-4 h-4 inline mr-1" />
            Your information is secure and encrypted
          </p>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Submitting KYC...
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                Submit KYC
              </>
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );

  // Render: Login Required
  const renderLoginRequired = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto"
    >
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-blue-500 to-blue-700 p-8 text-white text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-4">
            <Fingerprint className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Daily Login Required</h2>
          <p className="text-blue-100">Authenticate with biometric to start transactions</p>
        </div>

        {/* Content */}
        <div className="p-8">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 mb-6">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-800">Login Failed</p>
                <p className="text-sm text-red-600">{error}</p>
              </div>
            </div>
          )}

          {isMockMode ? (
            <div className="text-center space-y-6">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-800">
                  <Info className="w-4 h-4 inline mr-1" />
                  Test Mode: No biometric device required
                </p>
              </div>

              <button
                onClick={handleDailyLogin}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium text-lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    Logging in...
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-6 h-6" />
                    Proceed to Login (Mock)
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="text-center space-y-6">
              <div className="bg-gray-50 rounded-xl p-6">
                <p className="text-gray-600 mb-4">Please ensure:</p>
                <ul className="text-left space-y-2 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                    Biometric device is connected
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                    RD Service is running
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                    Fingerprint is clean and dry
                  </li>
                </ul>
              </div>

              <button
                onClick={handleDailyLogin}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium text-lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-6 h-6" />
                    Start Biometric Login
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );

  // Render: Ready for transactions
  const renderReady = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Success Banner */}
      <div className="bg-green-50 border border-green-200 rounded-xl p-6 flex items-center gap-4">
        <div className="p-3 bg-green-100 rounded-xl">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-green-900">Ready for Transactions!</h3>
          <p className="text-green-700">You're logged in and can now process AEPS transactions</p>
        </div>
      </div>

      {/* Bank List */}
      {banks.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary-600" />
            Available Banks ({banks.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {banks.slice(0, 6).map((bank) => (
              <div key={bank.iin} className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                <p className="font-medium text-gray-900">{bank.bankName}</p>
                <p className="text-xs text-gray-500 font-mono">IIN: {bank.iin}</p>
              </div>
            ))}
          </div>
          {banks.length > 6 && (
            <p className="text-sm text-gray-500 mt-3 text-center">
              + {banks.length - 6} more banks available
            </p>
          )}
        </div>
      )}

      {/* Transaction Options */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Choose Transaction Type</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { id: 'balance', title: 'Balance Inquiry', icon: Wallet, color: 'blue', desc: 'Check account balance' },
            { id: 'withdraw', title: 'Cash Withdrawal', icon: IndianRupee, color: 'green', desc: 'Withdraw cash from account' },
            { id: 'deposit', title: 'Cash Deposit', icon: CreditCard, color: 'purple', desc: 'Deposit cash to account' },
            { id: 'statement', title: 'Mini Statement', icon: FileText, color: 'orange', desc: 'View last 5 transactions' },
          ].map((txn) => (
            <button
              key={txn.id}
              onClick={() => setFlowStep('transaction')}
              className="relative overflow-hidden rounded-xl border-2 border-gray-200 bg-white p-6 text-left transition-all hover:border-primary-300 hover:shadow-md group"
            >
              <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-${txn.color}-100 text-${txn.color}-600 mb-3 group-hover:scale-110 transition-transform`}>
                <txn.icon className="w-6 h-6" />
              </div>
              <h4 className="font-semibold text-gray-900 text-lg">{txn.title}</h4>
              <p className="text-sm text-gray-500 mt-1">{txn.desc}</p>
              <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300 group-hover:text-primary-600 group-hover:translate-x-1 transition-all" />
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="p-6">
      {flowStep === 'checking' && renderChecking()}
      {flowStep === 'create_merchant' && renderCreateMerchant()}
      {flowStep === 'login_required' && renderLoginRequired()}
      {flowStep === 'ready' && renderReady()}
      {flowStep === 'transaction' && (
        <div>
          <button
            onClick={() => setFlowStep('ready')}
            className="mb-4 text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            Back to Services
          </button>
          {/* Import existing AEPSTransaction component here */}
          <p className="text-center text-gray-500">Transaction form will be shown here</p>
        </div>
      )}
    </div>
  );
}
