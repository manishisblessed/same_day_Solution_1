'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase/client'
import { 
  Building2, Plus, Edit, Trash2, Eye, Globe, Search,
  Upload, CheckCircle2, XCircle, Clock, ExternalLink,
  Palette, Image as ImageIcon, Link as LinkIcon, Star,
  Crown, Users, Package, BadgeCheck, Shield, Zap
} from 'lucide-react'

interface Partner {
  id: string
  name: string
  logo_url: string
  subdomain: string
  status: 'active' | 'pending' | 'suspended'
  primary_color: string
  secondary_color: string
  contact_email: string
  contact_phone: string
  created_at: string
  total_retailers: number
  total_transactions: number
  monthly_volume: number
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'pending' | 'suspended'>('all')
  const [formData, setFormData] = useState({
    name: '',
    subdomain: '',
    primary_color: '#F59E0B',
    secondary_color: '#10B981',
    contact_email: '',
    contact_phone: '',
    logo_url: ''
  })

  useEffect(() => {
    fetchPartners()
  }, [])

  const fetchPartners = async () => {
    setLoading(true)
    try {
      // For now, using mock data - in production, fetch from partners table
      const mockPartners: Partner[] = [
        {
          id: '1',
          name: 'PayZone India',
          logo_url: '/logos/payzone.png',
          subdomain: 'payzone',
          status: 'active',
          primary_color: '#3B82F6',
          secondary_color: '#10B981',
          contact_email: 'partner@payzone.in',
          contact_phone: '9876543210',
          created_at: new Date().toISOString(),
          total_retailers: 150,
          total_transactions: 25000,
          monthly_volume: 5000000
        },
        {
          id: '2',
          name: 'QuickPay Services',
          logo_url: '/logos/quickpay.png',
          subdomain: 'quickpay',
          status: 'active',
          primary_color: '#8B5CF6',
          secondary_color: '#F59E0B',
          contact_email: 'contact@quickpay.in',
          contact_phone: '9876543211',
          created_at: new Date().toISOString(),
          total_retailers: 75,
          total_transactions: 12000,
          monthly_volume: 2500000
        }
      ]
      setPartners(mockPartners)
    } catch (error) {
      console.error('Error fetching partners:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Implementation for creating/updating partner
    setShowModal(false)
    setEditingPartner(null)
    setFormData({
      name: '',
      subdomain: '',
      primary_color: '#F59E0B',
      secondary_color: '#10B981',
      contact_email: '',
      contact_phone: '',
      logo_url: ''
    })
    fetchPartners()
  }

  const filteredPartners = partners.filter(partner => {
    const matchesSearch = partner.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         partner.subdomain.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesFilter = filter === 'all' || partner.status === filter
    return matchesSearch && matchesFilter
  })

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-lg">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                Partners Management
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Co-branding partners powered by <span className="font-semibold text-amber-600">AbheePay</span>
              </p>
            </div>
          </div>
        </motion.div>

        {/* Info Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10 border border-amber-200 dark:border-amber-800 rounded-2xl p-6"
        >
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-500 rounded-xl">
              <Star className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-gray-900 dark:text-white text-lg mb-2">
                Partner Co-Branding Program
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                Partners get a custom subdomain (partner.samedaysolution.co.in), their logo displayed, and 
                "Powered by AbheePay" branding. They can expand their reach with Same Day Solution's full suite of financial services.
              </p>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="w-4 h-4 text-amber-600" />
                  <span className="text-gray-700 dark:text-gray-300">Custom subdomain</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <ImageIcon className="w-4 h-4 text-amber-600" />
                  <span className="text-gray-700 dark:text-gray-300">Partner logo displayed</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Palette className="w-4 h-4 text-amber-600" />
                  <span className="text-gray-700 dark:text-gray-300">Custom theme colors</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Shield className="w-4 h-4 text-amber-600" />
                  <span className="text-gray-700 dark:text-gray-300">Powered by AbheePay</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6"
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Total Partners</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{partners.length}</p>
              </div>
              <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Active Partners</p>
                <p className="text-3xl font-bold text-green-600">{partners.filter(p => p.status === 'active').length}</p>
              </div>
              <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-xl">
                <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Total Retailers</p>
                <p className="text-3xl font-bold text-purple-600">
                  {partners.reduce((sum, p) => sum + p.total_retailers, 0)}
                </p>
              </div>
              <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-xl">
                <Users className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Monthly Volume</p>
                <p className="text-2xl font-bold text-amber-600">
                  {formatCurrency(partners.reduce((sum, p) => sum + p.monthly_volume, 0))}
                </p>
              </div>
              <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
                <Zap className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Filters & Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex flex-col md:flex-row gap-4 mb-6"
        >
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search partners by name or subdomain..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'active', 'pending', 'suspended'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  filter === f
                    ? 'bg-amber-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-amber-500'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setEditingPartner(null)
              setShowModal(true)
            }}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-amber-500/30 transition-all"
          >
            <Plus className="w-5 h-5" />
            Add Partner
          </button>
        </motion.div>

        {/* Partners Grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {loading ? (
            <div className="col-span-full flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600"></div>
            </div>
          ) : filteredPartners.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <Building2 className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No partners found</h3>
              <p className="text-gray-500 dark:text-gray-400">Add your first co-branding partner to get started.</p>
            </div>
          ) : (
            filteredPartners.map((partner, idx) => (
              <motion.div
                key={partner.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * idx }}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden hover:shadow-2xl transition-all"
              >
                {/* Partner Header with Custom Colors */}
                <div 
                  className="p-6 relative overflow-hidden"
                  style={{ 
                    background: `linear-gradient(135deg, ${partner.primary_color}20, ${partner.secondary_color}20)` 
                  }}
                >
                  <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-20"
                    style={{ background: partner.primary_color, transform: 'translate(30%, -30%)' }}
                  />
                  <div className="flex items-center gap-4">
                    <div 
                      className="w-16 h-16 rounded-xl flex items-center justify-center text-white font-bold text-2xl"
                      style={{ backgroundColor: partner.primary_color }}
                    >
                      {partner.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">{partner.name}</h3>
                      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                        <Globe className="w-4 h-4" />
                        <span>{partner.subdomain}.samedaysolution.co.in</span>
                      </div>
                    </div>
                  </div>
                  <div className="absolute top-4 right-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      partner.status === 'active' 
                        ? 'bg-green-100 text-green-700' 
                        : partner.status === 'pending'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {partner.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Partner Stats */}
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Retailers</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{partner.total_retailers}</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400">Transactions</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{partner.total_transactions.toLocaleString()}</p>
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-lg p-3">
                    <p className="text-xs text-amber-600 dark:text-amber-400">Monthly Volume</p>
                    <p className="text-lg font-bold text-amber-700 dark:text-amber-300">{formatCurrency(partner.monthly_volume)}</p>
                  </div>

                  <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Powered by</p>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-amber-500 rounded-lg">
                        <Shield className="w-4 h-4 text-white" />
                      </div>
                      <span className="font-semibold text-gray-900 dark:text-white">AbheePay</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="px-6 pb-6 flex gap-2">
                  <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                    <Eye className="w-4 h-4" />
                    View
                  </button>
                  <button 
                    onClick={() => {
                      setEditingPartner(partner)
                      setFormData({
                        name: partner.name,
                        subdomain: partner.subdomain,
                        primary_color: partner.primary_color,
                        secondary_color: partner.secondary_color,
                        contact_email: partner.contact_email,
                        contact_phone: partner.contact_phone,
                        logo_url: partner.logo_url
                      })
                      setShowModal(true)
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button className="flex items-center justify-center p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            ))
          )}
        </motion.div>
      </div>

      {/* Add/Edit Partner Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  {editingPartner ? 'Edit Partner' : 'Add New Partner'}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Configure co-branding settings for this partner
                </p>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Partner Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-amber-500 bg-white dark:bg-gray-900"
                    placeholder="Enter partner name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Subdomain
                  </label>
                  <div className="flex">
                    <input
                      type="text"
                      value={formData.subdomain}
                      onChange={(e) => setFormData({ ...formData, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '') })}
                      className="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-l-xl focus:ring-2 focus:ring-amber-500 bg-white dark:bg-gray-900"
                      placeholder="partner-name"
                      required
                    />
                    <span className="px-4 py-3 bg-gray-100 dark:bg-gray-700 border border-l-0 border-gray-200 dark:border-gray-700 rounded-r-xl text-sm text-gray-500 dark:text-gray-400">
                      .samedaysolution.co.in
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Primary Color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={formData.primary_color}
                        onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
                        className="w-12 h-12 rounded-lg border-0 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={formData.primary_color}
                        onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
                        className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Secondary Color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={formData.secondary_color}
                        onChange={(e) => setFormData({ ...formData, secondary_color: e.target.value })}
                        className="w-12 h-12 rounded-lg border-0 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={formData.secondary_color}
                        onChange={(e) => setFormData({ ...formData, secondary_color: e.target.value })}
                        className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    value={formData.contact_email}
                    onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-amber-500 bg-white dark:bg-gray-900"
                    placeholder="partner@example.com"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Contact Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.contact_phone}
                    onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-amber-500 bg-white dark:bg-gray-900"
                    placeholder="9876543210"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Logo URL
                  </label>
                  <input
                    type="url"
                    value={formData.logo_url}
                    onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-amber-500 bg-white dark:bg-gray-900"
                    placeholder="https://example.com/logo.png"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-amber-500/30 transition-all"
                  >
                    {editingPartner ? 'Update Partner' : 'Create Partner'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

