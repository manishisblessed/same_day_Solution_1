'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, MapPin, RefreshCw, CheckCircle2, Loader2 } from 'lucide-react'
import { getGeoLocation } from '@/hooks/useGeolocation'

interface GpsPhotoCaptureProps {
  label: string
  required?: boolean
  /** 'environment' for shop photos, 'user' for the shop selfie. */
  facing?: 'user' | 'environment'
  uploaded?: boolean
  onUpload: (dataUrl: string, coords: { lat: number; lng: number; acc?: number }) => Promise<void> | void
}

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
 * Live-camera photo capture with mandatory GPS. Used for shop photos and the
 * shop selfie — no gallery/file upload, the image must be taken live and is
 * tagged with the browser's current location (server also records the IP).
 */
export default function GpsPhotoCapture({
  label,
  required,
  facing = 'environment',
  uploaded,
  onUpload,
}: GpsPhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(!!uploaded)
  const [preview, setPreview] = useState('')

  useEffect(() => {
    return () => stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Attach the stream only after the <video> is mounted.
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

  async function openCamera() {
    setError('')
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(cameraErrorMessage({}))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: false,
      })
      streamRef.current = stream
      setActive(true)
    } catch (e: any) {
      setError(cameraErrorMessage(e))
    }
  }

  async function snap() {
    const video = videoRef.current
    if (!video) return
    setError('')
    setBusy(true)
    try {
      setStatus('Getting location…')
      const geo = await getGeoLocation(12000)
      if (!geo) {
        setError('Location is required for this photo. Allow location access and try again.')
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      setPreview(dataUrl)
      stopCamera()
      setActive(false)
      setStatus('Uploading…')
      await onUpload(dataUrl, { lat: geo.latitude, lng: geo.longitude, acc: geo.accuracy })
      setOk(true)
    } catch (e: any) {
      setError(e?.message || 'Capture failed. Please retry.')
    } finally {
      setBusy(false)
      setStatus('')
    }
  }

  function retake() {
    setPreview('')
    setOk(false)
    openCamera()
  }

  return (
    <div className={`rounded-xl border p-3 transition-colors ${ok ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-white'}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ok ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
            {ok ? <CheckCircle2 className="h-5 w-5" /> : <Camera className="h-4 w-4" />}
          </span>
          <div>
            <p className="text-sm font-medium text-gray-800">
              {label} {required && <span className="text-red-500">*</span>}
            </p>
            <p className="flex items-center gap-1 text-xs text-gray-400">
              <MapPin className="h-3 w-3" /> Live photo · location captured
            </p>
          </div>
        </div>
        {ok && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Uploaded
          </span>
        )}
      </div>

      {ok || preview ? (
        <div className="flex flex-col items-center gap-2">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={label} className="h-40 w-full max-w-xs rounded-xl object-cover ring-2 ring-green-400/60" />
          ) : (
            <div className="flex h-24 w-full max-w-xs items-center justify-center rounded-xl bg-green-50 ring-2 ring-green-400/60">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
            </div>
          )}
          <button type="button" onClick={retake} className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline">
            <RefreshCw className="h-3.5 w-3.5" /> Retake
          </button>
        </div>
      ) : active ? (
        <div className="flex flex-col items-center">
          <div className="relative w-full max-w-xs overflow-hidden rounded-xl bg-black ring-1 ring-black/10">
            <video ref={videoRef} playsInline muted className="h-56 w-full object-cover" />
          </div>
          <button
            type="button"
            onClick={snap}
            disabled={busy}
            className={`mt-3 inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors ${busy ? 'bg-gray-300' : 'bg-indigo-600 hover:bg-indigo-700'}`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {busy ? status || 'Please wait…' : 'Capture Photo'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openCamera}
          className="group flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 px-4 py-5 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-50"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 transition-transform group-hover:scale-110">
            <Camera className="h-5 w-5" />
          </span>
          <span className="text-sm font-semibold text-gray-800">Open Camera</span>
          <span className="text-xs text-gray-500">Take a live photo</span>
        </button>
      )}

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-center text-xs leading-relaxed text-red-600 ring-1 ring-red-100">
          {error}
        </p>
      )}
    </div>
  )
}
