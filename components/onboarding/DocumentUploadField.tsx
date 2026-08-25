'use client'

import { useState } from 'react'

interface DocumentUploadFieldProps {
  label: string
  required?: boolean
  gps?: boolean
  uploaded?: boolean
  /** Called with (dataUrl, coords) once a file is chosen. */
  onUpload: (dataUrl: string, coords?: { lat: number; lng: number }) => Promise<void> | void
}

/**
 * Generic document upload row. For GPS docs it captures the browser location
 * alongside the photo before uploading.
 */
export default function DocumentUploadField({
  label,
  required,
  gps,
  uploaded,
  onUpload,
}: DocumentUploadFieldProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(!!uploaded)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setBusy(true)
    try {
      let coords: { lat: number; lng: number } | undefined
      if (gps) {
        coords = await new Promise((resolve, reject) => {
          if (!navigator.geolocation) return reject(new Error('Geolocation unavailable'))
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => reject(new Error('Location permission denied')),
            { enableHighAccuracy: true, timeout: 10000 }
          )
        })
      }
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
      await onUpload(dataUrl, coords)
      setOk(true)
    } catch (err: any) {
      setError(err.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-800">
          {label} {required && <span className="text-red-500">*</span>}
        </p>
        {gps && <p className="text-xs text-gray-400">Location will be captured</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <div className="shrink-0">
        {ok ? (
          <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
            Uploaded
          </span>
        ) : (
          <label className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold ${busy ? 'bg-gray-200 text-gray-500' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
            {busy ? 'Uploading…' : 'Upload'}
            <input
              type="file"
              accept={gps ? 'image/*' : 'image/*,application/pdf'}
              capture={gps ? 'environment' : undefined}
              onChange={handleFile}
              disabled={busy}
              className="hidden"
            />
          </label>
        )}
      </div>
    </div>
  )
}
