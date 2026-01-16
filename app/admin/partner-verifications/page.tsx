'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle, Eye, Clock, Download, FileText, Image as ImageIcon, X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react'

interface PendingPartner {
  partner_id: string
  name: string
  email: string
  phone: string
  partner_type: 'retailers' | 'distributors' | 'master_distributors'
  status: string
  verification_status: string
  aadhar_number?: string
  aadhar_attachment_url?: string
  pan_number?: string
  pan_attachment_url?: string
  udhyam_number?: string
  udhyam_certificate_url?: string
  gst_number?: string
  gst_certificate_url?: string
  created_at: string
}

export default function PartnerVerificationsPage() {
  const [pendingPartners, setPendingPartners] = useState<PendingPartner[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPartner, setSelectedPartner] = useState<PendingPartner | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'retailers' | 'distributors' | 'master_distributors'>('all')
  const [viewingDocument, setViewingDocument] = useState<{ url: string; type: string; name: string } | null>(null)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectingPartner, setRejectingPartner] = useState<PendingPartner | null>(null)
  const [imageZoom, setImageZoom] = useState(1)
  const [imageRotation, setImageRotation] = useState(0)

  useEffect(() => {
    fetchPendingPartners()
  }, [filter])

  const fetchPendingPartners = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/pending-verifications')
      if (!response.ok) {
        throw new Error('Failed to fetch pending verifications')
      }
      const data = await response.json()
      
      let filtered = data.partners || []
      if (filter !== 'all') {
        filtered = filtered.filter((p: PendingPartner) => p.partner_type === filter)
      }
      
      setPendingPartners(filtered)
    } catch (error) {
      console.error('Error fetching pending partners:', error)
      alert('Failed to load pending verifications')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (partner: PendingPartner) => {
    if (!confirm(`Approve ${partner.name}? This will activate their account.`)) {
      return
    }

    setProcessing(partner.partner_id)
    try {
      const response = await fetch('/api/admin/approve-partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: partner.partner_id,
          partner_type: partner.partner_type,
          action: 'approve'
        })
      })

      const data = await response.json()
      if (data.success) {
        alert('Partner approved successfully!')
        fetchPendingPartners()
        setSelectedPartner(null)
      } else {
        alert(data.error || 'Failed to approve partner')
      }
    } catch (error: any) {
      console.error('Error approving partner:', error)
      alert('Failed to approve partner')
    } finally {
      setProcessing(null)
    }
  }

  const handleRejectClick = (partner: PendingPartner) => {
    setRejectingPartner(partner)
    setShowRejectModal(true)
    setRejectReason('')
  }

  const handleReject = async () => {
    if (!rejectingPartner || !rejectReason.trim()) {
      alert('Please provide a reason for rejection')
      return
    }

    setProcessing(rejectingPartner.partner_id)
    try {
      const response = await fetch('/api/admin/approve-partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: rejectingPartner.partner_id,
          partner_type: rejectingPartner.partner_type,
          action: 'reject',
          remarks: rejectReason.trim()
        })
      })

      const data = await response.json()
      if (data.success) {
        alert('Partner rejected successfully!')
        fetchPendingPartners()
        setSelectedPartner(null)
        setShowRejectModal(false)
        setRejectingPartner(null)
        setRejectReason('')
      } else {
        alert(data.error || 'Failed to reject partner')
      }
    } catch (error: any) {
      console.error('Error rejecting partner:', error)
      alert('Failed to reject partner')
    } finally {
      setProcessing(null)
    }
  }

  const handleDownload = (url: string, filename: string) => {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const getFileType = (url: string): 'image' | 'pdf' | 'unknown' => {
    const extension = url.split('.').pop()?.toLowerCase()
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension || '')) {
      return 'image'
    }
    if (extension === 'pdf') {
      return 'pdf'
    }
    return 'unknown'
  }

  const openDocumentViewer = (url: string, name: string) => {
    const fileType = getFileType(url)
    setViewingDocument({ url, type: fileType, name })
    setImageZoom(1)
    setImageRotation(0)
  }

  const getPartnerTypeLabel = (type: string) => {
    switch (type) {
      case 'retailers': return 'Retailer'
      case 'distributors': return 'Distributor'
      case 'master_distributors': return 'Master Distributor'
      default: return type
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Partner Verifications</h1>
          <p className="text-gray-600">Review and approve pending partner registrations</p>
        </div>

        {/* Filter Tabs */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium ${
              filter === 'all' ? 'bg-yellow-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            All ({pendingPartners.length})
          </button>
          <button
            onClick={() => setFilter('master_distributors')}
            className={`px-4 py-2 rounded-lg font-medium ${
              filter === 'master_distributors' ? 'bg-yellow-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Master Distributors
          </button>
          <button
            onClick={() => setFilter('distributors')}
            className={`px-4 py-2 rounded-lg font-medium ${
              filter === 'distributors' ? 'bg-yellow-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Distributors
          </button>
          <button
            onClick={() => setFilter('retailers')}
            className={`px-4 py-2 rounded-lg font-medium ${
              filter === 'retailers' ? 'bg-yellow-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Retailers
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-600"></div>
            <p className="mt-2 text-gray-600">Loading pending verifications...</p>
          </div>
        ) : pendingPartners.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Clock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No Pending Verifications</h3>
            <p className="text-gray-600">All partners have been reviewed.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Partner ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Submitted
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {pendingPartners.map((partner) => (
                    <tr key={partner.partner_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {partner.partner_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {partner.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {getPartnerTypeLabel(partner.partner_type)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {partner.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {partner.phone}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(partner.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setSelectedPartner(partner)}
                            className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                          >
                            <Eye className="w-4 h-4" />
                            View
                          </button>
                          <button
                            onClick={() => handleApprove(partner)}
                            disabled={processing === partner.partner_id}
                            className="text-green-600 hover:text-green-900 flex items-center gap-1 disabled:opacity-50"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Approve
                          </button>
                          <button
                            onClick={() => handleRejectClick(partner)}
                            disabled={processing === partner.partner_id}
                            className="text-red-600 hover:text-red-900 flex items-center gap-1 disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" />
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Document View Modal */}
        {selectedPartner && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold">Partner Documents - {selectedPartner.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">{selectedPartner.partner_id} • {getPartnerTypeLabel(selectedPartner.partner_type)}</p>
                  </div>
                  <button
                    onClick={() => setSelectedPartner(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* AADHAR */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="border-2 border-gray-200 rounded-xl p-6 bg-gradient-to-br from-white to-gray-50 hover:shadow-lg transition-all duration-300"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="text-lg font-bold text-gray-900 mb-1">AADHAR Details</h4>
                      <p className="text-sm text-gray-600">Number: <span className="font-semibold text-gray-900">{selectedPartner.aadhar_number || 'N/A'}</span></p>
                    </div>
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                      <FileText className="w-6 h-6 text-blue-600" />
                    </div>
                  </div>
                  {selectedPartner.aadhar_attachment_url && (
                    <div className="flex gap-3">
                      <button
                        onClick={() => openDocumentViewer(selectedPartner.aadhar_attachment_url!, 'AADHAR Document')}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg"
                      >
                        <Eye className="w-4 h-4" />
                        Preview
                      </button>
                      <button
                        onClick={() => handleDownload(selectedPartner.aadhar_attachment_url!, `AADHAR_${selectedPartner.partner_id}.${selectedPartner.aadhar_attachment_url!.split('.').pop()}`)}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors shadow-md hover:shadow-lg"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                    </div>
                  )}
                </motion.div>

                {/* PAN */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="border-2 border-gray-200 rounded-xl p-6 bg-gradient-to-br from-white to-gray-50 hover:shadow-lg transition-all duration-300"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="text-lg font-bold text-gray-900 mb-1">PAN Details</h4>
                      <p className="text-sm text-gray-600">Number: <span className="font-semibold text-gray-900">{selectedPartner.pan_number || 'N/A'}</span></p>
                    </div>
                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                      <FileText className="w-6 h-6 text-green-600" />
                    </div>
                  </div>
                  {selectedPartner.pan_attachment_url && (
                    <div className="flex gap-3">
                      <button
                        onClick={() => openDocumentViewer(selectedPartner.pan_attachment_url!, 'PAN Document')}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-md hover:shadow-lg"
                      >
                        <Eye className="w-4 h-4" />
                        Preview
                      </button>
                      <button
                        onClick={() => handleDownload(selectedPartner.pan_attachment_url!, `PAN_${selectedPartner.partner_id}.${selectedPartner.pan_attachment_url!.split('.').pop()}`)}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors shadow-md hover:shadow-lg"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                    </div>
                  )}
                </motion.div>

                {/* UDHYAM */}
                {selectedPartner.udhyam_number && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="border-2 border-gray-200 rounded-xl p-6 bg-gradient-to-br from-white to-gray-50 hover:shadow-lg transition-all duration-300"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="text-lg font-bold text-gray-900 mb-1">UDHYAM Details</h4>
                        <p className="text-sm text-gray-600">Number: <span className="font-semibold text-gray-900">{selectedPartner.udhyam_number}</span></p>
                      </div>
                      <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                        <FileText className="w-6 h-6 text-purple-600" />
                      </div>
                    </div>
                    {selectedPartner.udhyam_certificate_url && (
                      <div className="flex gap-3">
                        <button
                          onClick={() => openDocumentViewer(selectedPartner.udhyam_certificate_url!, 'UDHYAM Certificate')}
                          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shadow-md hover:shadow-lg"
                        >
                          <Eye className="w-4 h-4" />
                          Preview
                        </button>
                        <button
                          onClick={() => handleDownload(selectedPartner.udhyam_certificate_url!, `UDHYAM_${selectedPartner.partner_id}.${selectedPartner.udhyam_certificate_url!.split('.').pop()}`)}
                          className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors shadow-md hover:shadow-lg"
                        >
                          <Download className="w-4 h-4" />
                          Download
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* GST */}
                {selectedPartner.gst_number && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="border-2 border-gray-200 rounded-xl p-6 bg-gradient-to-br from-white to-gray-50 hover:shadow-lg transition-all duration-300"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="text-lg font-bold text-gray-900 mb-1">GST Details</h4>
                        <p className="text-sm text-gray-600">Number: <span className="font-semibold text-gray-900">{selectedPartner.gst_number}</span></p>
                      </div>
                      <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                        <FileText className="w-6 h-6 text-orange-600" />
                      </div>
                    </div>
                    {selectedPartner.gst_certificate_url && (
                      <div className="flex gap-3">
                        <button
                          onClick={() => openDocumentViewer(selectedPartner.gst_certificate_url!, 'GST Certificate')}
                          className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors shadow-md hover:shadow-lg"
                        >
                          <Eye className="w-4 h-4" />
                          Preview
                        </button>
                        <button
                          onClick={() => handleDownload(selectedPartner.gst_certificate_url!, `GST_${selectedPartner.partner_id}.${selectedPartner.gst_certificate_url!.split('.').pop()}`)}
                          className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors shadow-md hover:shadow-lg"
                        >
                          <Download className="w-4 h-4" />
                          Download
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}

                <div className="flex gap-3 pt-6 border-t border-gray-200">
                  <button
                    onClick={() => setSelectedPartner(null)}
                    className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 font-semibold transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => handleRejectClick(selectedPartner)}
                    disabled={processing === selectedPartner.partner_id}
                    className="flex-1 px-6 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 font-semibold transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <XCircle className="w-5 h-5" />
                    Reject
                  </button>
                  <button
                    onClick={() => {
                      setSelectedPartner(null)
                      handleApprove(selectedPartner)
                    }}
                    disabled={processing === selectedPartner.partner_id}
                    className="flex-1 px-6 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 font-semibold transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="w-5 h-5" />
                    Approve
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Document Viewer Modal */}
        <AnimatePresence>
          {viewingDocument && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4"
              onClick={() => setViewingDocument(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[95vh] overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-center justify-between p-4 bg-gradient-to-r from-gray-900 to-gray-800 text-white">
                  <div className="flex items-center gap-3">
                    {viewingDocument.type === 'image' ? (
                      <ImageIcon className="w-6 h-6" />
                    ) : (
                      <FileText className="w-6 h-6" />
                    )}
                    <h3 className="text-lg font-bold">{viewingDocument.name}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {viewingDocument.type === 'image' && (
                      <>
                        <button
                          onClick={() => setImageZoom(Math.max(0.5, imageZoom - 0.25))}
                          className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                          title="Zoom Out"
                        >
                          <ZoomOut className="w-5 h-5" />
                        </button>
                        <span className="text-sm font-medium min-w-[60px] text-center">{Math.round(imageZoom * 100)}%</span>
                        <button
                          onClick={() => setImageZoom(Math.min(3, imageZoom + 0.25))}
                          className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                          title="Zoom In"
                        >
                          <ZoomIn className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => setImageRotation((prev) => (prev + 90) % 360)}
                          className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                          title="Rotate"
                        >
                          <RotateCw className="w-5 h-5" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDownload(viewingDocument.url, viewingDocument.name)}
                      className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                      title="Download"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => setViewingDocument(null)}
                      className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Document Content */}
                <div className="relative bg-gray-900 flex items-center justify-center overflow-auto" style={{ height: 'calc(95vh - 80px)' }}>
                  {viewingDocument.type === 'image' ? (
                    <motion.div
                      animate={{ scale: imageZoom, rotate: imageRotation }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      className="relative"
                    >
                      <img
                        src={viewingDocument.url}
                        alt={viewingDocument.name}
                        className="max-w-full max-h-[85vh] object-contain"
                        draggable={false}
                      />
                    </motion.div>
                  ) : viewingDocument.type === 'pdf' ? (
                    <iframe
                      src={viewingDocument.url}
                      className="w-full h-full min-h-[600px]"
                      title={viewingDocument.name}
                    />
                  ) : (
                    <div className="text-center text-white p-12">
                      <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p className="text-lg mb-4">Preview not available for this file type</p>
                      <button
                        onClick={() => handleDownload(viewingDocument.url, viewingDocument.name)}
                        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 mx-auto"
                      >
                        <Download className="w-5 h-5" />
                        Download to View
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Reject Modal */}
        <AnimatePresence>
          {showRejectModal && rejectingPartner && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
              onClick={() => {
                setShowRejectModal(false)
                setRejectingPartner(null)
                setRejectReason('')
              }}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-900">Reject Partner</h3>
                  <button
                    onClick={() => {
                      setShowRejectModal(false)
                      setRejectingPartner(null)
                      setRejectReason('')
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-2">
                    Partner: <span className="font-semibold text-gray-900">{rejectingPartner.name}</span>
                  </p>
                  <p className="text-sm text-gray-600">
                    ID: <span className="font-semibold text-gray-900">{rejectingPartner.partner_id}</span>
                  </p>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason for Rejection <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Please provide a detailed reason for rejection..."
                    rows={4}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">This reason will be visible to the partner.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowRejectModal(false)
                      setRejectingPartner(null)
                      setRejectReason('')
                    }}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={!rejectReason.trim() || processing === rejectingPartner.partner_id}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {processing === rejectingPartner.partner_id ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Rejecting...
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4" />
                        Reject Partner
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

