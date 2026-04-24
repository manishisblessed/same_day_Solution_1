'use client';

import { useState, useEffect } from 'react';
import {
  User, Phone, Mail, CreditCard, Building2, MapPin,
  Fingerprint, CheckCircle, XCircle, AlertCircle, Loader2,
  ArrowRight, Eye, EyeOff, Calendar, Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetchJson } from '@/lib/api-client';

interface MerchantSetupProps {
  onComplete?: (merchantId: string) => void;
  existingMerchant?: {
    merchantId: string;
    name: string;
    mobile: string;
    email: string;
    kycStatus: string;
  };
}

type Step = 'info' | 'address' | 'bank' | 'verify' | 'complete';

interface FormData {
  name: string;
  mobile: string;
  email: string;
  gender: 'M' | 'F';
  dateOfBirth: string;
  pan: string;
  aadhaar: string;
  address: string;
  city: string;
  pincode: string;
  latitude: string;
  longitude: string;
  bankAccountNo: string;
  bankIfsc: string;
}

export default function AEPSMerchantSetup({ onComplete, existingMerchant }: MerchantSetupProps) {
  const [step, setStep] = useState<Step>(existingMerchant ? 'complete' : 'info');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAadhaar, setShowAadhaar] = useState(false);
  const [merchantId, setMerchantId] = useState(existingMerchant?.merchantId || '');
  const [kycStatus, setKycStatus] = useState(existingMerchant?.kycStatus || '');

  const [formData, setFormData] = useState<FormData>({
    name: '',
    mobile: '',
    email: '',
    gender: 'M',
    dateOfBirth: '',
    pan: '',
    aadhaar: '',
    address: '',
    city: '',
    pincode: '',
    latitude: '',
    longitude: '',
    bankAccountNo: '',
    bankIfsc: '',
  });

  useEffect(() => {
    // Try to get user's location
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setFormData(prev => ({
            ...prev,
            latitude: position.coords.latitude.toFixed(4),
            longitude: position.coords.longitude.toFixed(4),
          }));
        },
        () => {
          // Default to a location in India
          setFormData(prev => ({
            ...prev,
            latitude: '19.0760',
            longitude: '72.8777',
          }));
        }
      );
    }
  }, []);

  const updateField = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const formatPAN = (value: string): string => {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  };

  const formatAadhaar = (value: string): string => {
    const digits = value.replace(/\D/g, '').slice(0, 12);
    const parts = [];
    for (let i = 0; i < digits.length; i += 4) {
      parts.push(digits.slice(i, i + 4));
    }
    return parts.join(' ');
  };

  const formatIFSC = (value: string): string => {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
  };

  const validateStep = (): boolean => {
    switch (step) {
      case 'info':
        if (!formData.name.trim()) {
          setError('Name is required');
          return false;
        }
        if (!/^[6-9]\d{9}$/.test(formData.mobile)) {
          setError('Enter a valid 10-digit mobile number');
          return false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
          setError('Enter a valid email address');
          return false;
        }
        if (!formData.dateOfBirth) {
          setError('Date of birth is required');
          return false;
        }
        if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(formData.pan)) {
          setError('Enter a valid PAN (e.g., ABCDE1234F)');
          return false;
        }
        const cleanAadhaar = formData.aadhaar.replace(/\s/g, '');
        if (!/^\d{12}$/.test(cleanAadhaar)) {
          setError('Enter a valid 12-digit Aadhaar number');
          return false;
        }
        return true;

      case 'address':
        if (!formData.address.trim()) {
          setError('Address is required');
          return false;
        }
        if (!formData.city.trim()) {
          setError('City is required');
          return false;
        }
        if (!/^\d{6}$/.test(formData.pincode)) {
          setError('Enter a valid 6-digit pincode');
          return false;
        }
        return true;

      case 'bank':
        if (!/^\d{9,18}$/.test(formData.bankAccountNo)) {
          setError('Enter a valid bank account number (9-18 digits)');
          return false;
        }
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(formData.bankIfsc)) {
          setError('Enter a valid IFSC code (e.g., HDFC0001234)');
          return false;
        }
        return true;

      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!validateStep()) return;

    const nextSteps: Record<Step, Step> = {
      info: 'address',
      address: 'bank',
      bank: 'verify',
      verify: 'complete',
      complete: 'complete',
    };

    setStep(nextSteps[step]);
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetchJson('/api/aeps/merchant/create', {
        method: 'POST',
        body: JSON.stringify({
          mobile: formData.mobile,
          name: formData.name,
          gender: formData.gender,
          pan: formData.pan,
          email: formData.email,
          address: {
            full: formData.address,
            city: formData.city,
            pincode: formData.pincode,
          },
          aadhaar: formData.aadhaar.replace(/\s/g, ''),
          dateOfBirth: formData.dateOfBirth,
          latitude: formData.latitude,
          longitude: formData.longitude,
          bankAccountNo: formData.bankAccountNo,
          bankIfsc: formData.bankIfsc,
        }),
      });

      if (response.success) {
        setMerchantId(response.data?.merchantId || '');
        setKycStatus(response.data?.kycStatus || 'pending');
        setStep('complete');
        onComplete?.(response.data?.merchantId || '');
      } else {
        setError(response.message || response.error || 'Failed to create merchant');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create merchant');
    } finally {
      setIsLoading(false);
    }
  };

  const renderPersonalInfo = () => (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          <User className="w-4 h-4 inline mr-1" />
          Full Name (as per PAN)
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => updateField('name', e.target.value)}
          placeholder="Enter full name"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            <Phone className="w-4 h-4 inline mr-1" />
            Mobile Number
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">+91</span>
            <input
              type="tel"
              value={formData.mobile}
              onChange={(e) => updateField('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="9876543210"
              className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Gender</label>
          <select
            value={formData.gender}
            onChange={(e) => updateField('gender', e.target.value as 'M' | 'F')}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          <Mail className="w-4 h-4 inline mr-1" />
          Email Address
        </label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => updateField('email', e.target.value)}
          placeholder="email@example.com"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          <Calendar className="w-4 h-4 inline mr-1" />
          Date of Birth
        </label>
        <input
          type="date"
          value={formData.dateOfBirth}
          onChange={(e) => updateField('dateOfBirth', e.target.value)}
          max={new Date(Date.now() - 18 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            <CreditCard className="w-4 h-4 inline mr-1" />
            PAN Number
          </label>
          <input
            type="text"
            value={formData.pan}
            onChange={(e) => updateField('pan', formatPAN(e.target.value))}
            placeholder="ABCDE1234F"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono uppercase"
          />
          <p className="text-xs text-gray-500 mt-1">Must be an individual PAN</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            <Fingerprint className="w-4 h-4 inline mr-1" />
            Aadhaar Number
          </label>
          <div className="relative">
            <input
              type={showAadhaar ? 'text' : 'password'}
              value={formData.aadhaar}
              onChange={(e) => updateField('aadhaar', formatAadhaar(e.target.value))}
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
      </div>
    </div>
  );

  const renderAddress = () => (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          <MapPin className="w-4 h-4 inline mr-1" />
          Full Address
        </label>
        <textarea
          value={formData.address}
          onChange={(e) => updateField('address', e.target.value)}
          placeholder="Enter your full address"
          rows={3}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">City</label>
          <input
            type="text"
            value={formData.city}
            onChange={(e) => updateField('city', e.target.value)}
            placeholder="Mumbai"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Pincode</label>
          <input
            type="text"
            value={formData.pincode}
            onChange={(e) => updateField('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="400001"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono"
          />
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-sm text-gray-600">
          <MapPin className="w-4 h-4 inline mr-1" />
          Location: {formData.latitude}, {formData.longitude}
        </p>
        <p className="text-xs text-gray-500 mt-1">Auto-detected from your device</p>
      </div>
    </div>
  );

  const renderBankDetails = () => (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-blue-800 font-medium">Bank Account for Settlement</p>
          <p className="text-sm text-blue-700 mt-1">
            This bank account will receive AEPS settlements. Ensure the account belongs to the merchant.
          </p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          <Building2 className="w-4 h-4 inline mr-1" />
          Bank Account Number
        </label>
        <input
          type="text"
          value={formData.bankAccountNo}
          onChange={(e) => updateField('bankAccountNo', e.target.value.replace(/\D/g, '').slice(0, 18))}
          placeholder="Enter account number"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">IFSC Code</label>
        <input
          type="text"
          value={formData.bankIfsc}
          onChange={(e) => updateField('bankIfsc', formatIFSC(e.target.value))}
          placeholder="HDFC0001234"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono uppercase"
        />
        <p className="text-xs text-gray-500 mt-1">11 character code (e.g., HDFC0001234)</p>
      </div>
    </div>
  );

  const renderVerify = () => (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-amber-800 font-medium">Important: KYC Verification</p>
          <p className="text-sm text-amber-700 mt-1">
            Name and date of birth must match your PAN records exactly. Incorrect details will cause KYC rejection.
          </p>
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl p-5 space-y-4">
        <h4 className="font-semibold text-gray-900">Review Your Details</h4>
        
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Name</p>
            <p className="font-medium text-gray-900">{formData.name}</p>
          </div>
          <div>
            <p className="text-gray-500">Mobile</p>
            <p className="font-medium text-gray-900">+91 {formData.mobile}</p>
          </div>
          <div>
            <p className="text-gray-500">Email</p>
            <p className="font-medium text-gray-900">{formData.email}</p>
          </div>
          <div>
            <p className="text-gray-500">Date of Birth</p>
            <p className="font-medium text-gray-900">{formData.dateOfBirth}</p>
          </div>
          <div>
            <p className="text-gray-500">PAN</p>
            <p className="font-medium text-gray-900 font-mono">{formData.pan}</p>
          </div>
          <div>
            <p className="text-gray-500">Aadhaar</p>
            <p className="font-medium text-gray-900">XXXX XXXX {formData.aadhaar.slice(-4)}</p>
          </div>
        </div>

        <hr className="border-gray-200" />

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Address</p>
            <p className="font-medium text-gray-900">{formData.address}</p>
          </div>
          <div>
            <p className="text-gray-500">City, Pincode</p>
            <p className="font-medium text-gray-900">{formData.city}, {formData.pincode}</p>
          </div>
        </div>

        <hr className="border-gray-200" />

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Bank Account</p>
            <p className="font-medium text-gray-900 font-mono">
              {'*'.repeat(formData.bankAccountNo.length - 4)}{formData.bankAccountNo.slice(-4)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">IFSC Code</p>
            <p className="font-medium text-gray-900 font-mono">{formData.bankIfsc}</p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderComplete = () => (
    <div className="text-center py-6">
      {kycStatus === 'validated' ? (
        <>
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 mb-4">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <h3 className="text-xl font-bold text-green-700">KYC Approved!</h3>
          <p className="text-gray-600 mt-2">Your merchant account is active and ready to use.</p>
        </>
      ) : kycStatus === 'rejected' ? (
        <>
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-100 mb-4">
            <XCircle className="w-10 h-10 text-red-600" />
          </div>
          <h3 className="text-xl font-bold text-red-700">KYC Rejected</h3>
          <p className="text-gray-600 mt-2">Please contact support for assistance.</p>
        </>
      ) : (
        <>
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-100 mb-4">
            <AlertCircle className="w-10 h-10 text-amber-600" />
          </div>
          <h3 className="text-xl font-bold text-amber-700">KYC Pending</h3>
          <p className="text-gray-600 mt-2">Your KYC verification is in progress.</p>
        </>
      )}

      {merchantId && (
        <div className="mt-6 bg-gray-50 rounded-lg p-4">
          <p className="text-sm text-gray-500">Merchant ID</p>
          <p className="font-mono text-gray-900">{merchantId}</p>
        </div>
      )}
    </div>
  );

  const steps = [
    { id: 'info', title: 'Personal Info', icon: User },
    { id: 'address', title: 'Address', icon: MapPin },
    { id: 'bank', title: 'Bank Details', icon: Building2 },
    { id: 'verify', title: 'Verify', icon: CheckCircle },
  ];

  const currentStepIndex = steps.findIndex(s => s.id === step);

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
      {/* Progress Header */}
      {step !== 'complete' && (
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">AEPS Merchant Setup</h2>
            <span className="text-sm text-gray-500">Step {currentStepIndex + 1} of {steps.length}</span>
          </div>
          
          <div className="flex items-center gap-2">
            {steps.map((s, index) => {
              const Icon = s.icon;
              const isActive = s.id === step;
              const isCompleted = index < currentStepIndex;

              return (
                <div key={s.id} className="flex items-center flex-1">
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${
                      isActive
                        ? 'bg-primary-600 text-white'
                        : isCompleted
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-400'
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={`h-1 flex-1 mx-2 rounded ${
                        isCompleted ? 'bg-green-500' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-6">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {step === 'info' && renderPersonalInfo()}
            {step === 'address' && renderAddress()}
            {step === 'bank' && renderBankDetails()}
            {step === 'verify' && renderVerify()}
            {step === 'complete' && renderComplete()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer Actions */}
      {step !== 'complete' && (
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-between">
          {currentStepIndex > 0 && (
            <button
              onClick={() => setStep(steps[currentStepIndex - 1].id as Step)}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium"
            >
              Back
            </button>
          )}
          
          <div className="ml-auto">
            {step === 'verify' ? (
              <button
                onClick={handleSubmit}
                disabled={isLoading}
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white font-medium rounded-lg hover:from-green-700 hover:to-green-800 transition-all disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Submit for KYC
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleNext}
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-medium rounded-lg hover:from-primary-700 hover:to-primary-800 transition-all"
              >
                Continue
                <ArrowRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
