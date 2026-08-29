'use client'

import { useEffect, useRef, useState } from 'react'
import { Video, RefreshCw, CheckCircle2, Square } from 'lucide-react'

interface LivenessVideoCaptureProps {
  prompt: string
  maxDurationSec: number
  onRecorded: (dataUrl: string, durationSec: number) => void
  recorded?: boolean
}

function mediaErrorMessage(e: any): string {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Camera needs a secure (HTTPS) connection. Please open this page over HTTPS and retry.'
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'This browser can’t record video. Please use an up-to-date Chrome, Safari or Edge and retry.'
  }
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera/microphone permission was denied. Click the camera icon in your browser’s address bar, choose “Allow”, then tap Open Camera again.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera/microphone found. Connect them and retry.'
    case 'NotReadableError':
      return 'Your camera is being used by another app. Close it and tap Open Camera again.'
    default:
      return 'Could not start the camera/microphone. Please allow access and retry.'
  }
}

/**
 * ~10s liveness video capture using MediaRecorder. The user reads a
 * server-issued challenge number aloud while recording. Falls back to a file
 * upload when a camera/mic isn't available.
 */
export default function LivenessVideoCapture({
  prompt,
  maxDurationSec,
  onRecorded,
  recorded,
}: LivenessVideoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startRef = useRef<number>(0)
  const [active, setActive] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Attach the stream only after the <video> is mounted (active === true);
  // assigning srcObject before mount silently dropped the feed.
  useEffect(() => {
    if (active && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.muted = true
      videoRef.current.play().catch(() => {})
    }
  }, [active])

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  async function startCamera() {
    setError('')
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(mediaErrorMessage({}))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      })
      streamRef.current = stream
      setActive(true)
    } catch (e: any) {
      setError(mediaErrorMessage(e))
    }
  }

  function startRecording() {
    if (!streamRef.current) return
    chunksRef.current = []
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(streamRef.current, { mimeType: 'video/webm' })
    } catch {
      recorder = new MediaRecorder(streamRef.current)
    }
    recorderRef.current = recorder
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      const durationSec = Math.round((Date.now() - startRef.current) / 1000)
      const reader = new FileReader()
      reader.onload = () => {
        onRecorded(String(reader.result), durationSec)
        setDone(true)
        stop()
        setActive(false)
      }
      reader.readAsDataURL(blob)
    }
    startRef.current = Date.now()
    recorder.start()
    setRecording(true)
    setElapsed(0)
    const timer = setInterval(() => {
      const secs = Math.round((Date.now() - startRef.current) / 1000)
      setElapsed(secs)
      if (secs >= maxDurationSec) {
        clearInterval(timer)
        stopRecording()
      }
    }, 250)
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    setRecording(false)
  }

  if (done || recorded) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-green-50 px-4 py-5 ring-1 ring-green-200">
        <CheckCircle2 className="h-8 w-8 text-green-500" />
        <p className="text-sm font-semibold text-green-700">Liveness video recorded</p>
        <button
          type="button"
          onClick={() => {
            setDone(false)
            startCamera()
          }}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Re-record
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-amber-50 px-4 py-3 text-center ring-1 ring-amber-200">
        <p className="text-xs font-medium uppercase tracking-wide text-amber-600">Read aloud on camera</p>
        <p className="mt-0.5 text-lg font-bold tracking-widest text-amber-800">{prompt}</p>
      </div>

      {active ? (
        <div className="flex flex-col items-center">
          <div className="relative overflow-hidden rounded-2xl bg-black shadow-lg ring-1 ring-black/10">
            <video ref={videoRef} playsInline muted className="h-56 w-full max-w-xs object-cover" />
            {recording && (
              <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> {elapsed}s / {maxDurationSec}s
              </span>
            )}
          </div>
          {recording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-black"
            >
              <Square className="h-4 w-4" fill="currentColor" /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-white" /> Start Recording
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={startCamera}
          className="group flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 px-4 py-6 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-50"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 transition-transform group-hover:scale-110">
            <Video className="h-6 w-6" />
          </span>
          <span className="text-sm font-semibold text-gray-800">Open Camera</span>
          <span className="text-xs text-gray-500">Record a short liveness video</span>
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
