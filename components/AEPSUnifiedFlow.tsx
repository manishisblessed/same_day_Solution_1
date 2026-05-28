'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, UserCheck, Fingerprint, Wallet, ArrowRight, ArrowLeft,
  CheckCircle2, XCircle, AlertCircle, Loader2, RefreshCw, Building2,
  IndianRupee, FileText, Clock, Shield, User, Phone, MapPin, Calendar,
  ShieldCheck, Eye, EyeOff
} from 'lucide-react';
import { DatePicker } from './DatePicker';
import { apiFetchJson, apiFetch } from '@/lib/api-client';

// ============================================================================
// TYPES
// ============================================================================

interface AEPSUser {
  partner_id: string;
  email: string;
  role: string;
  name?: string;
}

interface MerchantInfo {
  merchant_id: string;
  name: string;
  mobile: string;
  kyc_status: 'pending' | 'validated' | 'rejected' | 'expired';
  last_login_at?: string;
  login_wadh?: string;
}

interface Bank {
  iin: string;
  bankName: string;
}

interface BiometricData {
  bioType: 'FINGER' | 'FACE';
  dc: string;
  ci: string;
  hmac: string;
  dpId: string;
  mc: string;
  pidDataType: string;
  mi: string;
  rdsId: string;
  sessionKey: string;
  fCount: string;
  errCode: string;
  pCount: string;
  fType: string;
  iCount: string;
  pType: string;
  srno: string;
  pidData: string;
  qScore: string;
  nmPoints: string;
  rdsVer: string;
}

interface ReceiptData {
  txnId: string;
  orderId?: string | null;
  utr?: string | null;
  rrn?: string | null;
  stan?: string | null;
  timestamp: string;
  type: string;
  customer: {
    aadhaarMasked?: string | null;
    bankName?: string | null;
    accountNumberMasked?: string | null;
  };
  transaction: {
    amount?: number | null;
    commission?: number | null;
  };
  bank?: {
    availableBalance?: string | null;
  };
  miniStatement?: Array<{
    date: string;
    narration: string;
    txnType: 'Cr' | 'Dr';
    amount: number | string;
  }> | null;
  retailer: {
    id: string;
    name?: string;
    location?: string | null;
  };
  status: 'SUCCESS' | 'FAILED';
  error?: {
    errorCode: string;
    errorMessage: string;
    action: string;
    retryable: boolean;
  };
}

interface TransactionResult {
  success: boolean;
  receipt: ReceiptData;
}

type FlowStep = 'check_merchant' | 'kyc_form' | 'biometric_login' | 'transaction';
type TransactionType = 'balance_inquiry' | 'cash_withdrawal' | 'cash_deposit' | 'mini_statement';

// ============================================================================
// DEVICE FINGERPRINT — Detects device/system changes to trigger re-2FA
// ============================================================================

function generateDeviceFingerprint(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const scr = typeof screen !== 'undefined' ? screen : null;
  const parts = [
    nav?.userAgent || '',
    nav?.language || '',
    nav?.hardwareConcurrency || 0,
    scr ? `${scr.width}x${scr.height}x${scr.colorDepth}` : '',
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    nav?.platform || '',
  ];
  const raw = parts.join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `DF_${Math.abs(hash).toString(36)}`;
}

// ============================================================================
// SHARED BIOMETRIC CAPTURE UTILITY
// ============================================================================

async function captureBiometric(wadh: string = ''): Promise<BiometricData | null> {
  const rdServicePorts = [11100, 11101, 11102];

  for (const port of rdServicePorts) {
    try {
      const captureXml = `<?xml version="1.0"?>
        <PidOptions ver="1.0">
          <Opts fCount="1" fType="2" iCount="0" pCount="0" pgCount="2" format="0" pidVer="2.0" timeout="20000" posh="UNKNOWN" env="P" wadh="${wadh}" />
          <CustOpts><Param name="mantrakey" value="" /></CustOpts>
        </PidOptions>`;

      const response = await fetch(`https://127.0.0.1:${port}/rd/capture`, {
        method: 'CAPTURE',
        body: captureXml,
        headers: { 'Content-Type': 'text/xml' }
      });

      if (response.ok) {
        const xml = await response.text();
        console.log('[Biometric] Raw RD capture XML:', xml);
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'text/xml');

        const respEl = doc.querySelector('Resp');
        if (respEl?.getAttribute('errCode') !== '0') {
          throw new Error(respEl?.getAttribute('errInfo') || 'Capture failed');
        }

        const deviceInfo = doc.querySelector('DeviceInfo');
        const skey = doc.querySelector('Skey');
        const hmac = doc.querySelector('Hmac');
        const data = doc.querySelector('Data');

        let srno = deviceInfo?.getAttribute('srno') || '';
        if (!srno) {
          const params = doc.querySelectorAll('Param');
          params.forEach(param => {
            if (param.getAttribute('name') === 'srno') {
              srno = param.getAttribute('value') || '';
            }
          });
        }

        const ci = skey?.getAttribute('ci') || '';
        const mc = deviceInfo?.getAttribute('mc') || '';
        const dc = deviceInfo?.getAttribute('dc') || '';

        return {
          bioType: 'FINGER',
          dc, ci,
          hmac: hmac?.textContent || '',
          dpId: deviceInfo?.getAttribute('dpId') || '',
          mc,
          pidDataType: data?.getAttribute('type') || '',
          mi: deviceInfo?.getAttribute('mi') || '',
          rdsId: deviceInfo?.getAttribute('rdsId') || '',
          sessionKey: skey?.textContent || '',
          fCount: respEl?.getAttribute('fCount') || '1',
          errCode: respEl?.getAttribute('errCode') || '0',
          pCount: respEl?.getAttribute('pCount') || '0',
          fType: respEl?.getAttribute('fType') || '0',
          iCount: respEl?.getAttribute('iCount') || '0',
          pType: respEl?.getAttribute('pType') || '0',
          srno,
          pidData: data?.textContent || '',
          qScore: respEl?.getAttribute('qScore') || '0',
          nmPoints: respEl?.getAttribute('nmPoints') || '0',
          rdsVer: deviceInfo?.getAttribute('rdsVer') || ''
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ============================================================================
// STEP INDICATOR COMPONENT
// ============================================================================

const StepIndicator = ({ 
  currentStep, 
  steps 
}: { 
  currentStep: number; 
  steps: { id: string; label: string; icon: React.ReactNode }[] 
}) => (
  <div className="flex items-center justify-center gap-2 mb-8">
    {steps.map((step, index) => (
      <div key={step.id} className="flex items-center">
        <div className={`flex items-center justify-center w-10 h-10 rounded-full transition-all ${
          index < currentStep 
            ? 'bg-green-500 text-white' 
            : index === currentStep 
              ? 'bg-orange-500 text-white scale-110 shadow-lg' 
              : 'bg-gray-200 text-gray-400'
        }`}>
          {index < currentStep ? <CheckCircle2 className="w-5 h-5" /> : step.icon}
        </div>
        {index < steps.length - 1 && (
          <div className={`w-12 h-1 mx-2 rounded ${
            index < currentStep ? 'bg-green-500' : 'bg-gray-200'
          }`} />
        )}
      </div>
    ))}
  </div>
);

// ============================================================================
// KYC FORM COMPONENT
// ============================================================================

interface KYCFormData {
  fullName: string;
  mobile: string;
  email: string;
  pan: string;
  aadhaar: string;
  dateOfBirth: string;
  gender: 'M' | 'F' | '';
  address: string;
  city: string;
  pincode: string;
  bankAccount: string;
  bankIfsc: string;
  bankName: string;
}

const KYCInputField = ({ 
  field, 
  label, 
  placeholder, 
  type = 'text',
  maxLength,
  value,
  error,
  onChange,
}: { 
  field: string; 
  label: string; 
  placeholder: string;
  type?: string;
  maxLength?: number;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) => (
  <div>
    <label className="block text-sm font-semibold text-gray-700 mb-2">{label} *</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete="off"
      className={`w-full px-4 py-3 border-2 rounded-xl transition-all focus:ring-4 focus:ring-orange-100 ${
        error ? 'border-red-500' : 'border-gray-200 focus:border-orange-500'
      }`}
    />
    {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
  </div>
);

const KYCForm = ({ 
  user, 
  onSubmit, 
  onCancel, 
  isLoading 
}: { 
  user: AEPSUser;
  onSubmit: (data: KYCFormData) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}) => {
  const [formData, setFormData] = useState<KYCFormData>({
    fullName: user.name || '',
    mobile: '',
    email: user.email || '',
    pan: '',
    aadhaar: '',
    dateOfBirth: '',
    gender: '',
    address: '',
    city: '',
    pincode: '',
    bankAccount: '',
    bankIfsc: '',
    bankName: ''
  });
  const [errors, setErrors] = useState<Partial<Record<keyof KYCFormData, string>>>({});
  const [step, setStep] = useState(1);

  // PAN verification state
  const [panVerified, setPanVerified] = useState(false);
  const [panRegisteredName, setPanRegisteredName] = useState('');
  const [panType, setPanType] = useState('');
  const [verifyingPan, setVerifyingPan] = useState(false);
  const [panError, setPanError] = useState('');

  // Aadhaar DigiLocker verification state
  const [aadhaarVerified, setAadhaarVerified] = useState(false);
  const [digilockerLoading, setDigilockerLoading] = useState(false);
  const [digilockerError, setDigilockerError] = useState('');
  const [digilockerUrl, setDigilockerUrl] = useState('');
  const [showAadhaar, setShowAadhaar] = useState(false);

  const handleVerifyPan = async () => {
    const panVal = formData.pan.toUpperCase();
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(panVal)) {
      setPanError('Enter valid PAN (e.g., ABCDE1234F)');
      return;
    }
    setVerifyingPan(true);
    setPanError('');
    try {
      const res = await apiFetchJson<any>('/api/kyc/verify-pan360', {
        method: 'POST',
        body: JSON.stringify({ pan: panVal }),
      });
      if (res.success) {
        setPanVerified(true);
        setPanRegisteredName(res.data.registered_name || '');
        setPanType(res.data.type || '');
        if (res.data.registered_name && !formData.fullName) {
          setFormData(prev => ({ ...prev, fullName: res.data.registered_name }));
        }
        if (res.data.date_of_birth && !formData.dateOfBirth) {
          setFormData(prev => ({ ...prev, dateOfBirth: res.data.date_of_birth }));
        }
        if (res.data.gender && !formData.gender) {
          const g = res.data.gender?.toUpperCase();
          if (g === 'M' || g === 'MALE') setFormData(prev => ({ ...prev, gender: 'M' }));
          else if (g === 'F' || g === 'FEMALE') setFormData(prev => ({ ...prev, gender: 'F' }));
        }
      } else {
        setPanError(res.error || 'PAN verification failed');
        setPanVerified(false);
      }
    } catch (err: any) {
      setPanError(err.message || 'PAN verification failed');
      setPanVerified(false);
    } finally {
      setVerifyingPan(false);
    }
  };

  const handleDigilockerAadhaar = async () => {
    setDigilockerLoading(true);
    setDigilockerError('');
    setDigilockerUrl('');
    try {
      const data = await apiFetchJson<any>('/api/kyc/verify-digilocker', {
        method: 'POST',
        body: JSON.stringify({ type: 'aadhaar' }),
      });
      if (data.success && data.data.url) {
        setDigilockerUrl(data.data.url);
        window.open(data.data.url, '_blank');
      } else {
        setDigilockerError(data.error || 'Failed to generate Digilocker URL');
      }
    } catch (err: any) {
      setDigilockerError(err.message || 'Digilocker verification failed');
    } finally {
      setDigilockerLoading(false);
    }
  };

  // Listen for DigiLocker callback results
  useEffect(() => {
    const handleDigilockerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'DIGILOCKER_RESULT') {
        if (event.data.success && event.data.data) {
          const d = event.data.data;
          setAadhaarVerified(true);
          setDigilockerUrl('');
          if (d.name) setFormData(prev => ({ ...prev, fullName: d.name }));
          if (d.dob) setFormData(prev => ({ ...prev, dateOfBirth: d.dob }));
          if (d.gender) setFormData(prev => ({ ...prev, gender: d.gender === 'F' ? 'F' : 'M' }));
          if (d.uid) setFormData(prev => ({ ...prev, aadhaar: d.uid.replace(/\s/g, '') }));
          if (d.address) setFormData(prev => ({ ...prev, address: d.address }));
        } else if (event.data.error) {
          setDigilockerError(event.data.error);
        }
      }
    };
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'digilocker_result' && event.newValue) {
        try {
          const result = JSON.parse(event.newValue);
          if (result.success && result.data) {
            const d = result.data;
            setAadhaarVerified(true);
            setDigilockerUrl('');
            if (d.name) setFormData(prev => ({ ...prev, fullName: d.name }));
            if (d.dob) setFormData(prev => ({ ...prev, dateOfBirth: d.dob }));
            if (d.gender) setFormData(prev => ({ ...prev, gender: d.gender === 'F' ? 'F' : 'M' }));
            if (d.uid) setFormData(prev => ({ ...prev, aadhaar: d.uid.replace(/\s/g, '') }));
            if (d.address) setFormData(prev => ({ ...prev, address: d.address }));
          } else if (result.error) {
            setDigilockerError(result.error);
          }
          localStorage.removeItem('digilocker_result');
        } catch {}
      }
    };
    window.addEventListener('message', handleDigilockerMessage);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('message', handleDigilockerMessage);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const validateStep1 = () => {
    const newErrors: typeof errors = {};
    if (!formData.fullName.trim()) newErrors.fullName = 'Full name is required';
    if (!/^[6-9]\d{9}$/.test(formData.mobile.replace(/\D/g, ''))) newErrors.mobile = 'Valid 10-digit mobile required';
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = 'Invalid email';
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(formData.pan.toUpperCase())) newErrors.pan = 'Valid PAN required (e.g., ABCDE1234F)';
    if (!/^\d{12}$/.test(formData.aadhaar.replace(/\s/g, ''))) newErrors.aadhaar = 'Valid 12-digit Aadhaar required';
    if (!formData.dateOfBirth) newErrors.dateOfBirth = 'Date of birth is required';
    if (!formData.gender) newErrors.gender = 'Gender is required';
    if (!panVerified) newErrors.pan = 'PAN verification is mandatory';
    if (!aadhaarVerified) newErrors.aadhaar = 'Aadhaar verification via Digilocker is mandatory';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = () => {
    const newErrors: typeof errors = {};
    if (!formData.address.trim()) newErrors.address = 'Address is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!/^\d{6}$/.test(formData.pincode)) newErrors.pincode = 'Valid 6-digit pincode required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep3 = () => {
    const newErrors: typeof errors = {};
    if (!/^\d{9,18}$/.test(formData.bankAccount)) newErrors.bankAccount = 'Valid account number required';
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(formData.bankIfsc.toUpperCase())) newErrors.bankIfsc = 'Valid IFSC required';
    if (!formData.bankName.trim()) newErrors.bankName = 'Bank name is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) setStep(2);
    else if (step === 2 && validateStep2()) setStep(3);
    else if (step === 3 && validateStep3()) {
      onSubmit(formData);
    }
  };

  const handleChange = (field: keyof KYCFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (field === 'pan') {
      setPanVerified(false);
      setPanError('');
      setPanRegisteredName('');
    }
  };

  const formatAadhaarDisplay = (val: string): string => {
    const digits = val.replace(/\D/g, '').slice(0, 12);
    const parts = [];
    for (let i = 0; i < digits.length; i += 4) {
      parts.push(digits.slice(i, i + 4));
    }
    return parts.join(' ');
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
          <UserCheck className="w-6 h-6 text-orange-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">AEPS Merchant KYC</h2>
          <p className="text-gray-500">Step {step} of 3 - {step === 1 ? 'Personal Details' : step === 2 ? 'Address' : 'Bank Details'}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {[1, 2, 3].map(s => (
          <div key={s} className={`flex-1 h-2 rounded-full ${s <= step ? 'bg-orange-500' : 'bg-gray-200'}`} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="space-y-4"
        >
          {step === 1 && (
            <>
              {/* PAN Number with Verify Button */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <CreditCard className="w-4 h-4 inline mr-1" />
                  PAN Number *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formData.pan}
                    onChange={(e) => handleChange('pan', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                    placeholder="ABCDE1234F"
                    maxLength={10}
                    readOnly={panVerified}
                    autoComplete="off"
                    className={`flex-1 px-4 py-3 border-2 rounded-xl transition-all focus:ring-4 focus:ring-orange-100 font-mono uppercase ${
                      panVerified ? 'border-green-500 bg-green-50 cursor-not-allowed' : errors.pan ? 'border-red-500' : 'border-gray-200 focus:border-orange-500'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleVerifyPan}
                    disabled={verifyingPan || panVerified || formData.pan.length !== 10}
                    className="px-5 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl hover:from-orange-600 hover:to-orange-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap transition-all"
                  >
                    {verifyingPan ? <Loader2 className="w-4 h-4 animate-spin" /> : panVerified ? <CheckCircle2 className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                    {panVerified ? 'Verified' : 'Verify'}
                  </button>
                </div>
                {panVerified && (
                  <div className="mt-2 p-2.5 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="text-sm text-green-700 font-medium">{panRegisteredName}</span>
                    {panType && <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">({panType})</span>}
                  </div>
                )}
                {panError && (
                  <div className="mt-2 p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="text-sm text-red-700">{panError}</span>
                  </div>
                )}
                {errors.pan && !panError && <p className="text-red-500 text-sm mt-1">{errors.pan}</p>}
              </div>

              {/* Aadhaar Number with DigiLocker Verification */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <Fingerprint className="w-4 h-4 inline mr-1" />
                  Aadhaar Number *
                </label>
                <div className="relative">
                  <input
                    type={showAadhaar ? 'text' : 'password'}
                    value={showAadhaar ? formatAadhaarDisplay(formData.aadhaar) : formData.aadhaar}
                    onChange={(e) => handleChange('aadhaar', e.target.value.replace(/\D/g, '').slice(0, 12))}
                    placeholder="XXXX XXXX XXXX"
                    maxLength={showAadhaar ? 14 : 12}
                    readOnly={aadhaarVerified}
                    autoComplete="off"
                    className={`w-full px-4 py-3 border-2 rounded-xl transition-all focus:ring-4 focus:ring-orange-100 pr-12 font-mono ${
                      aadhaarVerified ? 'border-green-500 bg-green-50 cursor-not-allowed' : errors.aadhaar ? 'border-red-500' : 'border-gray-200 focus:border-orange-500'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAadhaar(!showAadhaar)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showAadhaar ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>

                {!aadhaarVerified && (
                  <button
                    type="button"
                    onClick={handleDigilockerAadhaar}
                    disabled={digilockerLoading}
                    className="mt-2 w-full px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-semibold transition-all"
                  >
                    {digilockerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    Verify Aadhaar via DigiLocker
                  </button>
                )}

                {digilockerUrl && !aadhaarVerified && (
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <p className="text-sm text-blue-800">
                      A DigiLocker window has been opened. Complete verification there.{' '}
                      <a href={digilockerUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                        Click here
                      </a>{' '}
                      if the window didn&apos;t open.
                    </p>
                  </div>
                )}

                {aadhaarVerified && (
                  <div className="mt-2 p-2.5 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="text-sm text-green-700 font-medium">Aadhaar Verified via DigiLocker</span>
                  </div>
                )}

                {digilockerError && (
                  <div className="mt-2 p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="text-sm text-red-700">{digilockerError}</span>
                  </div>
                )}
                {errors.aadhaar && !digilockerError && <p className="text-red-500 text-sm mt-1">{errors.aadhaar}</p>}
              </div>

              <KYCInputField field="fullName" label="Full Name (as per Aadhaar)" placeholder="Enter your full name" value={formData.fullName} error={errors.fullName} onChange={v => handleChange('fullName', v)} />
              <div className="grid grid-cols-2 gap-4">
                <KYCInputField field="mobile" label="Mobile Number" placeholder="9876543210" maxLength={10} value={formData.mobile} error={errors.mobile} onChange={v => handleChange('mobile', v)} />
                <KYCInputField field="email" label="Email" placeholder="email@example.com" type="email" value={formData.email} error={errors.email} onChange={v => handleChange('email', v)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <DatePicker
                  value={formData.dateOfBirth}
                  onChange={val => handleChange('dateOfBirth', val)}
                  maxDate={new Date(Date.now() - 18 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                  label="Date of Birth"
                />
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Gender *</label>
                  <div className="flex gap-4">
                    {(['M', 'F'] as const).map(g => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => handleChange('gender', g)}
                        className={`flex-1 py-3 rounded-xl font-semibold transition-all ${
                          formData.gender === g 
                            ? 'bg-orange-500 text-white' 
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {g === 'M' ? 'Male' : 'Female'}
                      </button>
                    ))}
                  </div>
                  {errors.gender && <p className="text-red-500 text-sm mt-1">{errors.gender}</p>}
                </div>
              </div>

              {/* Verification status banner */}
              {(!panVerified || !aadhaarVerified) && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-sm font-semibold text-amber-800 mb-1">Required verifications:</p>
                  <ul className="text-xs text-amber-700 space-y-1">
                    {!panVerified && <li className="flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5 text-amber-500" /> PAN verification is mandatory</li>}
                    {!aadhaarVerified && <li className="flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5 text-amber-500" /> Aadhaar verification via DigiLocker is mandatory</li>}
                  </ul>
                </div>
              )}

              {panVerified && aadhaarVerified && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                  <span className="text-sm text-green-700 font-semibold">All verifications completed</span>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {aadhaarVerified && formData.address ? (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    <MapPin className="w-4 h-4 inline mr-1" />
                    Full Address *
                  </label>
                  <div className="p-3 bg-green-50 border border-green-200 rounded-xl">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded-full mb-1">
                          <ShieldCheck className="w-3 h-3" /> Address from Aadhaar verification
                        </span>
                        <p className="text-sm text-green-800 mt-1">{formData.address}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <KYCInputField field="address" label="Full Address" placeholder="Enter your complete address" value={formData.address} error={errors.address} onChange={v => handleChange('address', v)} />
              )}
              <div className="grid grid-cols-2 gap-4">
                <KYCInputField field="city" label="City" placeholder="Enter city" value={formData.city} error={errors.city} onChange={v => handleChange('city', v)} />
                <KYCInputField field="pincode" label="Pincode" placeholder="400001" maxLength={6} value={formData.pincode} error={errors.pincode} onChange={v => handleChange('pincode', v)} />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <KYCInputField field="bankAccount" label="Bank Account Number" placeholder="Enter account number" maxLength={18} value={formData.bankAccount} error={errors.bankAccount} onChange={v => handleChange('bankAccount', v)} />
              <div className="grid grid-cols-2 gap-4">
                <KYCInputField field="bankIfsc" label="IFSC Code" placeholder="HDFC0001234" maxLength={11} value={formData.bankIfsc} error={errors.bankIfsc} onChange={v => handleChange('bankIfsc', v.toUpperCase())} />
                <KYCInputField field="bankName" label="Bank Name" placeholder="HDFC Bank" value={formData.bankName} error={errors.bankName} onChange={v => handleChange('bankName', v)} />
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex gap-4 mt-8">
        <button
          onClick={step === 1 ? onCancel : () => setStep(step - 1)}
          className="flex-1 py-3 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all"
        >
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        <button
          onClick={handleNext}
          disabled={isLoading}
          className="flex-1 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Processing...
            </>
          ) : step === 3 ? (
            <>Submit KYC</>
          ) : (
            <>
              Next
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// BIOMETRIC LOGIN COMPONENT
// ============================================================================

const BiometricLogin = ({
  merchantInfo,
  onSuccess,
  onError,
  isMockMode,
  initialWadh,
  onKycUpdateSuccess,
  deviceFingerprint
}: {
  merchantInfo: MerchantInfo;
  onSuccess: (wadh: string) => void;
  onError: (error: string) => void;
  isMockMode: boolean;
  initialWadh: string;
  onKycUpdateSuccess?: (message: string) => void;
  deviceFingerprint: string;
}) => {
  const [status, setStatus] = useState<'idle' | 'scanning' | 'processing' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [deviceInfo, setDeviceInfo] = useState<{ name: string; serial: string } | null>(null);

  const checkDevice = useCallback(async () => {
    try {
      const rdServicePorts = [11100, 11101, 11102];
      for (const port of rdServicePorts) {
        try {
          const response = await fetch(`https://127.0.0.1:${port}/rd/info`, {
            method: 'RDSERVICE',
            mode: 'cors'
          }).catch(() => null);
          
          if (response?.ok) {
            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, 'text/xml');
            const deviceEl = xml.querySelector('RDService');
            if (deviceEl) {
              setDeviceInfo({
                name: deviceEl.getAttribute('info') || 'Biometric Device',
                serial: deviceEl.getAttribute('srno') || 'Unknown'
              });
              return true;
            }
          }
        } catch {
          continue;
        }
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!isMockMode) {
      checkDevice();
    }
  }, [isMockMode, checkDevice]);

  const captureFingerprint = () => captureBiometric(initialWadh || '');

  const handleScan = async () => {
    setStatus('scanning');
    setMessage('Place your finger on the scanner...');

    try {
      if (isMockMode) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        setStatus('processing');
        setMessage('Authenticating with AEPS server...');
        
        const result = await apiFetchJson('/api/aeps/mock-login', {
          method: 'POST',
          body: JSON.stringify({
            merchantId: merchantInfo.merchant_id,
            type: 'withdraw',
            deviceFingerprint
          })
        });
        
        if (result.success) {
          setStatus('success');
          setMessage('Authentication successful!');
          onSuccess(result.data?.wadh || 'MOCK_WADH');
        } else {
          throw new Error(result.error || 'Authentication failed');
        }
      } else {
        const biometricData = await captureFingerprint();
        
        if (!biometricData) {
          throw new Error('Failed to capture fingerprint. Please ensure device is connected.');
        }

        setStatus('processing');
        setMessage('Authenticating with AEPS server...');

        const loginPayload = {
          merchantId: merchantInfo.merchant_id,
          transType: 'withdraw',
          wadh: initialWadh || '',
          deviceFingerprint,
          ...biometricData
        };
        console.log('[Biometric] Login payload keys:', Object.keys(loginPayload));
        console.log('[Biometric] wadh present:', !!initialWadh, 'length:', initialWadh?.length || 0);

        const result = await apiFetchJson('/api/aeps/login', {
          method: 'POST',
          body: JSON.stringify(loginPayload)
        });
        
        if (result.success) {
          setStatus('success');
          setMessage('Logged in successfully! Redirecting to transactions...');
          setTimeout(() => onSuccess(result.data?.wadh || ''), 1500);
        } else if (result.retry) {
          setStatus('scanning');
          setMessage('KYC verified successfully! Retrying login automatically...');
          onKycUpdateSuccess?.(result.message || 'KYC updated successfully. Retrying...');
          setTimeout(() => handleScan(), 3000);
        } else {
          throw new Error(result.error || result.message || 'Authentication failed');
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Authentication failed';
      const msgLower = errorMsg.toLowerCase();
      if (msgLower.includes('logged in successfully') || msgLower.includes('login successful')) {
        setStatus('success');
        setMessage('Logged in successfully! Redirecting to transactions...');
        setTimeout(() => onSuccess(''), 1500);
        return;
      }
      if (msgLower.includes('kyc update successful') || msgLower.includes('kindly retry')) {
        setStatus('scanning');
        setMessage('KYC verified successfully! Retrying login automatically...');
        onKycUpdateSuccess?.(errorMsg);
        setTimeout(() => handleScan(), 3000);
        return;
      }
      setStatus('error');
      setMessage(errorMsg);
      onError(errorMsg);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md mx-auto text-center">
      <div className={`w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center ${
        status === 'success' || message?.toLowerCase().includes('kyc verified') ? 'bg-green-100' :
        status === 'error' ? 'bg-red-100' :
        status === 'scanning' || status === 'processing' ? 'bg-orange-100' :
        'bg-gray-100'
      }`}>
        {status === 'success' || message?.toLowerCase().includes('kyc verified') ? (
          <CheckCircle2 className="w-12 h-12 text-green-600" />
        ) : status === 'error' ? (
          <XCircle className="w-12 h-12 text-red-600" />
        ) : status === 'scanning' || status === 'processing' ? (
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
          >
            <Fingerprint className="w-12 h-12 text-orange-600" />
          </motion.div>
        ) : (
          <Fingerprint className="w-12 h-12 text-gray-400" />
        )}
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-2">Biometric Authentication</h2>
      <p className="text-gray-500 mb-4">Daily AEPS login required for transactions</p>

      {deviceInfo && !isMockMode && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-green-700">
            <Shield className="w-4 h-4 inline mr-1" />
            Device: {deviceInfo.name}
          </p>
        </div>
      )}

      {isMockMode && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-yellow-700">
            <AlertCircle className="w-4 h-4 inline mr-1" />
            Mock Mode - No real biometric required
          </p>
        </div>
      )}

      {message && message.toLowerCase().includes('kyc verified') ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-6">
          <p className="text-sm text-green-700 font-medium">
            <CheckCircle2 className="w-4 h-4 inline mr-1" />
            {message}
          </p>
        </div>
      ) : (
        <p className={`text-sm mb-6 ${
          status === 'success' ? 'text-green-600' :
          status === 'error' ? 'text-red-600' :
          'text-gray-600'
        }`}>
          {message || 'Click the button below to authenticate'}
        </p>
      )}

      {status === 'success' ? (
        <div className="flex items-center justify-center gap-2 text-green-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Redirecting to transactions...</span>
        </div>
      ) : message?.toLowerCase().includes('kyc verified') ? (
        <div className="flex items-center justify-center gap-2 text-green-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Retrying login automatically...</span>
        </div>
      ) : status === 'idle' || status === 'error' ? (
        <button
          onClick={handleScan}
          className="w-full py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all flex items-center justify-center gap-2"
        >
          <Fingerprint className="w-5 h-5" />
          {status === 'error' ? 'Retry Authentication' : 'Start Authentication'}
        </button>
      ) : status === 'scanning' || status === 'processing' ? (
        <div className="flex items-center justify-center gap-2 text-orange-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Please wait...</span>
        </div>
      ) : null}
    </div>
  );
};

// ============================================================================
// TRANSACTION COMPONENT
// ============================================================================

const TransactionPanel = ({
  merchantInfo,
  banks,
  wadh,
  walletBalance,
  isMockMode,
  onTransactionComplete,
  onSessionExpired,
  deviceFingerprint
}: {
  merchantInfo: MerchantInfo;
  banks: Bank[];
  wadh: string;
  walletBalance: number;
  isMockMode: boolean;
  onTransactionComplete: (result: TransactionResult) => void;
  onSessionExpired: () => void;
  deviceFingerprint: string;
}) => {
  const [transactionType, setTransactionType] = useState<TransactionType>('balance_inquiry');
  const [selectedBank, setSelectedBank] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [mobile, setMobile] = useState('');
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<TransactionResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [show2FA, setShow2FA] = useState(false);
  const [twoFAStatus, setTwoFAStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  const [twoFAMessage, setTwoFAMessage] = useState('');

  const transactionTypes = [
    { id: 'balance_inquiry', label: 'Balance Inquiry', icon: <Wallet className="w-5 h-5" />, requiresAmount: false },
    { id: 'cash_withdrawal', label: 'Cash Withdrawal', icon: <IndianRupee className="w-5 h-5" />, requiresAmount: true },
    { id: 'cash_deposit', label: 'Cash Deposit', icon: <CreditCard className="w-5 h-5" />, requiresAmount: true },
    { id: 'mini_statement', label: 'Mini Statement', icon: <FileText className="w-5 h-5" />, requiresAmount: false }
  ];

  const quickAmounts = [100, 500, 1000, 2000, 5000, 10000];

  const validate = () => {
    const newErrors: Record<string, string> = {};
    
    if (!selectedBank) newErrors.bank = 'Please select a bank';
    const cleanAadhaar = aadhaar.replace(/\s/g, '');
    if (!/^\d{12}$/.test(cleanAadhaar)) {
      newErrors.aadhaar = 'Valid 12-digit Aadhaar required';
    } else if (cleanAadhaar[0] === '0' || cleanAadhaar[0] === '1') {
      newErrors.aadhaar = 'Aadhaar cannot start with 0 or 1';
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) newErrors.mobile = 'Valid 10-digit mobile required';
    
    const requiresAmount = transactionType === 'cash_withdrawal' || transactionType === 'cash_deposit';
    if (requiresAmount) {
      const amtNum = parseFloat(amount);
      if (isNaN(amtNum) || amtNum < 100) newErrors.amount = 'Minimum amount is ₹100';
      if (amtNum > 10000) newErrors.amount = 'Maximum amount is ₹10,000';
      if (amtNum % 100 !== 0) newErrors.amount = 'Amount must be multiple of ₹100';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    setShow2FA(true);
    setTwoFAStatus('idle');
    setTwoFAMessage('');
  };

  const handle2FACapture = async () => {
    setTwoFAStatus('scanning');
    setTwoFAMessage('Place your finger on the scanner...');

    try {
      if (isMockMode) {
        await new Promise(r => setTimeout(r, 1000));
        setTwoFAStatus('success');
        setTwoFAMessage('Verified! Processing transaction...');
        await processTransaction();
        return;
      }

      const biometricData = await captureBiometric(wadh);
      if (!biometricData) {
        setTwoFAStatus('error');
        setTwoFAMessage('Failed to capture fingerprint. Ensure device is connected.');
        return;
      }

      setTwoFAStatus('success');
      setTwoFAMessage('Verified! Processing transaction...');
      await processTransaction(biometricData);
    } catch (err) {
      setTwoFAStatus('error');
      setTwoFAMessage(err instanceof Error ? err.message : 'Biometric verification failed');
    }
  };

  const processTransaction = async (biometricData?: BiometricData) => {
    setIsProcessing(true);
    setResult(null);

    try {
      const payload: Record<string, unknown> = {
        merchantId: merchantInfo.merchant_id,
        transactionType,
        bankIin: selectedBank,
        bankName: banks.find(b => b.iin === selectedBank)?.bankName,
        customerAadhaar: aadhaar.replace(/\s/g, ''),
        customerMobile: mobile,
        amount: parseFloat(amount) || 0,
        wadh,
        deviceFingerprint
      };

      if (biometricData) {
        payload.biometricData = biometricData;
      }

      const data = await apiFetchJson('/api/aeps/transact', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      // Handle 2FA session expiry or device change — redirect to re-auth
      if (data.code === 'SESSION_2FA_EXPIRED' || data.code === 'DEVICE_CHANGED') {
        setShow2FA(false);
        onSessionExpired();
        return;
      }
      
      const txnResult: TransactionResult = {
        success: data.success,
        receipt: data.receipt,
      };

      setShow2FA(false);
      setResult(txnResult);
      onTransactionComplete(txnResult);
    } catch (error: any) {
      setShow2FA(false);
      if (error?.code === 'SESSION_2FA_EXPIRED' || error?.code === 'DEVICE_CHANGED') {
        onSessionExpired();
        return;
      }
      const errMsg = error instanceof Error ? error.message : 'Transaction failed';
      const errorResult: TransactionResult = {
        success: false,
        receipt: {
          txnId: '',
          timestamp: new Date().toISOString(),
          type: transactionType,
          customer: {},
          transaction: {},
          retailer: { id: '' },
          status: 'FAILED',
          error: {
            errorCode: 'ERROR',
            errorMessage: errMsg,
            action: 'retry',
            retryable: true,
          },
        },
      };
      setResult(errorResult);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetForm = () => {
    setResult(null);
    setAadhaar('');
    setMobile('');
    setAmount('');
    setSelectedBank('');
  };

  const handleRetry = () => {
    setResult(null);
    setShow2FA(false);
    setTwoFAStatus('idle');
    setTwoFAMessage('');
    setErrors({});
  };

  const handlePrint = () => {
    window.print();
  };

  const handleShare = async () => {
    const r = result!.receipt;
    const typeLabel = transactionType === 'cash_withdrawal' ? 'Withdrawal'
      : transactionType === 'cash_deposit' ? 'Deposit'
      : transactionType === 'balance_inquiry' ? 'Balance Enquiry'
      : 'Mini Statement';
    const displayUtr = r.utr && r.utr !== '00' && r.utr !== '0' && r.utr.trim() !== '' ? r.utr : null;
    const text = [
      'SAME DAY SOLUTION PVT LTD',
      `Transaction Receipt`,
      displayUtr ? `UTR: ${displayUtr}` : '',
      `Date: ${new Date(r.timestamp).toLocaleString('en-IN')}`,
      `Type: ${typeLabel}`,
      r.transaction.amount ? `Amount: ₹${r.transaction.amount}` : '',
      r.bank?.availableBalance ? `Balance: ₹${r.bank.availableBalance}` : '',
      `Status: ${r.status}`,
      r.error ? `Reason: ${r.error.errorMessage}` : '',
    ].filter(Boolean).join('\n');

    if (navigator.share) {
      try {
        await navigator.share({ title: 'AEPS Receipt', text });
      } catch { /* user cancelled */ }
    } else {
      const phoneNum = mobile || '';
      window.open(`https://wa.me/${phoneNum ? '91' + phoneNum : ''}?text=${encodeURIComponent(text)}`, '_blank');
    }
  };

  if (result) {
    const r = result.receipt;
    const isSuccess = r.status === 'SUCCESS';
    const isFailed = r.status === 'FAILED';
    const showAmount = transactionType === 'cash_withdrawal' || transactionType === 'cash_deposit';
    const showBalance = transactionType === 'balance_inquiry'
      || transactionType === 'cash_withdrawal'
      || transactionType === 'cash_deposit'
      || (transactionType === 'mini_statement' && !!r.bank?.availableBalance);
    const showMiniStmt = transactionType === 'mini_statement'
      && Array.isArray(r.miniStatement) && r.miniStatement.length > 0;

    const typeLabel = transactionType === 'cash_withdrawal' ? 'Cash Withdrawal'
      : transactionType === 'cash_deposit' ? 'Cash Deposit'
      : transactionType === 'balance_inquiry' ? 'Balance Enquiry'
      : 'Mini Statement';

    const balanceLabel = transactionType === 'cash_withdrawal' ? 'Remaining Balance'
      : transactionType === 'cash_deposit' ? 'Updated Balance'
      : 'Available Balance';

    return (
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl mx-auto overflow-hidden print:shadow-none print:rounded-none">
        {/* Receipt — printable area */}
        <div id="aeps-receipt">
          {/* Branded Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-5 text-center">
            <h1 className="text-xl font-bold text-white tracking-wide">SAME DAY SOLUTION PVT LTD</h1>
            <p className="text-blue-200 text-xs mt-1 uppercase tracking-widest">Transaction Receipt</p>
          </div>

          {/* Status Banner */}
          <div className={`px-8 py-4 ${isSuccess ? 'bg-green-50 border-b-2 border-green-200' : 'bg-red-50 border-b-2 border-red-200'}`}>
            <div className="flex items-center justify-center gap-3">
              {isSuccess ? (
                <CheckCircle2 className="w-7 h-7 text-green-500" />
              ) : (
                <XCircle className="w-7 h-7 text-red-500" />
              )}
              <div>
                <h2 className={`text-lg font-bold ${isSuccess ? 'text-green-700' : 'text-red-700'}`}>
                  {isSuccess ? 'Transaction Successful' : 'Transaction Failed'}
                </h2>
                {isFailed && r.error && (
                  <p className="text-sm text-red-600">{r.error.errorMessage}</p>
                )}
              </div>
            </div>
          </div>

          <div className="px-8 py-6 space-y-0">
            {/* Transaction Meta */}
            <div className="bg-blue-50 rounded-xl p-4 mb-5">
              <div className="space-y-2.5 text-sm">
                {r.utr && r.utr !== '00' && r.utr !== '0' && r.utr.trim() !== '' && (
                  <div className="flex justify-between items-center">
                    <span className="text-blue-800 font-medium">UTR Number</span>
                    <span className="font-mono text-gray-700">{r.utr}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-blue-800 font-medium">Date & Time</span>
                  <span className="text-gray-700">{new Date(r.timestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>
              </div>
            </div>

            {/* Customer Details */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-blue-500 rounded-full"></div>
                <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wider">Customer Details</h3>
              </div>
              <div className="space-y-2 text-sm pl-3 border-l-2 border-blue-100">
                {r.customer.aadhaarMasked && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Aadhaar</span>
                    <span className="font-medium text-gray-800">{r.customer.aadhaarMasked}</span>
                  </div>
                )}
                {r.customer.bankName && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Bank</span>
                    <span className="font-medium text-gray-800">{r.customer.bankName}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Transaction Details */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 bg-blue-500 rounded-full"></div>
                <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wider">Transaction Details</h3>
              </div>
              <div className="space-y-2 text-sm pl-3 border-l-2 border-blue-100">
                <div className="flex justify-between">
                  <span className="text-gray-500">Type</span>
                  <span className="font-semibold text-gray-800">{typeLabel}</span>
                </div>
                {showAmount && r.transaction.amount != null && (
                  <div className="flex justify-between items-center bg-gray-50 -ml-3 pl-3 pr-2 py-2 rounded-r-lg">
                    <span className="text-gray-500">Amount</span>
                    <span className="font-bold text-xl text-gray-900">₹{Number(r.transaction.amount).toLocaleString('en-IN')}</span>
                  </div>
                )}
                {showBalance && r.bank?.availableBalance && (
                  <div className="flex justify-between items-center bg-green-50 -ml-3 pl-3 pr-2 py-2 rounded-r-lg">
                    <span className="text-green-700 font-medium">{balanceLabel}</span>
                    <span className="font-bold text-xl text-green-600">₹{r.bank.availableBalance}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Mini Statement */}
            {showMiniStmt && r.miniStatement && (
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 bg-blue-500 rounded-full"></div>
                  <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wider">Mini Statement</h3>
                </div>
                <div className="bg-gray-50 rounded-xl overflow-hidden">
                  {r.miniStatement.map((entry, i) => (
                    <div key={i} className="flex justify-between items-center px-4 py-2.5 border-b border-gray-100 last:border-0">
                      <div>
                        <p className="font-medium text-gray-800 text-sm">{entry.narration}</p>
                        <p className="text-gray-400 text-xs">{entry.date}</p>
                      </div>
                      <span className={`font-bold text-sm ${entry.txnType === 'Cr' ? 'text-green-600' : 'text-red-600'}`}>
                        {entry.txnType === 'Cr' ? '+' : '-'}₹{entry.amount}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty mini statement info */}
            {transactionType === 'mini_statement' && isSuccess && !showMiniStmt && (
              <div className="mb-5">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-amber-700">No recent transactions found for this account.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Error details for failed */}
            {isFailed && r.error && (
              <div className="mb-5">
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm">
                  <div className="flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-red-800">Reason</p>
                      <p className="text-red-600 mt-0.5">{r.error.errorMessage}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Retailer Info */}
            {r.retailer.id && (
              <div className="flex justify-between items-center text-xs text-gray-400 py-3 border-t border-gray-100">
                <span>Retailer: {r.retailer.name || r.retailer.id.slice(0, 12)}</span>
                {r.retailer.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{r.retailer.location}</span>}
              </div>
            )}
          </div>

          {/* Branded Footer */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-3 text-center">
            <p className="text-blue-200 text-xs">System Generated Receipt • www.samedaysolution.in</p>
          </div>
        </div>

        {/* Action Buttons — hidden in print */}
        <div className="px-8 py-6 bg-gray-50 print:hidden">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handlePrint}
              className="flex-1 min-w-[120px] py-3 bg-white border-2 border-blue-200 text-blue-700 font-semibold rounded-xl hover:bg-blue-50 transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <FileText className="w-4 h-4" />
              Print
            </button>

            {isSuccess && (
              <button
                onClick={handleShare}
                className="flex-1 min-w-[120px] py-3 bg-white border-2 border-green-200 text-green-700 font-semibold rounded-xl hover:bg-green-50 transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                <ArrowRight className="w-4 h-4" />
                Share
              </button>
            )}

            {isFailed && (
              <button
                onClick={handleRetry}
                className="flex-1 min-w-[120px] py-3 bg-white border-2 border-orange-200 text-orange-700 font-semibold rounded-xl hover:bg-orange-50 transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            )}

            <button
              onClick={resetForm}
              className="flex-1 min-w-[120px] py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all flex items-center justify-center gap-2 shadow-md shadow-blue-500/20"
            >
              <RefreshCw className="w-4 h-4" />
              New Transaction
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
            <CreditCard className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">AEPS Transaction</h2>
            <p className="text-gray-500">Perform AEPS transactions</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">Wallet Balance</p>
          <p className="text-xl font-bold text-green-600">₹{walletBalance.toLocaleString('en-IN')}</p>
        </div>
      </div>

      {isMockMode && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6">
          <p className="text-sm text-yellow-700">
            <AlertCircle className="w-4 h-4 inline mr-1" />
            Mock Mode - Transactions are simulated
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {transactionTypes.map(type => (
          <button
            key={type.id}
            onClick={() => setTransactionType(type.id as TransactionType)}
            className={`p-3 rounded-xl border-2 transition-all text-center ${
              transactionType === type.id
                ? 'border-orange-500 bg-orange-50'
                : 'border-gray-200 hover:border-orange-300'
            }`}
          >
            <div className={`w-10 h-10 mx-auto mb-2 rounded-full flex items-center justify-center ${
              transactionType === type.id ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-500'
            }`}>
              {type.icon}
            </div>
            <p className="text-xs font-semibold">{type.label}</p>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Customer Bank *</label>
          <select
            value={selectedBank}
            onChange={e => {
              setSelectedBank(e.target.value);
              if (errors.bank) setErrors(prev => ({ ...prev, bank: '' }));
            }}
            className={`w-full px-4 py-3 border-2 rounded-xl focus:ring-4 focus:ring-orange-100 ${
              errors.bank ? 'border-red-500' : 'border-gray-200 focus:border-orange-500'
            }`}
          >
            <option value="">Select Bank</option>
            {banks.map((bank, idx) => (
              <option key={`${bank.iin}-${idx}`} value={bank.iin}>{bank.bankName || (bank as any).name || 'Unknown'}</option>
            ))}
          </select>
          {errors.bank && <p className="text-red-500 text-sm mt-1">{errors.bank}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Customer Aadhaar *</label>
            <input
              type="text"
              value={aadhaar}
              onChange={e => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 12);
                setAadhaar(val);
              }}
              onBlur={() => {
                const clean = aadhaar.replace(/\s/g, '');
                if (clean && !/^\d{12}$/.test(clean)) {
                  setErrors(prev => ({ ...prev, aadhaar: 'Valid 12-digit Aadhaar required' }));
                } else if (clean && (clean[0] === '0' || clean[0] === '1')) {
                  setErrors(prev => ({ ...prev, aadhaar: 'Aadhaar cannot start with 0 or 1' }));
                } else if (errors.aadhaar) {
                  setErrors(prev => ({ ...prev, aadhaar: '' }));
                }
              }}
              placeholder="Enter 12-digit Aadhaar"
              autoComplete="off"
              className={`w-full px-4 py-3 border-2 rounded-xl focus:ring-4 focus:ring-orange-100 ${
                errors.aadhaar ? 'border-red-500' : 'border-gray-200 focus:border-orange-500'
              }`}
            />
            {errors.aadhaar && <p className="text-red-500 text-sm mt-1">{errors.aadhaar}</p>}
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Customer Mobile *</label>
            <input
              type="text"
              value={mobile}
              onChange={e => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                setMobile(val);
              }}
              onBlur={() => {
                if (mobile && !/^[6-9]\d{9}$/.test(mobile)) {
                  setErrors(prev => ({ ...prev, mobile: 'Valid 10-digit mobile required' }));
                } else if (errors.mobile) {
                  setErrors(prev => ({ ...prev, mobile: '' }));
                }
              }}
              placeholder="9876543210"
              autoComplete="off"
              className={`w-full px-4 py-3 border-2 rounded-xl focus:ring-4 focus:ring-orange-100 ${
                errors.mobile ? 'border-red-500' : 'border-gray-200 focus:border-orange-500'
              }`}
            />
            {errors.mobile && <p className="text-red-500 text-sm mt-1">{errors.mobile}</p>}
          </div>
        </div>

        {(transactionType === 'cash_withdrawal' || transactionType === 'cash_deposit') && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Amount (₹) *</label>
            <input
              type="number"
              value={amount}
              onChange={e => {
                setAmount(e.target.value);
                if (errors.amount) setErrors(prev => ({ ...prev, amount: '' }));
              }}
              placeholder="Enter amount"
              min={100}
              max={10000}
              step={100}
              className={`w-full px-4 py-3 border-2 rounded-xl focus:ring-4 focus:ring-orange-100 ${
                errors.amount ? 'border-red-500' : 'border-gray-200 focus:border-orange-500'
              }`}
            />
            {errors.amount && <p className="text-red-500 text-sm mt-1">{errors.amount}</p>}
            
            <div className="flex flex-wrap gap-2 mt-3">
              {quickAmounts.map(amt => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setAmount(String(amt))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    amount === String(amt)
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-orange-100'
                  }`}
                >
                  ₹{amt.toLocaleString()}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={isProcessing}
        className="w-full mt-6 py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Processing Transaction...
          </>
        ) : (
          <>
            <Fingerprint className="w-5 h-5" />
            {transactionType === 'balance_inquiry' ? 'Check Balance' :
             transactionType === 'mini_statement' ? 'Get Statement' :
             transactionType === 'cash_withdrawal' ? `Withdraw ₹${amount || '0'}` :
             `Deposit ₹${amount || '0'}`}
          </>
        )}
      </button>

      {/* 2FA Biometric Confirmation Modal */}
      <AnimatePresence>
        {show2FA && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget && twoFAStatus !== 'scanning') {
                setShow2FA(false);
              }
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center"
            >
              <div className={`w-20 h-20 mx-auto mb-5 rounded-full flex items-center justify-center ${
                twoFAStatus === 'success' ? 'bg-green-100' :
                twoFAStatus === 'error' ? 'bg-red-100' :
                twoFAStatus === 'scanning' ? 'bg-orange-100' :
                'bg-blue-100'
              }`}>
                {twoFAStatus === 'success' ? (
                  <CheckCircle2 className="w-10 h-10 text-green-600" />
                ) : twoFAStatus === 'error' ? (
                  <XCircle className="w-10 h-10 text-red-600" />
                ) : twoFAStatus === 'scanning' ? (
                  <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                    <Fingerprint className="w-10 h-10 text-orange-600" />
                  </motion.div>
                ) : (
                  <Shield className="w-10 h-10 text-blue-600" />
                )}
              </div>

              <h3 className="text-xl font-bold text-gray-900 mb-1">2FA Verification</h3>
              <p className="text-gray-500 text-sm mb-4">
                Scan your fingerprint to authorize this transaction
              </p>

              <div className="bg-gray-50 rounded-xl p-3 mb-5 text-left space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Type:</span>
                  <span className="font-semibold capitalize">{transactionType.replace(/_/g, ' ')}</span>
                </div>
                {(transactionType === 'cash_withdrawal' || transactionType === 'cash_deposit') && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Amount:</span>
                    <span className="font-semibold text-orange-600">₹{parseFloat(amount || '0').toLocaleString('en-IN')}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Bank:</span>
                  <span className="font-semibold">{banks.find(b => b.iin === selectedBank)?.bankName || '-'}</span>
                </div>
              </div>

              {twoFAMessage && (
                <p className={`text-sm mb-4 ${
                  twoFAStatus === 'success' ? 'text-green-600' :
                  twoFAStatus === 'error' ? 'text-red-600' :
                  'text-gray-600'
                }`}>
                  {twoFAMessage}
                </p>
              )}

              {twoFAStatus === 'idle' || twoFAStatus === 'error' ? (
                <div className="space-y-3">
                  <button
                    onClick={handle2FACapture}
                    className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all flex items-center justify-center gap-2"
                  >
                    <Fingerprint className="w-5 h-5" />
                    {twoFAStatus === 'error' ? 'Retry Scan' : 'Scan Fingerprint'}
                  </button>
                  <button
                    onClick={() => setShow2FA(false)}
                    className="w-full py-3 text-gray-500 hover:text-gray-700 font-medium transition-all"
                  >
                    Cancel
                  </button>
                </div>
              ) : twoFAStatus === 'scanning' || isProcessing ? (
                <div className="flex items-center justify-center gap-2 text-orange-600 py-3">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{isProcessing ? 'Processing transaction...' : 'Scanning...'}</span>
                </div>
              ) : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AEPSUnifiedFlow({ user }: { user: AEPSUser }) {
  const [currentStep, setCurrentStep] = useState<FlowStep>('check_merchant');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' } | null>(null);
  const [merchantInfo, setMerchantInfo] = useState<MerchantInfo | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [wadh, setWadh] = useState<string>('');
  const [walletBalance, setWalletBalance] = useState(0);
  const [isMockMode, setIsMockMode] = useState(false);
  const [deviceFP] = useState(() => generateDeviceFingerprint());

  const steps = [
    { id: 'check_merchant', label: 'Merchant', icon: <User className="w-5 h-5" /> },
    { id: 'kyc_form', label: 'KYC', icon: <UserCheck className="w-5 h-5" /> },
    { id: 'biometric_login', label: 'Login', icon: <Fingerprint className="w-5 h-5" /> },
    { id: 'transaction', label: 'Transact', icon: <CreditCard className="w-5 h-5" /> }
  ];

  const checkMerchantStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [loginStatus, walletData] = await Promise.all([
        apiFetchJson('/api/aeps/login-status', {
          method: 'POST',
          body: JSON.stringify({ merchantId: user.partner_id, type: 'withdraw', deviceFingerprint: deviceFP })
        }),
        apiFetchJson('/api/wallet/balance?wallet_type=aeps').catch(() => ({ balance: 0 }))
      ]);

      setIsMockMode(loginStatus.isMockMode || false);
      setWalletBalance(walletData.balance || 0);

      if (loginStatus.data?.kycStatus === 'validated') {
        setMerchantInfo({
          merchant_id: user.partner_id,
          name: user.name || '',
          mobile: '',
          kyc_status: loginStatus.data.kycStatus,
          login_wadh: loginStatus.data.wadh
        });

        if (loginStatus.data.wadh) {
          setWadh(loginStatus.data.wadh);
        }

        // Check if 2FA session is still valid (24h window, same device)
        if (loginStatus.data.loginStatus) {
          setBanks(loginStatus.data.bankList || []);
          setCurrentStep('transaction');
        } else {
          if (loginStatus.data.sessionExpired) {
            setNotification({ message: '2FA session expired (24 hours). Please re-authenticate.', type: 'info' });
          } else if (loginStatus.data.deviceChanged) {
            setNotification({ message: 'New device detected. Please re-authenticate for this device.', type: 'info' });
          }
          const banksData = await apiFetchJson(`/api/aeps/banks?merchantId=${user.partner_id}`);
          setBanks(banksData.data || banksData.banks || []);
          setCurrentStep('biometric_login');
        }
      } else if (loginStatus.data?.kycStatus === 'pending') {
        setError('KYC verification is in progress. Please wait and try again later.');
        setCurrentStep('kyc_form');
      } else {
        setCurrentStep('kyc_form');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check merchant status');
      setCurrentStep('kyc_form');
    } finally {
      setIsLoading(false);
    }
  }, [user.partner_id, user.name, deviceFP]);

  useEffect(() => {
    checkMerchantStatus();
  }, [checkMerchantStatus]);

  const handleKYCSubmit = async (data: KYCFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await apiFetchJson('/api/aeps/merchant/create', {
        method: 'POST',
        body: JSON.stringify({
          name: data.fullName.trim(),
          mobile: data.mobile.replace(/\D/g, ''),
          email: data.email.trim(),
          pan: data.pan.toUpperCase().replace(/\s/g, ''),
          aadhar: data.aadhaar.replace(/\s/g, '').replace(/\D/g, ''),
          dob: data.dateOfBirth,
          gender: data.gender,
          address: data.address.trim(),
          city: data.city.trim(),
          pincode: data.pincode.replace(/\D/g, ''),
          bankAccountNumber: data.bankAccount.replace(/\D/g, ''),
          bankIfsc: data.bankIfsc.toUpperCase().replace(/\s/g, ''),
          bankName: data.bankName.trim()
        })
      });

      if (result.success) {
        setMerchantInfo({
          merchant_id: result.data?.merchantId || user.partner_id,
          name: data.fullName,
          mobile: data.mobile,
          kyc_status: result.data?.kycStatus || 'pending'
        });
        
        const banksData = await apiFetchJson(`/api/aeps/banks?merchantId=${result.data?.merchantId || user.partner_id}`);
        setBanks(banksData.data || banksData.banks || []);
        
        setCurrentStep('biometric_login');
      } else {
        throw new Error(result.error || 'KYC submission failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'KYC submission failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBiometricSuccess = async (newWadh: string) => {
    setWadh(newWadh);
    setError(null);
    setNotification({ message: 'AEPS login successful! You can now perform transactions.', type: 'success' });

    if (banks.length === 0) {
      try {
        const banksData = await apiFetchJson(`/api/aeps/banks?merchantId=${user.partner_id}`);
        setBanks(banksData.data || banksData.banks || []);
      } catch {
        console.error('[AEPS] Failed to fetch banks after login');
      }
    }

    setCurrentStep('transaction');
  };

  const handleTransactionComplete = (result: TransactionResult) => {
    if (result.success) {
      apiFetchJson('/api/wallet/balance?wallet_type=aeps')
        .then(data => setWalletBalance(data.balance || 0))
        .catch(() => {});
    }
  };

  const handleSessionExpired = () => {
    setError('2FA session expired or device changed. Please re-authenticate.');
    setCurrentStep('biometric_login');
  };

  const getStepIndex = () => {
    switch (currentStep) {
      case 'check_merchant': return 0;
      case 'kyc_form': return 1;
      case 'biometric_login': return 2;
      case 'transaction': return 3;
      default: return 0;
    }
  };

  if (isLoading && currentStep === 'check_merchant') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="w-12 h-12 text-orange-500 animate-spin mb-4" />
        <p className="text-gray-600">Checking merchant status...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <StepIndicator currentStep={getStepIndex()} steps={steps} />

      {notification && (
        <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${
          notification.type === 'success' 
            ? 'bg-green-50 border border-green-200' 
            : 'bg-blue-50 border border-blue-200'
        }`}>
          <CheckCircle2 className={`w-5 h-5 flex-shrink-0 ${
            notification.type === 'success' ? 'text-green-500' : 'text-blue-500'
          }`} />
          <p className={notification.type === 'success' ? 'text-green-700' : 'text-blue-700'}>
            {notification.message}
          </p>
          <button
            onClick={() => setNotification(null)}
            className={`ml-auto ${
              notification.type === 'success' ? 'text-green-500 hover:text-green-700' : 'text-blue-500 hover:text-blue-700'
            }`}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
        >
          {currentStep === 'kyc_form' && (
            <KYCForm
              user={user}
              onSubmit={handleKYCSubmit}
              onCancel={() => window.history.back()}
              isLoading={isLoading}
            />
          )}

          {currentStep === 'biometric_login' && merchantInfo && (
            <BiometricLogin
              merchantInfo={merchantInfo}
              onSuccess={handleBiometricSuccess}
              onError={setError}
              isMockMode={isMockMode}
              initialWadh={wadh}
              deviceFingerprint={deviceFP}
              onKycUpdateSuccess={(msg) => {
                setError(null);
                setNotification({ message: msg, type: 'success' });
              }}
            />
          )}

          {currentStep === 'transaction' && merchantInfo && (
            <TransactionPanel
              merchantInfo={merchantInfo}
              banks={banks}
              wadh={wadh}
              walletBalance={walletBalance}
              isMockMode={isMockMode}
              onTransactionComplete={handleTransactionComplete}
              onSessionExpired={handleSessionExpired}
              deviceFingerprint={deviceFP}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
