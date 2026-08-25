'use client'

import { useEffect, useRef, useState } from 'react'

interface SelfieCaptureProps {
  onCapture: (dataUrl: string) => void
  captured?: boolean
}

/**
 * Live front-camera selfie capture. Falls back to the native file/camera input
 * if getUserMedia is unavailable (e.g. in-app browsers).
 */
export default function SelfieCapture({ onCapture, captured }: SelfieCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')

  useEffect(() => {
    return () => stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  async function startCamera() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setActive(true)
    } catch (e: any) {
      setError('Camera unavailable. Use the upload option below.')
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
    onCapture(dataUrl)
    stopCamera()
    setActive(false)
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      setPreview(dataUrl)
      onCapture(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-3">
      {preview || captured ? (
        <div className="text-center">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Selfie" className="mx-auto h-40 w-40 rounded-lg object-cover ring-2 ring-green-500" />
          )}
          <p className="mt-2 text-sm font-medium text-green-600">Selfie captured</p>
          <button
            type="button"
            onClick={() => {
              setPreview('')
              startCamera()
            }}
            className="mt-1 text-xs text-indigo-600 hover:underline"
          >
            Retake
          </button>
        </div>
      ) : active ? (
        <div className="text-center">
          <video ref={videoRef} playsInline muted className="mx-auto h-56 w-full max-w-xs rounded-lg bg-black object-cover" />
          <button
            type="button"
            onClick={snap}
            className="mt-3 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Capture
          </button>
        </div>
      ) : (
        <div className="text-center">
          <button
            type="button"
            onClick={startCamera}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Open Camera
          </button>
        </div>
      )}

      {error && <p className="text-center text-xs text-red-600">{error}</p>}

      <div className="text-center">
        <label className="cursor-pointer text-xs text-gray-500 hover:text-indigo-600">
          Or upload a photo
          <input type="file" accept="image/*" capture="user" onChange={onFile} className="hidden" />
        </label>
      </div>
    </div>
  )
}
