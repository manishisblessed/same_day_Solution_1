'use client'

import { useState, useRef, useEffect } from 'react'
import { Download, FileText, FileSpreadsheet, FileDown, ChevronDown, Loader2 } from 'lucide-react'

export type ExportFormat = 'csv' | 'excel' | 'pdf'

interface ExportDropdownProps {
  onExport: (format: ExportFormat) => Promise<void> | void
  disabled?: boolean
  exporting?: ExportFormat | null
  formats?: ExportFormat[]
  size?: 'sm' | 'md'
}

const formatConfig: Record<ExportFormat, { label: string; icon: typeof FileText; bg: string; hover: string }> = {
  csv: { label: 'CSV', icon: FileText, bg: 'bg-emerald-600', hover: 'hover:bg-emerald-700' },
  excel: { label: 'Excel', icon: FileSpreadsheet, bg: 'bg-green-700', hover: 'hover:bg-green-800' },
  pdf: { label: 'PDF', icon: FileDown, bg: 'bg-red-600', hover: 'hover:bg-red-700' },
}

export default function ExportDropdown({
  onExport,
  disabled = false,
  exporting = null,
  formats = ['csv', 'excel', 'pdf'],
  size = 'md',
}: ExportDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const py = size === 'sm' ? 'py-1.5' : 'py-2'
  const px = size === 'sm' ? 'px-3' : 'px-4'
  const text = size === 'sm' ? 'text-xs' : 'text-sm'

  if (formats.length <= 2) {
    return (
      <div className="flex gap-2">
        {formats.map(fmt => {
          const cfg = formatConfig[fmt]
          const Icon = cfg.icon
          return (
            <button
              key={fmt}
              onClick={() => onExport(fmt)}
              disabled={disabled || !!exporting}
              className={`flex items-center gap-2 ${px} ${py} ${cfg.bg} ${cfg.hover} text-white rounded-lg ${text} font-medium transition-all shadow-sm disabled:opacity-50`}
            >
              {exporting === fmt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
              {cfg.label}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled || !!exporting}
        className={`flex items-center gap-2 ${px} ${py} bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg ${text} font-medium transition-all shadow-sm disabled:opacity-50`}
      >
        {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        Export
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-150">
          {formats.map(fmt => {
            const cfg = formatConfig[fmt]
            const Icon = cfg.icon
            return (
              <button
                key={fmt}
                onClick={() => { setOpen(false); onExport(fmt) }}
                disabled={!!exporting}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {exporting === fmt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                Export {cfg.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function getExportExtension(format: ExportFormat, contentType?: string): string {
  if (format === 'csv') return 'csv'
  if (format === 'excel') return 'xls'
  if (format === 'pdf') {
    if (contentType?.includes('pdf')) return 'pdf'
    return 'html'
  }
  return 'csv'
}
