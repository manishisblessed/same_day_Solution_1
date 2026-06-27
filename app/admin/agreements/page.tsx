'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import { apiFetch } from '@/lib/api-client'
import type { LegalDocumentMeta, LegalManifestCompany, PartnerRole } from '@/lib/legal/types'
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Menu,
  Printer,
  Shield,
} from 'lucide-react'
import { motion } from 'framer-motion'

interface AgreementsListResponse {
  success: boolean
  version: string
  manifestVersion: string
  effectiveDate: string
  company: LegalManifestCompany
  governingLaw: string
  jurisdiction: string
  documents: LegalDocumentMeta[]
}

interface DocumentResponse {
  success: boolean
  document: {
    id: string
    fileName: string
    title: string
    shortTitle: string
    description: string
    roles: PartnerRole[]
    requiredForOnboarding: boolean
    order: number
    version: string
    effectiveDate: string
    content: string
    html: string
  }
}

const ROLE_LABELS: Record<PartnerRole, string> = {
  retailer: 'Retailer',
  distributor: 'Distributor',
  master_distributor: 'Master Distributor',
  partner: 'Partner (API)',
}

export default function AdminAgreementsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<AgreementsListResponse | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedHtml, setSelectedHtml] = useState<string>('')
  const [docMenuOpen, setDocMenuOpen] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  const loadDocument = useCallback(async (docId: string) => {
    setLoadingDoc(true)
    setSelectedHtml('')
    try {
      const response = await apiFetch(`/api/admin/legal-agreements/${docId}`)
      const data: DocumentResponse = await response.json()
      if (!response.ok || !data.success) {
        throw new Error((data as { error?: string }).error || 'Failed to load document')
      }
      setSelectedId(docId)
      setSelectedHtml(data.document.html || '')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load document'
      setError(message === 'Failed to fetch' ? 'Unable to reach API. Try refreshing.' : message)
    } finally {
      setLoadingDoc(false)
    }
  }, [])

  useEffect(() => {
    if (authLoading || !user || user.role !== 'admin') return
    let cancelled = false

    const init = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/api/admin/legal-agreements')
        const data: AgreementsListResponse = await response.json()
        if (cancelled) return
        if (!response.ok || !data.success) {
          throw new Error((data as { error?: string }).error || 'Failed to load agreements')
        }
        setMeta(data)
        setLoading(false)

        if (data.documents.length > 0) {
          const firstDocId = data.documents[0].id
          setLoadingDoc(true)
          const docResponse = await apiFetch(`/api/admin/legal-agreements/${firstDocId}`)
          const docData: DocumentResponse = await docResponse.json()
          if (cancelled) return
          if (docResponse.ok && docData.success) {
            setSelectedId(firstDocId)
            setSelectedHtml(docData.document.html || '')
          }
          setLoadingDoc(false)
        }
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to load agreements'
        setError(message === 'Failed to fetch' ? 'Unable to reach API. Try refreshing.' : message)
        setLoading(false)
        setLoadingDoc(false)
      }
    }

    init()
    return () => { cancelled = true }
  }, [authLoading, user])

  const selectedDoc = useMemo(
    () => meta?.documents.find((doc) => doc.id === selectedId) ?? null,
    [meta, selectedId]
  )

  const renderedHtml = selectedHtml

  useEffect(() => {
    const close = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.download-dropdown')) {
      setDocMenuOpen(false)
    }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadDocument = async (docId: string) => {
    try {
      const response = await apiFetch(`/api/admin/legal-agreements/${docId}?download=1`)
      if (!response.ok) throw new Error('Download failed')
      const blob = await response.blob()
      const doc = meta?.documents.find((item) => item.id === docId)
      triggerDownload(blob, doc?.fileName || `${docId}.md`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    }
  }

  const wrapHtmlForWord = (html: string) =>
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>body{font-family:Calibri,sans-serif;font-size:11pt;line-height:1.6;color:#222}h1{font-size:18pt;font-weight:bold}h2{font-size:14pt;font-weight:bold}h3{font-size:12pt;font-weight:bold}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4pt 8pt}th{background:#f0f0f0}ol,ul{padding-left:1.5em}@page{size:A4;margin:2cm}</style></head><body>${html}</body></html>`

  const buildPrintHtml = (title: string, html: string) =>
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
      *{box-sizing:border-box}
      body{font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:11pt;line-height:1.6;color:#1a1a1a;margin:0;padding:24px}
      h1{font-size:20pt;font-weight:700;margin:0 0 12px}
      h2{font-size:14pt;font-weight:700;margin:22px 0 8px}
      h3{font-size:12pt;font-weight:700;margin:16px 0 6px}
      h4{font-size:11pt;font-weight:700;margin:12px 0 4px}
      p{margin:8px 0}
      strong{font-weight:700}
      hr{border:none;border-top:1px solid #ccc;margin:16px 0}
      table{border-collapse:collapse;width:100%;margin:12px 0;font-size:10pt}
      td,th{border:1px solid #999;padding:5px 8px;text-align:left;vertical-align:top}
      th{background:#f0f0f0;font-weight:700}
      ul,ol{padding-left:1.4em;margin:8px 0}
      li{margin:3px 0}
      table,tr,td,th,h1,h2,h3{page-break-inside:avoid}
      @page{size:A4;margin:16mm}
    </style></head><body>${html}
    <script>window.onload=function(){setTimeout(function(){window.focus();window.print();},350)};window.onafterprint=function(){window.close()};</script>
    </body></html>`

  const downloadCurrentAs = async (format: 'pdf' | 'doc' | 'md') => {
    setDocMenuOpen(false)
    if (!selectedId) return

    if (format === 'md') {
      downloadDocument(selectedId)
      return
    }

    const baseName = selectedDoc?.fileName?.replace('.md', '') || 'document'

    if (format === 'doc') {
      const html = contentRef.current?.innerHTML
      if (!html) return
      const blob = new Blob(['\ufeff', wrapHtmlForWord(html)], { type: 'application/msword' })
      triggerDownload(blob, `${baseName}.doc`)
      return
    }

    if (format === 'pdf') {
      const html = contentRef.current?.innerHTML
      if (!html) {
        setError('Content not rendered yet. Please wait for the document to load.')
        return
      }
      const title = selectedDoc?.title || baseName
      const printWindow = window.open('', '_blank', 'width=900,height=1000')
      if (!printWindow) {
        setError('Pop-up blocked. Allow pop-ups for this site, or use the Print button and choose "Save as PDF".')
        return
      }
      printWindow.document.open()
      printWindow.document.write(buildPrintHtml(title, html))
      printWindow.document.close()
    }
  }

  const handlePrint = () => {
    window.print()
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-56 pt-16">
        <div className="sticky top-16 z-20 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800 print:hidden">
          <div className="px-4 sm:px-6 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div>
                <button
                  onClick={() => router.push('/admin?tab=dashboard')}
                  className="inline-flex items-center text-sm text-gray-500 hover:text-primary-600 mb-2"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back to Admin
                </button>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Shield className="w-6 h-6 text-primary-500" />
                  Legal Agreements
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Version {meta?.manifestVersion} · Effective {meta?.effectiveDate} · {meta?.governingLaw} · {meta?.jurisdiction}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {selectedId && (
                <>
                  {/* Current doc dropdown */}
                  <div className="relative download-dropdown">
                    <button
                      onClick={() => setDocMenuOpen((v) => !v)}
                      disabled={!!downloading}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60 transition-colors"
                    >
                      {downloading === 'current-pdf' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      Download
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${docMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {docMenuOpen && (
                      <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-1.5 z-30 animate-in fade-in slide-in-from-top-1 duration-150">
                        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Choose format</p>
                        <button onClick={() => downloadCurrentAs('pdf')} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2.5 transition-colors">
                          <FileText className="w-4 h-4 text-red-500" />
                          <span>PDF Document <span className="text-gray-400">(.pdf)</span></span>
                        </button>
                        <button onClick={() => downloadCurrentAs('doc')} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2.5 transition-colors">
                          <FileText className="w-4 h-4 text-blue-500" />
                          <span>Word Document <span className="text-gray-400">(.doc)</span></span>
                        </button>
                        <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                        <button onClick={() => downloadCurrentAs('md')} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2.5 transition-colors">
                          <Download className="w-4 h-4 text-gray-400" />
                          <span>Markdown <span className="text-gray-400">(.md)</span></span>
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handlePrint}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    Print
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-4 sm:mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 print:hidden">
            {error}
          </div>
        )}

        <div className="p-4 sm:p-6 grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
          <aside className="print:hidden">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <h2 className="font-semibold text-gray-900 dark:text-white">Document Library</h2>
                <p className="text-xs text-gray-500 mt-1">{meta?.company.legalName}</p>
              </div>
              <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
                {meta?.documents.map((doc) => {
                  const active = selectedId === doc.id
                  return (
                    <button
                      key={doc.id}
                      onClick={() => loadDocument(doc.id)}
                      className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700 transition-colors ${
                        active
                          ? 'bg-primary-50 dark:bg-primary-900/20 border-l-4 border-l-primary-500'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <FileText className={`w-4 h-4 mt-0.5 ${active ? 'text-primary-600' : 'text-gray-400'}`} />
                        <div>
                          <p className={`text-sm font-medium ${active ? 'text-primary-700 dark:text-primary-300' : 'text-gray-900 dark:text-white'}`}>
                            {doc.shortTitle}
                          </p>
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{doc.description}</p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {doc.roles.map((role) => (
                              <span
                                key={role}
                                className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                              >
                                {ROLE_LABELS[role]}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </aside>

          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 print:border-none">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {selectedDoc?.title || 'Select a document'}
              </h2>
              {selectedDoc && (
                <p className="text-sm text-gray-500 mt-1">
                  {selectedDoc.fileName} · {selectedDoc.requiredForOnboarding ? 'Required for onboarding' : 'Conditional document'}
                </p>
              )}
            </div>

            <div className="relative">
              {loadingDoc && (
                <div className="absolute inset-0 bg-white/70 dark:bg-gray-800/70 flex items-center justify-center z-10">
                  <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                </div>
              )}
              <div
                ref={contentRef}
                className="px-6 py-6 max-w-none legal-document-content print:px-8 print:py-8"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            </div>
          </motion.section>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          aside,
          .print\\:hidden {
            display: none !important;
          }
          main,
          body {
            background: white !important;
          }
        }
      `}</style>
    </div>
  )
}
