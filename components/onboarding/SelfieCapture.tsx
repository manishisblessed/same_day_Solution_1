'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, CheckCircle2 } from 'lucide-react'

interface SelfieCaptureProps {
  onCapture: (dataUrl: string) => void
  captured?: boolean
}

/** Map a getUserMedia failure to a clear, actionable message. */
function cameraErrorMessage(e: any): string {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Camera needs a secure (HTTPS) connection. Please open this page over HTTPS and retry.'
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'This browser can’t open the camera. Please use an up-to-date Chrome, Safari or Edge and retry.'
  }
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied. Click the camera icon in your browser’s address bar, choose “Allow”, then tap Open Camera again.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Connect a camera and retry.'
    case 'NotReadableError':
      return 'Your camera is being used by another app. Close it and tap Open Camera again.'
    default:
      return 'Could not start the camera. Please allow camera access and retry.'
  }
}

/**
 * Live front-camera selfie capture. Falls back to a prominent file/camera
 * upload if getUserMedia is unavailable (desktops without a webcam, blocked
 * permissions, in-app browsers, etc.).
 */
export default function SelfieCapture({ onCapture, captured }: SelfieCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  const [retaking, setRetaking] = useState(false)

  useEffect(() => {
    return () => stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Attach the stream only after the <video> is mounted (active === true);
  // assigning srcObject before mount silently dropped the feed.
  useEffect(() => {
    if (active && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  }, [active])

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  async function startCamera() {
    setError('')
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(cameraErrorMessage({}))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      setActive(true)
    } catch (e: any) {
      setError(cameraErrorMessage(e))
    }
  }

  function snap() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setPreview(dataUrl)
    setRetaking(false)
    onCapture(dataUrl)
    stopCamera()
    setActive(false)
  }

  if ((preview || captured) && !retaking) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Selfie" className="h-40 w-40 rounded-2xl object-cover shadow-md ring-4 ring-green-400/60" />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center rounded-2xl bg-green-50 ring-4 ring-green-400/60">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            </div>
          )}
          <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-green-500 px-3 py-0.5 text-[11px] font-semibold text-white shadow">
            Captured
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setPreview('')
            setRetaking(true)
            startCamera()
          }}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retake
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {active ? (
        <div className="flex flex-col items-center">
          <div className="relative overflow-hidden rounded-2xl bg-black shadow-lg ring-1 ring-black/10">
            <video ref={videoRef} playsInline muted className="h-56 w-full max-w-xs object-cover" />
            <div className="pointer-events-none absolute inset-3 rounded-xl border-2 border-dashed border-white/40" />
          </div>
          <button
            type="button"
            onClick={snap}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-colors hover:bg-indigo-700"
          >
            <Camera className="h-4 w-4" /> Capture Selfie
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startCamera}
          className="group flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 px-4 py-6 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-50"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 transition-transform group-hover:scale-110">
            <Camera className="h-6 w-6" />
          </span>
          <span className="text-sm font-semibold text-gray-800">Open Camera</span>
          <span className="text-xs text-gray-500">Take a live selfie</span>
        </button>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-xs leading-relaxed text-red-600 ring-1 ring-red-100">
          {error}
        </p>
      )}
    </div>
  )
}
