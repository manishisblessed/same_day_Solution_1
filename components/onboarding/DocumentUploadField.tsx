'use client'

import { useState } from 'react'
import { FileText, MapPin, Upload, Loader2, CheckCircle2, RefreshCw } from 'lucide-react'

interface DocumentUploadFieldProps {
  label: string
  required?: boolean
  gps?: boolean
  uploaded?: boolean
  hint?: string
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
  hint,
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
    <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${ok ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-white hover:border-indigo-200'}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ok ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
          {ok ? <CheckCircle2 className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-800">
            {label} {required && <span className="text-red-500">*</span>}
          </p>
          {gps && (
            <p className="flex items-center gap-1 text-xs text-gray-400">
              <MapPin className="h-3 w-3" /> Location will be captured
            </p>
          )}
          {hint && !ok && <p className="text-xs text-gray-400">{hint}</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </div>
      <div className="shrink-0">
        {ok ? (
          <div className="flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Uploaded
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
              <RefreshCw className="h-3 w-3" /> Replace
              <input
                type="file"
                accept={gps ? 'image/*' : 'image/*,application/pdf'}
                capture={gps ? 'environment' : undefined}
                onChange={handleFile}
                disabled={busy}
                className="hidden"
              />
            </label>
          </div>
        ) : (
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold shadow-sm transition-colors ${busy ? 'bg-gray-200 text-gray-500' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
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
