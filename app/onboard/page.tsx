'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import SelfieCapture from '@/components/onboarding/SelfieCapture'
import LivenessVideoCapture from '@/components/onboarding/LivenessVideoCapture'
import DocumentUploadField from '@/components/onboarding/DocumentUploadField'
import { getApiUrl } from '@/lib/api-client'

interface DocSpec {
  type: string
  label: string
  required: boolean
  gps?: boolean
  hasTemplate?: boolean
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
  'Bank',
  'Business',
  'Selfie & Video',
  'Documents',
  'Declaration',
  'Finish',
]

function OnboardWizard() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''

  const [loading, setLoading] = useState(true)
  const [fatal, setFatal] = useState('')
  const [invite, setInvite] = useState<InviteData | null>(null)
  const [documents, setDocuments] = useState<DocSpec[]>([])
  const [requiresUplineApproval, setRequiresUplineApproval] = useState(false)
  const [verified, setVerified] = useState<Record<string, string>>({})
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

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
    for (const item of data.verifications || []) v[item.type] = item.status
    setVerified(v)
    return data
  }, [api])

  useEffect(() => {
    if (!token) {
      setFatal('Missing onboarding token. Please use the link from your invitation.')
      setLoading(false)
      return
    }
    reload()
      .catch((e) => setFatal(e.message))
      .finally(() => setLoading(false))
  }, [token, reload])

  const has = (type: string, status = 'Success') => verified[type] === status

  if (loading) {
    return <Centered><p className="text-gray-500">Loading your onboarding…</p></Centered>
  }
  if (fatal) {
    return (
      <Centered>
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-2xl">!</div>
          <h1 className="text-xl font-bold text-gray-800">Unable to continue</h1>
          <p className="mt-2 text-gray-500">{fatal}</p>
        </div>
      </Centered>
    )
  }
  if (!invite) return null

  const stepProps = {
    invite,
    documents,
    requiresUplineApproval,
    verified,
    has,
    api,
    reload,
    busy,
    setBusy,
    err,
    setErr,
    next: () => {
      setErr('')
      setStep((s) => Math.min(STEPS.length - 1, s + 1))
    },
    back: () => {
      setErr('')
      setStep((s) => Math.max(0, s - 1))
    },
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Same Day Solution Onboarding</h1>
          <p className="text-sm text-gray-500">
            Joining as <span className="font-semibold text-indigo-600">{invite.target_role_label}</span>
          </p>
        </div>

        <Stepper current={step} />

        <div className="mt-6 rounded-2xl bg-white p-6 shadow-xl ring-1 ring-gray-100">
          {step === 0 && <WelcomeStep {...stepProps} />}
          {step === 1 && <OtpStep {...stepProps} channel="SMS" title="Verify Mobile Number" destination={invite.phone} />}
          {step === 2 && <OtpStep {...stepProps} channel="EMAIL" title="Verify Email Address" destination={invite.email} />}
          {step === 3 && <AadhaarStep {...stepProps} />}
          {step === 4 && <PanStep {...stepProps} />}
          {step === 5 && <BankStep {...stepProps} />}
          {step === 6 && <BusinessStep {...stepProps} />}
          {step === 7 && <BiometricStep {...stepProps} />}
          {step === 8 && <DocumentsStep {...stepProps} />}
          {step === 9 && <DeclarationStep {...stepProps} />}
          {step === 10 && <FinishStep {...stepProps} />}
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
  return (
    <div className="flex items-center justify-between overflow-x-auto rounded-xl bg-white/70 p-2 text-[10px]">
      {STEPS.map((label, i) => (
        <div key={label} className="flex flex-1 flex-col items-center px-1">
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              i < current ? 'bg-green-500 text-white' : i === current ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}
          >
            {i < current ? '✓' : i + 1}
          </div>
          <span className={`mt-1 truncate ${i === current ? 'font-semibold text-indigo-600' : 'text-gray-400'}`}>{label}</span>
        </div>
      ))}
    </div>
  )
}

interface StepProps {
  invite: InviteData
  documents: DocSpec[]
  requiresUplineApproval: boolean
  verified: Record<string, string>
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

function ErrorBanner({ err }: { err: string }) {
  if (!err) return null
  return <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
}

function NavButtons({ onBack, onNext, nextLabel = 'Continue', nextDisabled, busy }: any) {
  return (
    <div className="mt-6 flex justify-between">
      {onBack ? (
        <button onClick={onBack} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-800">
          Back
        </button>
      ) : (
        <span />
      )}
      <button
        onClick={onNext}
        disabled={nextDisabled || busy}
        className={`rounded-lg px-6 py-2 text-sm font-semibold text-white ${
          nextDisabled || busy ? 'bg-gray-300' : 'bg-indigo-600 hover:bg-indigo-700'
        }`}
      >
        {busy ? 'Please wait…' : nextLabel}
      </button>
    </div>
  )
}

// ── Steps ───────────────────────────────────────────────────────────────────

function WelcomeStep({ invite, requiresUplineApproval, next }: StepProps) {
  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900">Welcome{invite.name ? `, ${invite.name}` : ''}!</h2>
      <p className="mt-2 text-sm text-gray-600">
        You&apos;ve been invited by <strong>{invite.invited_by_name || 'your upline'}</strong> to onboard as a{' '}
        <strong>{invite.target_role_label}</strong>. This takes about 10 minutes. Keep your PAN, Aadhaar-linked mobile,
        and bank details ready.
      </p>
      <ul className="mt-4 space-y-1 text-sm text-gray-500">
        <li>• Verify mobile &amp; email</li>
        <li>• Complete PAN, Aadhaar &amp; bank KYC</li>
        <li>• Capture a live selfie &amp; short video</li>
        <li>• Upload documents &amp; sign the declaration</li>
        {requiresUplineApproval && <li>• Your upline approves your declaration</li>}
      </ul>
      <NavButtons onNext={next} nextLabel="Get Started" />
    </div>
  )
}

function OtpStep({ api, reload, next, busy, setBusy, err, setErr, channel, title, destination, invite }: StepProps & { channel: 'SMS' | 'EMAIL'; title: string; destination: string }) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [mock, setMock] = useState(false)
  const alreadyVerified = channel === 'SMS' ? !!invite.phone_verified_at : !!invite.email_verified_at

  async function send() {
    setErr('')
    setBusy(true)
    try {
      const r = await api('/otp/send', { method: 'POST', body: JSON.stringify({ channel }) })
      if (r.alreadyVerified) {
        next()
        return
      }
      setSent(true)
      setMock(!!r.mock)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setErr('')
    setBusy(true)
    try {
      await api('/otp/verify', { method: 'POST', body: JSON.stringify({ channel, code }) })
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
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">We&apos;ll send a code to {destination}</p>
      <ErrorBanner err={err} />
      {alreadyVerified ? (
        <div className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Already verified</div>
      ) : !sent ? (
        <button onClick={send} disabled={busy} className="mt-4 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300">
          {busy ? 'Sending…' : 'Send Code'}
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          {mock && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">Test mode — use code 123456</p>}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Enter 6-digit code"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-lg tracking-widest focus:border-indigo-500 focus:outline-none"
          />
          <button onClick={send} className="text-xs text-indigo-600 hover:underline">Resend code</button>
        </div>
      )}
      <NavButtons
        onNext={alreadyVerified ? next : sent ? verify : send}
        nextLabel={alreadyVerified ? 'Continue' : sent ? 'Verify' : 'Send Code'}
        nextDisabled={sent && !alreadyVerified && code.length !== 6}
        busy={busy}
      />
    </div>
  )
}

function AadhaarStep({ api, reload, next, back, has, busy, setBusy, err, setErr }: StepProps) {
  const done = has('AADHAAR_DIGILOCKER')

  useEffect(() => {
    // Resume DigiLocker after redirect back.
    const pending = typeof window !== 'undefined' ? localStorage.getItem('onboard_digilocker') : null
    if (pending && !done) {
      try {
        const { verification_id, reference_id } = JSON.parse(pending)
        setBusy(true)
        api('/verify', { method: 'POST', body: JSON.stringify({ type: 'AADHAAR_COMPLETE', verification_id, reference_id }) })
          .then(() => reload())
          .catch((e) => setErr(e.message))
          .finally(() => {
            localStorage.removeItem('onboard_digilocker')
            setBusy(false)
          })
      } catch {
        localStorage.removeItem('onboard_digilocker')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startDigilocker() {
    setErr('')
    setBusy(true)
    try {
      const redirect = `${window.location.origin}/onboard?token=${encodeURIComponent(new URLSearchParams(window.location.search).get('token') || '')}`
      const r = await api('/verify', { method: 'POST', body: JSON.stringify({ type: 'AADHAAR_INIT', redirect_url: redirect }) })
      localStorage.setItem('onboard_digilocker', JSON.stringify({ verification_id: r.verification_id, reference_id: r.reference_id }))
      window.location.href = r.url
    } catch (e: any) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900">Aadhaar Verification</h2>
      <p className="mt-1 text-sm text-gray-500">Verify your Aadhaar securely via DigiLocker.</p>
      <ErrorBanner err={err} />
      {done ? (
        <div className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Aadhaar verified</div>
      ) : (
        <button onClick={startDigilocker} disabled={busy} className="mt-4 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300">
          {busy ? 'Please wait…' : 'Verify via DigiLocker'}
        </button>
      )}
      <NavButtons onBack={back} onNext={next} nextDisabled={!done} busy={busy} />
    </div>
  )
}

function PanStep({ api, reload, next, back, has, busy, setBusy, err, setErr }: StepProps) {
  const [pan, setPan] = useState('')
  const [name, setName] = useState('')
  const done = has('PAN_360')

  async function verify() {
    setErr('')
    setBusy(true)
    try {
      const r = await api('/verify', { method: 'POST', body: JSON.stringify({ type: 'PAN_360', pan }) })
      if (!r.success) throw new Error(r.error || 'PAN verification failed')
      setName(r.data?.registered_name || '')
      await reload()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900">PAN Verification</h2>
      <ErrorBanner err={err} />
      {done ? (
        <div className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          PAN verified{name ? ` — ${name}` : ''}
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <input
            value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase().slice(0, 10))}
            placeholder="ABCDE1234F"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 uppercase focus:border-indigo-500 focus:outline-none"
          />
          <button onClick={verify} disabled={busy || pan.length !== 10} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300">
            Verify
          </button>
        </div>
      )}
      <NavButtons onBack={back} onNext={next} nextDisabled={!done} busy={busy} />
    </div>
  )
}

function BankStep({ api, reload, next, back, has, busy, setBusy, err, setErr }: StepProps) {
  const [acc, setAcc] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [name, setName] = useState('')
  const done = has('BANK_PENNY_DROP')

  async function verify() {
    setErr('')
    setBusy(true)
    try {
      const r = await api('/verify', { method: 'POST', body: JSON.stringify({ type: 'BANK_PENNY_DROP', account_number: acc, ifsc }) })
      if (!r.success) throw new Error(r.error || 'Bank verification failed')
      setName(r.data?.nameAtBank || '')
      await reload()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900">Bank Account Verification</h2>
      <ErrorBanner err={err} />
      {done ? (
        <div className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Bank verified{name ? ` — ${name}` : ''}</div>
      ) : (
        <div className="mt-4 space-y-2">
          <input value={acc} onChange={(e) => setAcc(e.target.value.replace(/\D/g, ''))} placeholder="Account number" className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none" />
          <input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="IFSC code" className="w-full rounded-lg border border-gray-300 px-3 py-2 uppercase focus:border-indigo-500 focus:outline-none" />
          <button onClick={verify} disabled={busy || !acc || !ifsc} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300">
            Verify (Penny Drop)
          </button>
        </div>
      )}
      <NavButtons onBack={back} onNext={next} nextDisabled={!done} busy={busy} />
    </div>
  )
}

function BusinessStep({ api, reload, next, back, has, busy, setBusy, err, setErr }: StepProps) {
  const [shopName, setShopName] = useState('')
  const [gst, setGst] = useState('')
  const saved = has('BUSINESS_NAME')

  async function saveBusiness() {
    setErr('')
    setBusy(true)
    try {
      if (gst.trim().length === 15) {
        await api('/verify', { method: 'POST', body: JSON.stringify({ type: 'GST', gst }) }).catch(() => {})
      }
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
      <h2 className="text-lg font-bold text-gray-900">Business Details</h2>
      <p className="mt-1 text-sm text-gray-500">GST is optional. Business/shop name is required.</p>
      <ErrorBanner err={err} />
      <div className="mt-4 space-y-2">
        <input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Shop / Business name *" className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none" />
        <input value={gst} onChange={(e) => setGst(e.target.value.toUpperCase().slice(0, 15))} placeholder="GSTIN (optional)" className="w-full rounded-lg border border-gray-300 px-3 py-2 uppercase focus:border-indigo-500 focus:outline-none" />
      </div>
      <NavButtons onBack={back} onNext={saveBusiness} nextDisabled={shopName.trim().length < 2 && !saved} busy={busy} />
    </div>
  )
}

function BiometricStep({ api, reload, next, back, has, setErr, err }: StepProps) {
  const selfieDone = has('DOCUMENT_SELFIE', 'Uploaded')
  const videoDone = has('ONBOARD_VIDEO', 'Uploaded')
  const [videoCfg, setVideoCfg] = useState<{ prompt: string; maxDurationSec: number; mode: string; uploadUrl?: string; key?: string; uploadToken: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  async function handleSelfie(dataUrl: string) {
    setErr('')
    try {
      const presign = await api('/selfie/presign', { method: 'POST', body: JSON.stringify({ contentType: 'image/jpeg' }) })
      if (presign.mode === 's3') {
        await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: await (await fetch(dataUrl)).blob() })
        await api('/selfie/complete', { method: 'POST', body: JSON.stringify({ key: presign.key, uploadToken: presign.uploadToken }) })
      } else {
        await api('/selfie/complete', { method: 'POST', body: JSON.stringify({ dataUrl }) })
      }
      await reload()
    } catch (e: any) {
      setErr(e.message)
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
      if (videoCfg.mode === 's3' && videoCfg.uploadUrl) {
        await fetch(videoCfg.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/webm' }, body: await (await fetch(dataUrl)).blob() })
        await api('/video/complete', { method: 'POST', body: JSON.stringify({ key: videoCfg.key, uploadToken: videoCfg.uploadToken, durationSec }) })
      } else {
        await api('/video/complete', { method: 'POST', body: JSON.stringify({ dataUrl, uploadToken: videoCfg.uploadToken, durationSec }) })
      }
      await reload()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900">Live Selfie &amp; Video</h2>
      <ErrorBanner err={err} />
      <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">1. Live Selfie</h3>
        <SelfieCapture onCapture={handleSelfie} captured={selfieDone} />
      </div>
      <div className="mt-6 border-t pt-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">2. Liveness Video</h3>
        {videoDone ? (
          <p className="text-sm font-medium text-green-600">Liveness video recorded</p>
        ) : !videoCfg ? (
          <button onClick={initVideo} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Start Liveness Check</button>
        ) : (
          <LivenessVideoCapture prompt={videoCfg.prompt} maxDurationSec={videoCfg.maxDurationSec} onRecorded={handleVideo} recorded={uploading} />
        )}
      </div>
      <NavButtons onBack={back} onNext={next} nextDisabled={!selfieDone || !videoDone} />
    </div>
  )
}

function DocumentsStep({ documents, api, reload, next, back, has, err, setErr }: StepProps) {
  const uploadDoc = async (type: string, dataUrl: string, coords?: { lat: number; lng: number }) => {
    setErr('')
    await api('/documents', { method: 'POST', body: JSON.stringify({ type, dataUrl, lat: coords?.lat, lng: coords?.lng }) })
    await reload()
  }
  const required = documents.filter((d) => d.required)
  const optional = documents.filter((d) => !d.required)
  const allRequiredDone = required.every((d) => has(`DOCUMENT_${d.type}`, 'Uploaded'))

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900">Upload Documents</h2>
      <ErrorBanner err={err} />
      <div className="mt-4 space-y-2">
        {required.map((d) => (
          <div key={d.type}>
            {d.hasTemplate && (
              <a href={getApiUrl(`/api/onboard/${encodeURIComponent(new URLSearchParams(window.location.search).get('token') || '')}/pg-form/download`)} className="mb-1 inline-block text-xs text-indigo-600 hover:underline">
                Download {d.label} template
              </a>
            )}
            <DocumentUploadField label={d.label} required gps={d.gps} uploaded={has(`DOCUMENT_${d.type}`, 'Uploaded')} onUpload={(dataUrl, coords) => uploadDoc(d.type, dataUrl, coords)} />
          </div>
        ))}
      </div>
      {optional.length > 0 && (
        <>
          <p className="mt-4 text-xs font-semibold uppercase text-gray-400">Optional</p>
          <div className="mt-2 space-y-2">
            {optional.map((d) => (
              <DocumentUploadField key={d.type} label={d.label} gps={d.gps} uploaded={has(`DOCUMENT_${d.type}`, 'Uploaded')} onUpload={(dataUrl, coords) => uploadDoc(d.type, dataUrl, coords)} />
            ))}
          </div>
        </>
      )}
      <NavButtons onBack={back} onNext={next} nextDisabled={!allRequiredDone} />
    </div>
  )
}

function DeclarationStep({ api, reload, next, back, has, requiresUplineApproval, busy, setBusy, err, setErr }: StepProps) {
  const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') || '' : ''
  const declUploaded = has('SELF_DECLARATION', 'Uploaded')
  const [approval, setApproval] = useState<{ status: string } | null>(null)
  const [agreed, setAgreed] = useState(false)
  const pollRef = useRef<any>(null)

  const uploadDeclaration = async (dataUrl: string) => {
    setErr('')
    await api('/documents', { method: 'POST', body: JSON.stringify({ type: 'SELF_DECLARATION', dataUrl }) })
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
  const canProceed = declUploaded && approvalOk && agreed

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900">Declaration &amp; Agreement</h2>
      <ErrorBanner err={err} />
      <div className="mt-4 space-y-4">
        <div>
          <a href={getApiUrl(`/api/onboard/${encodeURIComponent(token)}/declaration/download`)} className="text-sm text-indigo-600 hover:underline">
            1. Download self-declaration
          </a>
          <p className="text-xs text-gray-400">Sign it physically, then upload below.</p>
          <div className="mt-2">
            <DocumentUploadField label="Signed Self-Declaration" required uploaded={declUploaded} onUpload={(dataUrl) => uploadDeclaration(dataUrl)} />
          </div>
        </div>

        {requiresUplineApproval && (
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-sm font-medium text-gray-700">2. Upline Approval</p>
            {!approval ? (
              <button onClick={sendForApproval} disabled={!declUploaded || busy} className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300">
                Send for Approval
              </button>
            ) : approval.status === 'approved' ? (
              <p className="mt-1 text-sm font-medium text-green-600">Approved by your upline</p>
            ) : approval.status === 'rejected' ? (
              <p className="mt-1 text-sm font-medium text-red-600">Rejected by your upline. Contact them.</p>
            ) : (
              <p className="mt-1 text-sm text-amber-600">Waiting for upline approval…</p>
            )}
          </div>
        )}

        <label className="flex items-start gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={agreed} onChange={(e) => (e.target.checked ? acceptAgreement() : setAgreed(false))} className="mt-1" />
          <span>I accept the partner agreement, terms of service and privacy policy.</span>
        </label>
      </div>
      <NavButtons onBack={back} onNext={next} nextDisabled={!canProceed} busy={busy} />
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
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">✓</div>
        <h2 className="text-xl font-bold text-gray-900">Registration Submitted!</h2>
        <p className="mt-2 text-sm text-gray-600">{done.message}</p>
        <p className="mt-1 text-xs text-gray-400">Your partner ID: {done.partner_id}</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900">Personal Details &amp; Password</h2>
      <ErrorBanner err={err} />
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name *" className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2 focus:border-indigo-500 focus:outline-none" />
        <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Address" className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2 focus:border-indigo-500 focus:outline-none" />
        <input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="City" className="rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none" />
        <input value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="State" className="rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none" />
        <input value={form.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Pincode" className="rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none" />
        <div />
        <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Password *" className="rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none" />
        <input type="password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} placeholder="Confirm password *" className="rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none" />
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
