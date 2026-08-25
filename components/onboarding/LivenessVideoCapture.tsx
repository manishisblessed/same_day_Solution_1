'use client'

import { useEffect, useRef, useState } from 'react'

interface LivenessVideoCaptureProps {
  prompt: string
  maxDurationSec: number
  onRecorded: (dataUrl: string, durationSec: number) => void
  recorded?: boolean
}

/**
 * ~10s liveness video capture using MediaRecorder. The user reads a
 * server-issued challenge number aloud while recording.
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

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  async function startCamera() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        await videoRef.current.play()
      }
      setActive(true)
    } catch {
      setError('Camera/microphone unavailable. Please allow permissions and retry.')
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
      <div className="text-center">
        <p className="text-sm font-medium text-green-600">Liveness video recorded</p>
        <button
          type="button"
          onClick={() => {
            setDone(false)
            startCamera()
          }}
          className="mt-1 text-xs text-indigo-600 hover:underline"
        >
          Re-record
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-amber-50 p-3 text-center text-sm font-medium text-amber-800">
        {prompt}
      </div>
      {active ? (
        <div className="text-center">
          <video ref={videoRef} playsInline muted className="mx-auto h-56 w-full max-w-xs rounded-lg bg-black object-cover" />
          {recording ? (
            <div className="mt-3">
              <span className="mr-3 inline-flex items-center text-sm font-semibold text-red-600">
                <span className="mr-1 h-2 w-2 animate-pulse rounded-full bg-red-600" /> {elapsed}s / {maxDurationSec}s
              </span>
              <button
                type="button"
                onClick={stopRecording}
                className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white"
              >
                Stop
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              className="mt-3 rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Start Recording
            </button>
          )}
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
    </div>
  )
}
