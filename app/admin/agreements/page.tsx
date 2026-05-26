'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import { apiFetch } from '@/lib/api-client'
import { renderMarkdownToHtml } from '@/lib/legal/renderMarkdown'
import type { LegalDocumentMeta, LegalManifestCompany, PartnerRole } from '@/lib/legal/types'
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Menu,
  Package,
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
  const [selectedContent, setSelectedContent] = useState<string>('')

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  const loadDocument = useCallback(async (docId: string) => {
    setLoadingDoc(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/admin/legal-agreements/${docId}`)
      const data: DocumentResponse = await response.json()
      if (!response.ok || !data.success) {
        throw new Error((data as { error?: string }).error || 'Failed to load document')
      }
      setSelectedId(docId)
      setSelectedContent(data.document.content)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document')
    } finally {
      setLoadingDoc(false)
    }
  }, [])

  useEffect(() => {
    if (authLoading || !user || user.role !== 'admin') return

    const fetchList = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/api/admin/legal-agreements')
        const data: AgreementsListResponse = await response.json()
        if (!response.ok || !data.success) {
          throw new Error((data as { error?: string }).error || 'Failed to load agreements')
        }
        setMeta(data)
        if (data.documents.length > 0) {
          await loadDocument(data.documents[0].id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load agreements')
      } finally {
        setLoading(false)
      }
    }

    fetchList()
  }, [authLoading, user, loadDocument])

  const selectedDoc = useMemo(
    () => meta?.documents.find((doc) => doc.id === selectedId) ?? null,
    [meta, selectedId]
  )

  const renderedHtml = useMemo(() => renderMarkdownToHtml(selectedContent), [selectedContent])

  const downloadDocument = async (docId: string) => {
    try {
      const response = await apiFetch(`/api/admin/legal-agreements/${docId}?download=1`)
      if (!response.ok) throw new Error('Download failed')
      const blob = await response.blob()
      const doc = meta?.documents.find((item) => item.id === docId)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = doc?.fileName || `${docId}.md`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    }
  }

  const downloadFullPack = async () => {
    try {
      const response = await apiFetch('/api/admin/legal-agreements/download-pack')
      if (!response.ok) throw new Error('Pack download failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `sameday-solutions-legal-pack-v${meta?.manifestVersion || '1.0'}.md`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pack download failed')
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
              <button
                onClick={downloadFullPack}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
              >
                <Package className="w-4 h-4" />
                Download Full Pack
              </button>
              {selectedId && (
                <>
                  <button
                    onClick={() => downloadDocument(selectedId)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <Download className="w-4 h-4" />
                    Download Current
                  </button>
                  <button
                    onClick={handlePrint}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
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
