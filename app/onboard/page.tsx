'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check, Loader2, Lock, Mail, PartyPopper, ShieldCheck, Smartphone,
  Sparkles, CreditCard, Landmark, Store, Camera, FileText, FileSignature,
  Rocket, Clock, ShieldCheck as ShieldIcon, HelpCircle, RefreshCw,
} from 'lucide-react'
import SelfieCapture from '@/components/onboarding/SelfieCapture'
import LivenessVideoCapture from '@/components/onboarding/LivenessVideoCapture'
import DocumentUploadField from '@/components/onboarding/DocumentUploadField'
import GpsPhotoCapture from '@/components/onboarding/GpsPhotoCapture'
import { getApiUrl } from '@/lib/api-client'
import { computeOnboardingProgress } from '@/lib/onboarding/progress'

interface DocSpec {
  type: string
  label: string
  required: boolean
  gps?: boolean
  hasTemplate?: boolean
  hint?: string
}

interface InviteData {
  id: string
  phone: string
  email: string
  name?: string
  target_role: string
  target_role_label: string
  status: string
  phone_verified_at?: string | null
  email_verified_at?: string | null
  aadhaar_verified_at?: string | null
  invited_by_name?: string
  invited_by_role?: string
}

const STEPS = [
  'Welcome',
  'Mobile',
  'Email',
  'Aadhaar',
  'PAN',
  'Business',
  'Bank',
  'Selfie & Video',
  'Documents',
  'Declaration',
  'Finish',
]

const DIGILOCKER_STORAGE_KEY = 'onboard_digilocker'

// Icon per step (aligned 1:1 with STEPS).
const STEP_ICONS = [
  Sparkles, Smartphone, Mail, ShieldCheck, CreditCard, Store,
  Landmark, Camera, FileText, FileSignature, Rocket,
]

// ── Motion primitives ───────────────────────────────────────────────────────

const springPop = { type: 'spring', stiffness: 500, damping: 30 } as const

interface ButtonProps {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  busy?: boolean
  className?: string
}

function PrimaryButton({ children, disabled, busy, className = '', onClick }: ButtonProps) {
  return (
    <motion.button
      whileHover={disabled || busy ? undefined : { scale: 1.03, y: -1 }}
      whileTap={disabled || busy ? undefined : { scale: 0.96 }}
      transition={springPop}
      disabled={disabled || busy}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition-colors ${
        disabled || busy ? 'bg-gray-300 shadow-none' : 'bg-indigo-600 hover:bg-indigo-700'
      } ${className}`}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </motion.button>
  )
}

function GhostButton({ children, className = '', onClick }: ButtonProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.95 }}
      transition={springPop}
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 ${className}`}
    >
      {children}
    </motion.button>
  )
}

function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={springPop}
      className="mt-4 flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700 ring-1 ring-green-200"
    >
      <motion.span
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ ...springPop, delay: 0.1 }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500 text-white"
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </motion.span>
      <span>{children}</span>
    </motion.div>
  )
}

function ErrorBanner({ err }: { err: string }) {
  return (
    <AnimatePresence>
      {err && (
        <motion.div
          key={err}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto', x: [0, -8, 8, -5, 5, 0] }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ x: { duration: 0.4 }, default: { duration: 0.25 } }}
          className="overflow-hidden"
        >
          <div className="mb-3 mt-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-200">{err}</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function GuidanceNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl bg-indigo-50/70 px-3 py-2 text-xs leading-relaxed text-indigo-700 ring-1 ring-indigo-100">
      <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

// ── Form primitives ─────────────────────────────────────────────────────────

function StepHeader({ icon: Icon, title, subtitle }: { icon: React.ComponentType<{ className?: string }>; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={springPop}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-600/25"
      >
        <Icon className="h-5 w-5" />
      </motion.div>
      <div>
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  icon?: React.ComponentType<{ className?: string }>
  hint?: string
  required?: boolean
  optional?: boolean
  mono?: boolean
  maxLength?: number
  autoCapitalize?: boolean
  inputMode?: 'text' | 'numeric'
}

function Field({
  label, value, onChange, placeholder, icon: Icon, hint, required, optional, mono, maxLength, autoCapitalize, inputMode,
}: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500">*</span>}
        {optional && <span className="text-xs font-normal text-gray-400">(optional)</span>}
      </span>
      <div className="relative">
        {Icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={inputMode}
          className={`w-full rounded-xl border-2 border-gray-200 bg-gray-50/60 py-2.5 text-gray-900 transition-all placeholder:text-gray-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 ${
            Icon ? 'pl-9 pr-3' : 'px-3'
          } ${mono ? 'font-mono tracking-wider' : ''} ${autoCapitalize ? 'uppercase' : ''}`}
        />
      </div>
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  )
}

function VerifiedCard({ label, name }: { label: string; name?: string }) {
  return (
    <SuccessNote>
      {label}
      {name ? ` — ${name}` : ''}
    </SuccessNote>
  )
}

// ── Wizard shell ────────────────────────────────────────────────────────────

function OnboardWizard() {
  const searchParams = useSearchParams()
  const urlToken = searchParams.get('token') || ''

  const [token, setToken] = useState(urlToken)
  const [loading, setLoading] = useState(true)
  const [fatal, setFatal] = useState('')
  const [invite, setInvite] = useState<InviteData | null>(null)
  const [documents, setDocuments] = useState<DocSpec[]>([])
  const [requiresUplineApproval, setRequiresUplineApproval] = useState(false)
  const [verified, setVerified] = useState<Record<string, string>>({})
  const [verifiedNames, setVerifiedNames] = useState<Record<string, string>>({})
  const [savedGstin, setSavedGstin] = useState('')
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const resumedRef = useRef(false)

  // Restore the token after the DigiLocker round-trip (the redirect URL must
  // not carry a query string, so the token is stashed in localStorage).
  useEffect(() => {
    if (urlToken) {
      setToken(urlToken)
      return
    }
    try {
      const pending = localStorage.getItem(DIGILOCKER_STORAGE_KEY)
      if (pending) {
        const saved = JSON.parse(pending)?.token
        if (saved) {
          setToken(saved)
          window.history.replaceState(null, '', `/onboard?token=${encodeURIComponent(saved)}`)
          return
        }
      }
    } catch {}
    setToken('')
  }, [urlToken])

  const api = useCallback(
    async (path: string, options?: RequestInit) => {
      const res = await fetch(getApiUrl(`/api/onboard/${encodeURIComponent(token)}${path}`), {
        ...options,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.gateErrors?.join(', ') || 'Request failed')
      return data
    },
    [token]
  )

  const reload = useCallback(async () => {
    const data = await api('', { method: 'GET' })
    setInvite(data.invite)
    setDocuments(data.documents || [])
    setRequiresUplineApproval(!!data.requiresUplineApproval)
    const v: Record<string, string> = {}
    const names: Record<string, string> = {}
    for (const item of data.verifications || []) {
      v[item.type] = item.status
      if (item.verified_name) names[item.type] = item.verified_name
      if (item.type === 'GST' && item.gstin) setSavedGstin(item.gstin)
    }
    setVerified(v)
    setVerifiedNames(names)
    return data
  }, [api])

  useEffect(() => {
    if (!token) {
      setFatal('Missing onboarding token. Please use the link from your invitation.')
      setLoading(false)
      return
    }
    setFatal('')
    reload()
      .then((data) => {
        if (resumedRef.current) return
        resumedRef.current = true
        // Returning from DigiLocker? Jump straight back to the Aadhaar step.
        try {
          if (localStorage.getItem(DIGILOCKER_STORAGE_KEY)) {
            setStep(3)
            return
          }
        } catch {}
        // Resume at the first step the applicant hasn't completed yet, so a
        // refresh never re-asks for a mobile/email/Aadhaar they already passed.
        const vmap: Record<string, string> = {}
        for (const it of data?.verifications || []) vmap[it.type] = it.status
        const prog = computeOnboardingProgress(data?.invite || {}, vmap, data?.invite?.target_role)
        setStep(prog.currentIndex)
      })
      .catch((e) => setFatal(e.message))
      .finally(() => setLoading(false))
  }, [token, reload])

  const has = (type: string, status = 'Success') => verified[type] === status

  if (loading) {
    return (
      <Centered>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
            className="h-10 w-10 rounded-full border-4 border-indigo-100 border-t-indigo-600"
          />
          <p className="text-gray-500">Loading your onboarding…</p>
        </motion.div>
      </Centered>
    )
  }
  if (fatal) {
    return (
      <Centered>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-md text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={springPop}
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-2xl"
          >
            !
          </motion.div>
          <h1 className="text-xl font-bold text-gray-800">Unable to continue</h1>
          <p className="mt-2 text-gray-500">{fatal}</p>
        </motion.div>
      </Centered>
    )
  }
  if (!invite) return null

  const stepProps: StepProps = {
    invite,
    documents,
    requiresUplineApproval,
    verified,
    verifiedNames,
    savedGstin,
    has,
    api,
    reload,
    busy,
    setBusy,
    err,
    setErr,
    next: () => {
      setErr('')
      setDirection(1)
      setStep((s) => Math.min(STEPS.length - 1, s + 1))
    },
    back: () => {
      setErr('')
      setDirection(-1)
      setStep((s) => Math.max(0, s - 1))
    },
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-indigo-600/10 to-transparent" />
      <div className="relative mx-auto max-w-2xl px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-5 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 text-sm font-black tracking-tight text-white shadow-lg shadow-indigo-600/30">
              SDS
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-tight text-gray-900 sm:text-xl">Same Day Solution</h1>
              <p className="text-xs font-medium text-gray-500">Partner Onboarding</p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
            {invite.target_role_label}
          </span>
        </motion.div>

        <Stepper current={step} />

        <motion.div
          layout
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="mt-5 overflow-hidden rounded-3xl bg-white/90 p-6 shadow-2xl shadow-indigo-900/5 ring-1 ring-gray-100 backdrop-blur sm:p-7"
        >
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              initial={{ opacity: 0, x: direction * 48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -48 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === 0 && <WelcomeStep {...stepProps} />}
              {step === 1 && <OtpStep {...stepProps} channel="SMS" title="Verify Mobile Number" destination={invite.phone} />}
              {step === 2 && <OtpStep {...stepProps} channel="EMAIL" title="Verify Email Address" destination={invite.email} />}
              {step === 3 && <AadhaarStep {...stepProps} />}
              {step === 4 && <PanStep {...stepProps} />}
              {step === 5 && <BusinessStep {...stepProps} />}
              {step === 6 && <BankStep {...stepProps} />}
              {step === 7 && <BiometricStep {...stepProps} />}
              {step === 8 && <DocumentsStep {...stepProps} />}
              {step === 9 && <DeclarationStep {...stepProps} />}
              {step === 10 && <FinishStep {...stepProps} />}
            </motion.div>
          </AnimatePresence>
        </motion.div>

        <div className="mt-5 flex flex-col items-center gap-1 text-center text-[11px] text-gray-400">
          <span className="flex items-center gap-1.5"><ShieldIcon className="h-3.5 w-3.5 text-emerald-500" /> Bank-grade encryption · Your data is secure</span>
          <span className="flex items-center gap-1.5"><HelpCircle className="h-3.5 w-3.5" /> Need help? support@samedaysolution.in</span>
        </div>
      </div>
    </div>
  )
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">{children}</div>
}

function Stepper({ current }: { current: number }) {
  const total = STEPS.length
  const percent = Math.round(((current + 1) / total) * 100)
  const Icon = STEP_ICONS[current] || Sparkles

  return (
    <div className="rounded-3xl bg-white/90 p-4 shadow-lg shadow-indigo-900/5 ring-1 ring-gray-100 backdrop-blur">
      {/* Current step headline */}
      <div className="flex items-center gap-3">
        <motion.div
          key={current}
          initial={{ scale: 0.6, rotate: -12, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={springPop}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/30"
        >
          <Icon className="h-5 w-5" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-bold text-gray-900">{STEPS[current]}</p>
            <span className="shrink-0 text-xs font-medium text-gray-400">
              Step {current + 1} of {total}
            </span>
          </div>
          {/* Segmented progress bar */}
          <div className="mt-2 flex gap-1">
            {STEPS.map((label, i) => (
              <div key={label} className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                <motion.div
                  className={`h-full rounded-full ${i < current ? 'bg-emerald-500' : 'bg-indigo-600'}`}
                  initial={false}
                  animate={{ width: i <= current ? '100%' : '0%' }}
                  transition={{ duration: 0.4, delay: i === current ? 0.1 : 0 }}
                />
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-indigo-600">{percent}% complete</p>
        </div>
      </div>
    </div>
  )
}

interface StepProps {
  invite: InviteData
  documents: DocSpec[]
  requiresUplineApproval: boolean
  verified: Record<string, string>
  verifiedNames: Record<string, string>
  savedGstin: string
  has: (type: string, status?: string) => boolean
  api: (path: string, options?: RequestInit) => Promise<any>
  reload: () => Promise<any>
  busy: boolean
  setBusy: (b: boolean) => void
  err: string
  setErr: (e: string) => void
  next: () => void
  back: () => void
}

function NavButtons({ onBack, onNext, nextLabel = 'Continue', nextDisabled, busy }: any) {
  return (
    <div className="mt-6 flex items-center justify-between">
      {onBack ? <GhostButton onClick={onBack}>Back</GhostButton> : <span />}
      {onNext && (
        <PrimaryButton onClick={onNext} disabled={nextDisabled} busy={busy}>
          {busy ? 'Please wait…' : nextLabel}
        </PrimaryButton>
      )}
    </div>
  )
}

// ── Steps ───────────────────────────────────────────────────────────────────

const listStagger = {
  hidden: { opacity: 0, x: -10 },
  show: (i: number) => ({ opacity: 1, x: 0, transition: { delay: 0.15 + i * 0.08 } }),
}

function WelcomeStep({ invite, requiresUplineApproval, next }: StepProps) {
  const features = [
    { icon: Smartphone, title: 'Verify contact', desc: 'Mobile & email OTP' },
    { icon: ShieldCheck, title: 'Complete KYC', desc: 'PAN, Aadhaar & bank' },
    { icon: Camera, title: 'Live capture', desc: 'Selfie & short video' },
    { icon: FileSignature, title: 'Sign & submit', desc: 'Documents & declaration' },
  ]
  return (
    <div>
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={springPop}
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 text-indigo-600"
      >
        <Sparkles className="h-7 w-7" />
      </motion.div>
      <h2 className="mt-4 text-center text-xl font-extrabold text-gray-900">
        Welcome{invite.name ? `, ${invite.name.split(' ')[0]}` : ''}!
      </h2>
      <p className="mt-2 text-center text-sm text-gray-600">
        <strong>{invite.invited_by_name || 'Your upline'}</strong> invited you to join as a{' '}
        <strong className="text-indigo-600">{invite.target_role_label}</strong>. It takes about 10 minutes — keep your
        PAN, Aadhaar-linked mobile and bank details handy.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {features.map((f, i) => (
          <motion.div
            key={f.title}
            custom={i}
            variants={listStagger}
            initial="hidden"
            animate="show"
            className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3 transition-colors hover:border-indigo-200 hover:bg-indigo-50/50"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm">
              <f.icon className="h-4 w-4" />
            </div>
            <p className="mt-2 text-sm font-semibold text-gray-800">{f.title}</p>
            <p className="text-xs text-gray-500">{f.desc}</p>
          </motion.div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
          <Clock className="h-3.5 w-3.5" /> ~10 minutes
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100">
          <ShieldIcon className="h-3.5 w-3.5" /> Bank-grade security
        </span>
        {requiresUplineApproval && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-100">
            <FileSignature className="h-3.5 w-3.5" /> Upline approval
          </span>
        )}
      </div>

      <NavButtons onNext={next} nextLabel="Get Started" />
    </div>
  )
}

// ── OTP input: 6 animated boxes, paste support, auto-submit ────────────────

function OtpInput({
  value,
  onChange,
  disabled,
  autoFocus = true,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  autoFocus?: boolean
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  const setDigits = (digits: string, focusIndex?: number) => {
    const clean = digits.replace(/\D/g, '').slice(0, 6)
    onChange(clean)
    const target = focusIndex !== undefined ? focusIndex : Math.min(clean.length, 5)
    requestAnimationFrame(() => refs.current[target]?.focus())
  }

  return (
    <div className="flex justify-center gap-2 sm:gap-3" onPaste={(e) => { e.preventDefault(); setDigits(e.clipboardData.getData('text')) }}>
      {Array.from({ length: 6 }).map((_, i) => {
        const digit = value[i] || ''
        return (
          <motion.input
            key={i}
            ref={(el) => { refs.current[i] = el }}
            value={digit}
            disabled={disabled}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            animate={digit ? { scale: [1, 1.15, 1], borderColor: '#4f46e5' } : { scale: 1 }}
            transition={{ duration: 0.18 }}
            whileFocus={{ scale: 1.08, boxShadow: '0 0 0 4px rgba(79,70,229,0.15)' }}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '')
              if (!raw) {
                setDigits(value.slice(0, i) + value.slice(i + 1), i)
                return
              }
              if (raw.length > 1) {
                // Multiple chars (paste / fast typing) — fill from this box.
                setDigits(value.slice(0, i) + raw)
                return
              }
              setDigits(value.slice(0, i) + raw + value.slice(i + 1))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !digit && i > 0) {
                e.preventDefault()
                setDigits(value.slice(0, i - 1), i - 1)
              }
              if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
              if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus()
            }}
            className="h-12 w-10 rounded-xl border-2 border-gray-200 bg-gray-50 text-center text-xl font-bold text-gray-900 outline-none transition-colors focus:border-indigo-500 focus:bg-white disabled:opacity-50 sm:h-14 sm:w-12"
          />
        )
      })}
    </div>
  )
}

function OtpStep({ api, reload, next, back, busy, setBusy, err, setErr, channel, title, destination, invite }: StepProps & { channel: 'SMS' | 'EMAIL'; title: string; destination: string }) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [mock, setMock] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [success, setSuccess] = useState(false)
  const verifyingRef = useRef(false)
  const alreadyVerified = channel === 'SMS' ? !!invite.phone_verified_at : !!invite.email_verified_at

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function send() {
    setErr('')
    setCode('')
    setBusy(true)
    try {
      const r = await api('/otp/send', { method: 'POST', body: JSON.stringify({ channel }) })
      if (r.alreadyVerified) {
        next()
        return
      }
      setSent(true)
      setMock(!!r.mock)
      setCooldown(30)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const verify = useCallback(
    async (fullCode: string) => {
      setErr('')
      setBusy(true)
      try {
        await api('/otp/verify', { method: 'POST', body: JSON.stringify({ channel, code: fullCode }) })
        setSuccess(true)
        await reload()
        // Brief success beat before sliding to the next step.
        setTimeout(() => next(), 700)
      } catch (e: any) {
        setErr(e.message)
        setCode('')
      } finally {
        setBusy(false)
      }
    },
    [api, channel, next, reload, setBusy, setErr]
  )

  // Auto-submit the moment the 6th digit lands.
  useEffect(() => {
    if (sent && code.length === 6 && !verifyingRef.current && !success) {
      verifyingRef.current = true
      verify(code).finally(() => {
        verifyingRef.current = false
      })
    }
  }, [code, sent, success, verify])

  const Icon = channel === 'SMS' ? Smartphone : Mail

  return (
    <div>
      <div className="flex items-center gap-3">
        <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={springPop} className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
          <Icon className="h-5 w-5" />
        </motion.div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500">We&apos;ll send a code to {destination}</p>
        </div>
      </div>
      <GuidanceNote>
        {channel === 'SMS'
          ? 'Enter the 6-digit OTP sent to this mobile number. Make sure the number is active and reachable.'
          : 'Enter the 6-digit code sent to this email. Check your spam/promotions folder if you don’t see it.'}
      </GuidanceNote>
      <ErrorBanner err={err} />

      {alreadyVerified || success ? (
        <SuccessNote>{success ? 'Verified! Taking you to the next step…' : 'Already verified'}</SuccessNote>
      ) : !sent ? (
        <div className="mt-6 flex justify-center">
          <PrimaryButton onClick={send} busy={busy} className="px-10 py-3 text-base">
            {busy ? 'Sending…' : 'Send Code'}
          </PrimaryButton>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
          <AnimatePresence>
            {mock && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-lg bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-700 ring-1 ring-amber-200"
              >
                Test mode — use code 123456
              </motion.p>
            )}
          </AnimatePresence>
          <OtpInput value={code} onChange={setCode} disabled={busy} />
          <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
            {busy ? (
              <span className="flex items-center gap-1.5 text-indigo-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying…</span>
            ) : cooldown > 0 ? (
              <span>Resend code in {cooldown}s</span>
            ) : (
              <motion.button whileTap={{ scale: 0.94 }} onClick={send} className="font-medium text-indigo-600 hover:underline">
                Resend code
              </motion.button>
            )}
          </div>
          <p className="text-center text-[11px] text-gray-400">The code verifies automatically when all 6 digits are entered.</p>
        </motion.div>
      )}

      <NavButtons
        onBack={back}
        onNext={alreadyVerified ? next : undefined}
        nextLabel="Continue"
        busy={busy && !sent}
      />
    </div>
  )
}

function AadhaarStep({ api, reload, next, back, has, busy, setBusy, err, setErr }: StepProps) {
  const done = has('AADHAAR_DIGILOCKER')
  const [editing, setEditing] = useState(false)
  const showDone = done && !editing

  useEffect(() => {
    // Resume DigiLocker after redirect back.
    const pending = typeof window !== 'undefined' ? localStorage.getItem(DIGILOCKER_STORAGE_KEY) : null
    if (pending && !done) {
      try {
        const { verification_id, reference_id } = JSON.parse(pending)
        setBusy(true)
        api('/verify', { method: 'POST', body: JSON.stringify({ type: 'AADHAAR_COMPLETE', verification_id, reference_id }) })
          .then(() => reload())
          .catch((e) => setErr(e.message))
          .finally(() => {
            localStorage.removeItem(DIGILOCKER_STORAGE_KEY)
            setBusy(false)
          })
      } catch {
        localStorage.removeItem(DIGILOCKER_STORAGE_KEY)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startDigilocker() {
    setErr('')
    setBusy(true)
    try {
      const token = new URLSearchParams(window.location.search).get('token') || ''
      // eKYC Hub's firewall rejects redirect URLs with query strings, so the
      // token travels via localStorage instead and is restored on return.
      const redirect = `${window.location.origin}/onboard`
      const r = await api('/verify', { method: 'POST', body: JSON.stringify({ type: 'AADHAAR_INIT', redirect_url: redirect }) })
      if (!r.url) throw new Error(r.error || 'Could not start DigiLocker verification')
      localStorage.setItem(DIGILOCKER_STORAGE_KEY, JSON.stringify({ verification_id: r.verification_id, reference_id: r.reference_id, token }))
      window.location.href = r.url
    } catch (e: any) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={springPop} className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
          <ShieldCheck className="h-5 w-5" />
        </motion.div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Aadhaar Verification</h2>
          <p className="text-sm text-gray-500">Verify your Aadhaar securely via DigiLocker.</p>
        </div>
      </div>
      <GuidanceNote>Use your own Aadhaar. The name on your Aadhaar must match the name on your PAN.</GuidanceNote>
      <ErrorBanner err={err} />
      {showDone ? (
        <div>
          <SuccessNote>Aadhaar verified</SuccessNote>
          <div className="mt-2 flex justify-center">
            <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline">
              <RefreshCw className="h-3.5 w-3.5" /> Re-verify Aadhaar
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex justify-center">
          <PrimaryButton onClick={startDigilocker} busy={busy} className="px-8 py-3 text-base">
            <Lock className="h-4 w-4" />
            {busy ? 'Please wait…' : 'Verify via DigiLocker'}
          </PrimaryButton>
        </div>
      )}
      <NavButtons onBack={back} onNext={next} nextDisabled={!done} busy={busy} />
    </div>
  )
}

function PanStep({ api, reload, next, back, has, verifiedNames, busy, setBusy, err, setErr }: StepProps) {
  const [pan, setPan] = useState('')
  const [name, setName] = useState(verifiedNames['PAN_360'] || '')
  const [editing, setEditing] = useState(false)
  const done = has('PAN_360')
  const showDone = done && !editing

  async function verify() {
    setErr('')
    setBusy(true)
    try {
      const r = await api('/verify', { method: 'POST', body: JSON.stringify({ type: 'PAN_360', pan }) })
      if (!r.success) throw new Error(r.error || 'PAN verification failed')
      setName(r.data?.registered_name || '')
      setEditing(false)
      await reload()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StepHeader icon={CreditCard} title="PAN Verification" subtitle="Enter your 10-character PAN to verify instantly." />
      <GuidanceNote>Enter your own PAN. The name on your PAN must match the name on your Aadhaar.</GuidanceNote>
      <ErrorBanner err={err} />
      {showDone ? (
        <div>
          <VerifiedCard label="PAN verified" name={name} />
          <div className="mt-2">
            <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline">
              <RefreshCw className="h-3.5 w-3.5" /> Change PAN
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <Field
            label="PAN Number"
            value={pan}
            onChange={(v) => setPan(v.toUpperCase().slice(0, 10))}
            placeholder="ABCDE1234F"
            icon={CreditCard}
            mono
            autoCapitalize
            maxLength={10}
            hint="Format: 5 letters, 4 digits, 1 letter"
          />
          <PrimaryButton onClick={verify} disabled={pan.length !== 10} busy={busy} className="w-full py-3">
            {busy ? 'Verifying…' : 'Verify PAN'}
          </PrimaryButton>
        </div>
      )}
      <NavButtons onBack={back} onNext={next} nextDisabled={!done} busy={busy} />
    </div>
  )
}

function BankStep({ api, reload, next, back, has, verifiedNames, busy, setBusy, err, setErr }: StepProps) {
  const [acc, setAcc] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [name, setName] = useState(verifiedNames['BANK_PENNY_DROP'] || '')
  const [editing, setEditing] = useState(false)
  const done = has('BANK_PENNY_DROP')
  const showDone = done && !editing

  async function verify() {
    setErr('')
    setBusy(true)
    try {
      const r = await api('/verify', { method: 'POST', body: JSON.stringify({ type: 'BANK_PENNY_DROP', account_number: acc, ifsc }) })
      if (!r.success) throw new Error(r.error || 'Bank verification failed')
      setName(r.data?.nameAtBank || '')
      setEditing(false)
      await reload()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StepHeader icon={Landmark} title="Bank Account Verification" subtitle="We send ₹1 (penny drop) to confirm your account name." />
      <GuidanceNote>The account holder name should match your Aadhaar/PAN name (or your GST business name). Use your own active bank account.</GuidanceNote>
      <ErrorBanner err={err} />
      {showDone ? (
        <div>
          <VerifiedCard label="Bank verified" name={name} />
          <div className="mt-2">
            <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline">
              <RefreshCw className="h-3.5 w-3.5" /> Change bank account
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <Field
            label="Account Number"
            value={acc}
            onChange={(v) => setAcc(v.replace(/\D/g, ''))}
            placeholder="000000000000"
            icon={Landmark}
            inputMode="numeric"
            mono
          />
          <Field
            label="IFSC Code"
            value={ifsc}
            onChange={(v) => setIfsc(v.toUpperCase())}
            placeholder="HDFC0001234"
            icon={CreditCard}
            autoCapitalize
            mono
            maxLength={11}
          />
          <PrimaryButton onClick={verify} disabled={!acc || !ifsc} busy={busy} className="w-full py-3">
            {busy ? 'Verifying…' : 'Verify Account'}
          </PrimaryButton>
        </div>
      )}
      <NavButtons onBack={back} onNext={next} nextDisabled={!done} busy={busy} />
    </div>
  )
}

function BusinessStep({ api, reload, next, back, has, busy, setBusy, err, setErr, verifiedNames, savedGstin }: StepProps) {
  const [shopName, setShopName] = useState(verifiedNames['BUSINESS_NAME'] || '')
  const [gst, setGst] = useState(savedGstin || '')
  const [gstVerified, setGstVerified] = useState(has('GST'))
  const [gstName, setGstName] = useState(verifiedNames['GST'] || '')
  const [gstBusy, setGstBusy] = useState(false)
  const [gstErr, setGstErr] = useState('')
  const saved = has('BUSINESS_NAME')

  // Rehydrate from saved data once the initial reload resolves (refresh/resume).
  useEffect(() => {
    if (verifiedNames['BUSINESS_NAME']) setShopName((s) => s || verifiedNames['BUSINESS_NAME'])
    if (verifiedNames['GST']) setGstName((n) => n || verifiedNames['GST'])
    if (has('GST')) setGstVerified(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifiedNames])

  useEffect(() => {
    if (savedGstin) setGst((g) => g || savedGstin)
  }, [savedGstin])

  async function verifyGst() {
    setGstErr('')
    setGstBusy(true)
    try {
      const r = await api('/verify', { method: 'POST', body: JSON.stringify({ type: 'GST', gst }) })
      if (!r.success) throw new Error(r.error || 'GST verification failed')
      const legal = r.data?.legal_name || r.data?.trade_name || ''
      setGstVerified(true)
      setGstName(legal)
      if (legal) setShopName(legal)
      await reload()
    } catch (e: any) {
      setGstVerified(false)
      setGstErr(e.message)
    } finally {
      setGstBusy(false)
    }
  }

  async function saveBusiness() {
    setErr('')
    setBusy(true)
    try {
      await api('/business', { method: 'POST', body: JSON.stringify({ shopName }) })
      await reload()
      next()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StepHeader icon={Store} title="Business Details" subtitle="Verify your GST to auto-fill the name, or enter it manually. GST is optional." />
      <GuidanceNote>Enter your shop/business name as you want it on record. If you have GST, verify it to auto-fill the legal business name — it should match your bank/KYC name.</GuidanceNote>
      <ErrorBanner err={err} />
      <div className="mt-5 space-y-4">
        <div>
          <span className="mb-1.5 flex items-center gap-1 text-sm font-medium text-gray-700">
            GSTIN <span className="text-xs font-normal text-gray-400">(optional)</span>
          </span>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <FileText className="h-4 w-4" />
              </span>
              <input
                value={gst}
                onChange={(e) => {
                  setGst(e.target.value.toUpperCase().slice(0, 15))
                  setGstVerified(false)
                  setGstErr('')
                }}
                placeholder="22ABCDE1234F1Z5"
                maxLength={15}
                disabled={gstVerified}
                className={`w-full rounded-xl border-2 py-2.5 pl-9 pr-3 font-mono uppercase tracking-wider text-gray-900 transition-all placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 ${
                  gstVerified ? 'border-green-300 bg-green-50/60' : 'border-gray-200 bg-gray-50/60 focus:border-indigo-500 focus:bg-white'
                }`}
              />
            </div>
            {gstVerified ? (
              <button
                type="button"
                onClick={() => {
                  setGstVerified(false)
                  setGstName('')
                }}
                className="shrink-0 rounded-xl border-2 border-gray-200 px-4 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100"
              >
                Change
              </button>
            ) : (
              <PrimaryButton onClick={verifyGst} disabled={gst.length !== 15} busy={gstBusy} className="shrink-0 px-5">
                {gstBusy ? '' : 'Verify'}
              </PrimaryButton>
            )}
          </div>
          {gstErr && <span className="mt-1 block text-xs text-red-500">{gstErr}</span>}
          {gstVerified && <SuccessNote>GST verified{gstName ? ` — ${gstName}` : ''}</SuccessNote>}
          {!gstVerified && !gstErr && <span className="mt-1 block text-xs text-gray-400">Verify GST to auto-fill your business name.</span>}
        </div>

        <Field
          label="Shop / Business Name"
          value={shopName}
          onChange={setShopName}
          placeholder="e.g. Sharma Digital Services"
          icon={Store}
          required
          hint={gstVerified ? 'Auto-filled from GST — edit if needed.' : undefined}
        />
      </div>
      {gst.trim().length > 0 && !gstVerified && (
        <p className="mt-2 text-xs text-amber-600">Verify the GSTIN you entered, or clear it, to continue.</p>
      )}
      <NavButtons
        onBack={back}
        onNext={saveBusiness}
        nextDisabled={(shopName.trim().length < 2 && !saved) || (gst.trim().length > 0 && !gstVerified)}
        busy={busy}
      />
    </div>
  )
}

function BiometricStep({ api, reload, next, back, has, setErr, err }: StepProps) {
  const [redoVideo, setRedoVideo] = useState(false)
  const selfieDone = has('DOCUMENT_SELFIE', 'Uploaded')
  const videoDone = has('ONBOARD_VIDEO', 'Uploaded') && !redoVideo
  const [videoCfg, setVideoCfg] = useState<{ prompt: string; maxDurationSec: number; mode: string; uploadUrl?: string; key?: string; uploadToken: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  async function handleSelfie(dataUrl: string) {
    setErr('')
    try {
      const presign = await api('/selfie/presign', { method: 'POST', body: JSON.stringify({ contentType: 'image/jpeg' }) })
      let stored = false
      // Try direct-to-S3 first; if the browser PUT is blocked (CORS/CSP) fall
      // back to posting the image through our own origin (Supabase storage).
      if (presign.mode === 's3' && presign.uploadUrl) {
        try {
          const blob = await (await fetch(dataUrl)).blob()
          const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
          if (!put.ok) throw new Error(`S3 upload failed (${put.status})`)
          await api('/selfie/complete', { method: 'POST', body: JSON.stringify({ key: presign.key, uploadToken: presign.uploadToken }) })
          stored = true
        } catch {
          stored = false
        }
      }
      if (!stored) {
        await api('/selfie/complete', { method: 'POST', body: JSON.stringify({ dataUrl }) })
      }
      await reload()
    } catch (e: any) {
      setErr(e.message || 'Could not save selfie. Please retake.')
    }
  }

  async function initVideo() {
    setErr('')
    try {
      const cfg = await api('/video/initiate', { method: 'POST', body: JSON.stringify({ consent: true, contentType: 'video/webm' }) })
      setVideoCfg(cfg)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function handleVideo(dataUrl: string, durationSec: number) {
    if (!videoCfg) return
    setUploading(true)
    setErr('')
    try {
      let stored = false
      // Try direct-to-S3 first; if the browser PUT is blocked (CORS/CSP) fall
      // back to posting the clip through our own origin (Supabase storage).
      if (videoCfg.mode === 's3' && videoCfg.uploadUrl) {
        try {
          const blob = await (await fetch(dataUrl)).blob()
          const put = await fetch(videoCfg.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/webm' }, body: blob })
          if (!put.ok) throw new Error(`S3 upload failed (${put.status})`)
          await api('/video/complete', { method: 'POST', body: JSON.stringify({ key: videoCfg.key, uploadToken: videoCfg.uploadToken, durationSec }) })
          stored = true
        } catch {
          stored = false
        }
      }
      if (!stored) {
        await api('/video/complete', { method: 'POST', body: JSON.stringify({ dataUrl, uploadToken: videoCfg.uploadToken, durationSec }) })
      }
      await reload()
      setRedoVideo(false)
      setVideoCfg(null)
    } catch (e: any) {
      setErr(e.message || 'Could not save video. Please re-record.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <StepHeader icon={Camera} title="Live Selfie & Video" subtitle="A quick liveness check to confirm it’s really you." />
      <GuidanceNote>Face clearly visible in good lighting, no cap or sunglasses. For the video, look at the camera and read the number aloud.</GuidanceNote>
      <ErrorBanner err={err} />

      <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${selfieDone ? 'bg-green-500 text-white' : 'bg-indigo-600 text-white'}`}>
            {selfieDone ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : '1'}
          </span>
          <h3 className="text-sm font-semibold text-gray-800">Live Selfie</h3>
        </div>
        <SelfieCapture onCapture={handleSelfie} captured={selfieDone} />
      </div>

      <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${videoDone ? 'bg-green-500 text-white' : 'bg-indigo-600 text-white'}`}>
            {videoDone ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : '2'}
          </span>
          <h3 className="text-sm font-semibold text-gray-800">Liveness Video</h3>
        </div>
        {videoDone ? (
          <div>
            <SuccessNote>Liveness video recorded</SuccessNote>
            <button
              type="button"
              onClick={() => { setRedoVideo(true); initVideo() }}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Re-record video
            </button>
          </div>
        ) : !videoCfg ? (
          <PrimaryButton onClick={initVideo} className="w-full py-3">Start Liveness Check</PrimaryButton>
        ) : (
          <LivenessVideoCapture prompt={videoCfg.prompt} maxDurationSec={videoCfg.maxDurationSec} onRecorded={handleVideo} recorded={uploading} />
        )}
      </div>

      <NavButtons onBack={back} onNext={next} nextDisabled={!selfieDone || !videoDone} />
    </div>
  )
}

function DocumentsStep({ documents, api, reload, next, back, has, err, setErr }: StepProps) {
  const uploadDoc = async (type: string, dataUrl: string, coords?: { lat: number; lng: number; acc?: number }) => {
    setErr('')
    await api('/documents', { method: 'POST', body: JSON.stringify({ type, dataUrl, lat: coords?.lat, lng: coords?.lng, acc: coords?.acc }) })
    await reload()
  }
  // PG_FORM is collected on the Declaration & Agreement step instead.
  const docs = documents.filter((d) => d.type !== 'PG_FORM')
  const required = docs.filter((d) => d.required)
  const optional = docs.filter((d) => !d.required)
  const allRequiredDone = required.every((d) => has(`DOCUMENT_${d.type}`, 'Uploaded'))

  return (
    <div>
      <StepHeader icon={FileText} title="Upload Documents" subtitle="Clear photos or PDFs. Shop photos are captured live with your location." />
      <GuidanceNote>Upload clear, readable files. Shop photos/selfie are taken live and tagged with your GPS location. Tap “Replace” or “Retake” to change any item.</GuidanceNote>
      <ErrorBanner err={err} />
      <div className="mt-5 space-y-2">
        {required.map((d, i) => (
          <motion.div key={d.type} custom={i} variants={listStagger} initial="hidden" animate="show">
            {d.hasTemplate && (
              <a href={getApiUrl(`/api/onboard/${encodeURIComponent(new URLSearchParams(window.location.search).get('token') || '')}/pg-form/download`)} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
                <FileText className="h-3.5 w-3.5" /> Download {d.label} (prefilled — sign &amp; upload)
              </a>
            )}
            {d.gps ? (
              <GpsPhotoCapture
                label={d.label}
                required
                facing={d.type.includes('SELFIE') ? 'user' : 'environment'}
                uploaded={has(`DOCUMENT_${d.type}`, 'Uploaded')}
                hint={d.hint}
                onUpload={(dataUrl, coords) => uploadDoc(d.type, dataUrl, coords)}
              />
            ) : (
              <DocumentUploadField label={d.label} required uploaded={has(`DOCUMENT_${d.type}`, 'Uploaded')} hint={d.hint} onUpload={(dataUrl, coords) => uploadDoc(d.type, dataUrl, coords)} />
            )}
          </motion.div>
        ))}
      </div>
      {optional.length > 0 && (
        <>
          <p className="mt-4 text-xs font-semibold uppercase text-gray-400">Optional</p>
          <div className="mt-2 space-y-2">
            {optional.map((d) => (
              <DocumentUploadField key={d.type} label={d.label} gps={d.gps} uploaded={has(`DOCUMENT_${d.type}`, 'Uploaded')} hint={d.hint} onUpload={(dataUrl, coords) => uploadDoc(d.type, dataUrl, coords)} />
            ))}
          </div>
        </>
      )}
      <NavButtons onBack={back} onNext={next} nextDisabled={!allRequiredDone} />
    </div>
  )
}

function DeclarationStep({ documents, api, reload, next, back, has, requiresUplineApproval, busy, setBusy, err, setErr }: StepProps) {
  const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') || '' : ''
  const declUploaded = has('SELF_DECLARATION', 'Uploaded')
  const pgSpec = documents.find((d) => d.type === 'PG_FORM')
  const pgUploaded = has('DOCUMENT_PG_FORM', 'Uploaded')
  const [approval, setApproval] = useState<{ status: string } | null>(null)
  const [agreed, setAgreed] = useState(false)
  const pollRef = useRef<any>(null)

  const uploadDeclaration = async (dataUrl: string) => {
    setErr('')
    await api('/documents', { method: 'POST', body: JSON.stringify({ type: 'SELF_DECLARATION', dataUrl }) })
    await reload()
  }

  const uploadPgForm = async (dataUrl: string) => {
    setErr('')
    await api('/documents', { method: 'POST', body: JSON.stringify({ type: 'PG_FORM', dataUrl }) })
    await reload()
  }

  const checkStatus = useCallback(async () => {
    if (!requiresUplineApproval) return
    try {
      const r = await api('/declaration/status', { method: 'GET' })
      setApproval(r.approval)
    } catch {}
  }, [api, requiresUplineApproval])

  useEffect(() => {
    checkStatus()
    if (requiresUplineApproval) {
      pollRef.current = setInterval(checkStatus, 10000)
      return () => clearInterval(pollRef.current)
    }
  }, [checkStatus, requiresUplineApproval])

  async function sendForApproval() {
    setBusy(true)
    setErr('')
    try {
      const r = await api('/declaration/send', { method: 'POST' })
      setApproval(r.approval || { status: 'pending' })
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function acceptAgreement() {
    await api('/agreement', { method: 'POST', body: JSON.stringify({ accepted: true }) }).catch(() => {})
    setAgreed(true)
  }

  const approvalOk = !requiresUplineApproval || approval?.status === 'approved'
  const pgOk = !pgSpec || pgUploaded
  const canProceed = declUploaded && pgOk && approvalOk && agreed

  return (
    <div>
      <StepHeader icon={FileSignature} title="Declaration & Agreement" subtitle="Final step — sign, upload, and accept the terms." />
      <ErrorBanner err={err} />
      <div className="mt-5 space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
          <a href={getApiUrl(`/api/onboard/${encodeURIComponent(token)}/declaration/download`)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:underline">
            <FileText className="h-4 w-4" /> Download self-declaration
          </a>
          <p className="mt-0.5 text-xs text-gray-400">Sign it physically, then upload below.</p>
          <div className="mt-3">
            <DocumentUploadField label="Signed Self-Declaration" required uploaded={declUploaded} onUpload={(dataUrl) => uploadDeclaration(dataUrl)} />
          </div>
        </div>

        {pgSpec && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
            <a href={getApiUrl(`/api/onboard/${encodeURIComponent(token)}/pg-form/download`)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:underline">
              <FileText className="h-4 w-4" /> Download {pgSpec.label} (prefilled — sign &amp; upload)
            </a>
            <p className="mt-0.5 text-xs text-gray-400">{pgSpec.hint || 'Download the prefilled form, sign it, then upload the signed copy.'}</p>
            <div className="mt-3">
              <DocumentUploadField label={pgSpec.label} required uploaded={pgUploaded} onUpload={(dataUrl) => uploadPgForm(dataUrl)} />
            </div>
          </div>
        )}

        {requiresUplineApproval && (
          <div className="rounded-xl border border-gray-200 p-3">
            <p className="text-sm font-medium text-gray-700">2. Upline Approval</p>
            {!approval ? (
              <PrimaryButton onClick={sendForApproval} disabled={!declUploaded} busy={busy} className="mt-2 px-4 py-2">
                Send for Approval
              </PrimaryButton>
            ) : approval.status === 'approved' ? (
              <SuccessNote>Approved by your upline</SuccessNote>
            ) : approval.status === 'rejected' ? (
              <p className="mt-1 text-sm font-medium text-red-600">Rejected by your upline. Contact them.</p>
            ) : (
              <p className="mt-1 flex items-center gap-2 text-sm text-amber-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for upline approval…
              </p>
            )}
          </div>
        )}

        <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm transition-colors ${agreed ? 'border-indigo-300 bg-indigo-50/60 text-gray-800' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-200'}`}>
          <input type="checkbox" checked={agreed} onChange={(e) => (e.target.checked ? acceptAgreement() : setAgreed(false))} className="mt-0.5 h-4 w-4 accent-indigo-600" />
          <span>I accept the <span className="font-medium text-indigo-600">partner agreement</span>, terms of service and privacy policy.</span>
        </label>
      </div>
      <NavButtons onBack={back} onNext={next} nextDisabled={!canProceed} busy={busy} />
    </div>
  )
}

// ── Finish: registration + celebratory confetti ─────────────────────────────

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }).map((_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 320,
        delay: Math.random() * 0.35,
        rotate: Math.random() * 540 - 270,
        color: ['#4f46e5', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4'][i % 5],
        size: 6 + Math.random() * 6,
      })),
    []
  )
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center overflow-visible">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          initial={{ opacity: 1, x: 0, y: -10, rotate: 0 }}
          animate={{ opacity: [1, 1, 0], x: p.x, y: 260 + Math.random() * 80, rotate: p.rotate }}
          transition={{ duration: 1.6 + Math.random() * 0.6, delay: p.delay, ease: 'easeOut' }}
          style={{ width: p.size, height: p.size * 0.45, backgroundColor: p.color, borderRadius: 2, position: 'absolute' }}
        />
      ))}
    </div>
  )
}

function FinishStep({ api, invite, busy, setBusy, err, setErr }: StepProps) {
  const [form, setForm] = useState({
    name: invite.name || '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    password: '',
    confirm: '',
  })
  const [done, setDone] = useState<{ partner_id: string; message: string } | null>(null)

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    setErr('')
    if (form.password !== form.confirm) {
      setErr('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      const r = await api('/register', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          address: form.address,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
          password: form.password,
        }),
      })
      setDone({ partner_id: r.partner_id, message: r.message })
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="relative py-4 text-center">
        <Confetti />
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 16 }}
          className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-emerald-600 text-white shadow-lg shadow-green-500/30"
        >
          <Check className="h-10 w-10" strokeWidth={3} />
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="flex items-center justify-center gap-2 text-xl font-bold text-gray-900">
          Registration Submitted! <PartyPopper className="h-5 w-5 text-amber-500" />
        </motion.h2>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="mt-2 text-sm text-gray-600">
          {done.message}
        </motion.p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-1 text-xs text-gray-400">
          Your partner ID: {done.partner_id}
        </motion.p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900">Personal Details &amp; Password</h2>
      <ErrorBanner err={err} />
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name *" className="rounded-xl border-2 border-gray-200 px-3 py-2 transition-colors focus:border-indigo-500 focus:outline-none sm:col-span-2" />
        <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Address" className="rounded-xl border-2 border-gray-200 px-3 py-2 transition-colors focus:border-indigo-500 focus:outline-none sm:col-span-2" />
        <input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="City" className="rounded-xl border-2 border-gray-200 px-3 py-2 transition-colors focus:border-indigo-500 focus:outline-none" />
        <input value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="State" className="rounded-xl border-2 border-gray-200 px-3 py-2 transition-colors focus:border-indigo-500 focus:outline-none" />
        <input value={form.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Pincode" className="rounded-xl border-2 border-gray-200 px-3 py-2 transition-colors focus:border-indigo-500 focus:outline-none" />
        <div />
        <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Password *" className="rounded-xl border-2 border-gray-200 px-3 py-2 transition-colors focus:border-indigo-500 focus:outline-none" />
        <input type="password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} placeholder="Confirm password *" className="rounded-xl border-2 border-gray-200 px-3 py-2 transition-colors focus:border-indigo-500 focus:outline-none" />
      </div>
      <p className="mt-1 text-xs text-gray-400">8-20 chars, with a letter, number and special character.</p>
      <NavButtons onNext={submit} nextLabel="Submit Registration" nextDisabled={!form.name || !form.password} busy={busy} />
    </div>
  )
}

export default function OnboardPage() {
  return (
    <Suspense fallback={<Centered><p className="text-gray-500">Loading…</p></Centered>}>
      <OnboardWizard />
    </Suspense>
  )
}
