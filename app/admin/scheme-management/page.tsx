'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase/client'
import AdminSidebar from '@/components/AdminSidebar'
import { 
  Plus, Edit2, Trash2, ChevronDown, ChevronUp, Search, Filter,
  Layers, CreditCard, Banknote, TrendingUp, Users, Link2,
  Save, X, AlertCircle, CheckCircle, Globe, Star, Settings, Eye
} from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

interface Scheme {
  id: string
  name: string
  description: string | null
  scheme_type: 'global' | 'golden' | 'custom'
  service_scope: string
  status: string
  priority: number
  created_by_id: string | null
  created_by_role: string | null
  effective_from: string
  effective_to: string | null
  created_at: string
  updated_at: string
  bbps_commissions?: any[]
  payout_charges?: any[]
  mdr_rates?: any[]
  mappings?: any[]
  mapping_count?: number
  // Creator details (resolved from partner tables)
  creator_name?: string | null
  creator_email?: string | null
  creator_role_label?: string | null
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function SchemeManagementPage() {
  const { user } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [schemes, setSchemes] = useState<Scheme[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  
  // Filters
  const [filterType, setFilterType] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('active')
  const [searchQuery, setSearchQuery] = useState('')
  
  // Modal
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedSchemeId, setExpandedSchemeId] = useState<string | null>(null)
  const [editingScheme, setEditingScheme] = useState<Scheme | null>(null)
  
  // Config modals
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configType, setConfigType] = useState<'bbps' | 'payout' | 'mdr'>('bbps')
  const [configSchemeId, setConfigSchemeId] = useState<string>('')
  
  // Mapping modal
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [mappingSchemeId, setMappingSchemeId] = useState<string>('')
  
  // Users for mapping
  const [retailers, setRetailers] = useState<any[]>([])
  const [distributors, setDistributors] = useState<any[]>([])
  const [masterDistributors, setMasterDistributors] = useState<any[]>([])
  
  // ============================================================================
  // FETCH DATA
  // ============================================================================

  const fetchSchemes = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase.from('schemes').select('*').order('priority', { ascending: true })
      if (filterType) query = query.eq('scheme_type', filterType)
      if (filterStatus) query = query.eq('status', filterStatus)
      
      const { data, error } = await query
      if (error) throw error
      
      let filtered = data || []
      if (searchQuery) {
        filtered = filtered.filter(s => 
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
        )
      }
      
      // Fetch mapping counts for each scheme
      const schemeIds = filtered.map(s => s.id)
      if (schemeIds.length > 0) {
        const { data: mappings } = await supabase
          .from('scheme_mappings')
          .select('scheme_id')
          .in('scheme_id', schemeIds)
          .eq('status', 'active')
        
        const mappingCounts: Record<string, number> = {}
        mappings?.forEach(m => {
          mappingCounts[m.scheme_id] = (mappingCounts[m.scheme_id] || 0) + 1
        })
        
        filtered = filtered.map(s => ({
          ...s,
          mapping_count: mappingCounts[s.id] || 0,
        }))
      }

      // Fetch creator details for schemes created by MD/Distributor
      const creatorIds = Array.from(new Set(filtered.filter(s => s.created_by_id).map(s => s.created_by_id)))
      if (creatorIds.length > 0) {
        // Fetch from partner tables in parallel (admin_users don't have partner_id - admin schemes have null created_by_id)
        const [mdData, distData] = await Promise.all([
          supabase.from('master_distributors').select('partner_id, name, business_name, email').in('partner_id', creatorIds),
          supabase.from('distributors').select('partner_id, name, business_name, email').in('partner_id', creatorIds),
        ])

        const creatorMap: Record<string, { name: string; email: string; role_label: string }> = {}
        
        mdData.data?.forEach((md: any) => {
          creatorMap[md.partner_id] = {
            name: md.business_name || md.name,
            email: md.email,
            role_label: 'Master Distributor',
          }
        })
        distData.data?.forEach((d: any) => {
          creatorMap[d.partner_id] = {
            name: d.business_name || d.name,
            email: d.email,
            role_label: 'Distributor',
          }
        })

        filtered = filtered.map(s => ({
          ...s,
          creator_name: s.created_by_id ? creatorMap[s.created_by_id]?.name || null : null,
          creator_email: s.created_by_id ? creatorMap[s.created_by_id]?.email || null : null,
          creator_role_label: s.created_by_id ? creatorMap[s.created_by_id]?.role_label || null : null,
        }))
      }
      
      setSchemes(filtered)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filterType, filterStatus, searchQuery])

  const fetchUsers = useCallback(async () => {
    const [r, d, md] = await Promise.all([
      supabase.from('retailers').select('partner_id, name, email, status').eq('status', 'active'),
      supabase.from('distributors').select('partner_id, name, email, status').eq('status', 'active'),
      supabase.from('master_distributors').select('partner_id, name, email, status').eq('status', 'active'),
    ])
    setRetailers(r.data || [])
    setDistributors(d.data || [])
    setMasterDistributors(md.data || [])
  }, [])

  useEffect(() => {
    fetchSchemes()
    fetchUsers()
  }, [fetchSchemes, fetchUsers])

  // ============================================================================
  // EXPAND SCHEME (load full details)
  // ============================================================================

  const toggleExpand = async (schemeId: string) => {
    if (expandedSchemeId === schemeId) {
      setExpandedSchemeId(null)
      return
    }
    
    // Load full scheme details
    const [bbps, payout, mdr, mappings] = await Promise.all([
      supabase.from('scheme_bbps_commissions').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('min_amount'),
      supabase.from('scheme_payout_charges').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('transfer_mode'),
      supabase.from('scheme_mdr_rates').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('mode'),
      supabase.from('scheme_mappings').select('*').eq('scheme_id', schemeId).eq('status', 'active'),
    ])

    // Resolve entity names for mappings
    let enrichedMappings = mappings.data || []
    if (enrichedMappings.length > 0) {
      const entityIds = enrichedMappings.map((m: any) => m.entity_id)
      const [retNames, distNames, mdNames] = await Promise.all([
        supabase.from('retailers').select('partner_id, name, business_name').in('partner_id', entityIds),
        supabase.from('distributors').select('partner_id, name, business_name').in('partner_id', entityIds),
        supabase.from('master_distributors').select('partner_id, name, business_name').in('partner_id', entityIds),
      ])
      const nameMap: Record<string, string> = {}
      retNames.data?.forEach((r: any) => { nameMap[r.partner_id] = r.business_name || r.name })
      distNames.data?.forEach((d: any) => { nameMap[d.partner_id] = d.business_name || d.name })
      mdNames.data?.forEach((md: any) => { nameMap[md.partner_id] = md.business_name || md.name })
      enrichedMappings = enrichedMappings.map((m: any) => ({ ...m, entity_name: nameMap[m.entity_id] || null }))
    }
    
    setSchemes(prev => prev.map(s => s.id === schemeId ? {
      ...s,
      bbps_commissions: bbps.data || [],
      payout_charges: payout.data || [],
      mdr_rates: mdr.data || [],
      mappings: enrichedMappings,
    } : s))
    
    setExpandedSchemeId(schemeId)
  }

  // ============================================================================
  // CREATE/EDIT SCHEME
  // ============================================================================

  const [schemeForm, setSchemeForm] = useState({
    name: '',
    description: '',
    scheme_type: 'custom' as 'global' | 'golden' | 'custom',
    service_scope: 'all' as string,
    priority: 100,
  })

  const openCreateModal = () => {
    setSchemeForm({ name: '', description: '', scheme_type: 'custom', service_scope: 'all', priority: 100 })
    setEditingScheme(null)
    setShowCreateModal(true)
  }

  const openEditModal = (scheme: Scheme) => {
    setSchemeForm({
      name: scheme.name,
      description: scheme.description || '',
      scheme_type: scheme.scheme_type,
      service_scope: scheme.service_scope,
      priority: scheme.priority,
    })
    setEditingScheme(scheme)
    setShowCreateModal(true)
  }

  const handleSaveScheme = async () => {
    try {
      if (editingScheme) {
        const { error } = await supabase.from('schemes').update({
          name: schemeForm.name,
          description: schemeForm.description || null,
          scheme_type: schemeForm.scheme_type,
          service_scope: schemeForm.service_scope,
          priority: schemeForm.priority,
        }).eq('id', editingScheme.id)
        if (error) throw error
        setSuccess('Scheme updated successfully')
      } else {
        const { error } = await supabase.from('schemes').insert({
          name: schemeForm.name,
          description: schemeForm.description || null,
          scheme_type: schemeForm.scheme_type,
          service_scope: schemeForm.service_scope,
          priority: schemeForm.priority,
          created_by_id: user?.partner_id || null,
          created_by_role: user?.role || 'admin',
          status: 'active',
        })
        if (error) throw error
        setSuccess('Scheme created successfully')
      }
      setShowCreateModal(false)
      fetchSchemes()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDeleteScheme = async (id: string) => {
    if (!confirm('Delete this scheme? All associated configs and mappings will be removed.')) return
    try {
      const { error } = await supabase.from('schemes').delete().eq('id', id)
      if (error) throw error
      setSuccess('Scheme deleted')
      fetchSchemes()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleToggleStatus = async (scheme: Scheme) => {
    const newStatus = scheme.status === 'active' ? 'inactive' : 'active'
    const { error } = await supabase.from('schemes').update({ status: newStatus }).eq('id', scheme.id)
    if (!error) fetchSchemes()
  }

  // ============================================================================
  // CONFIG MODALS (BBPS / Payout / MDR)
  // ============================================================================

  const [bbpsForm, setBbpsForm] = useState({
    category: '',
    min_amount: 0,
    max_amount: 999999999,
    retailer_charge: 0,
    retailer_charge_type: 'flat' as 'flat' | 'percentage',
    retailer_commission: 0,
    retailer_commission_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
    company_charge: 0,
    company_charge_type: 'flat' as 'flat' | 'percentage',
  })

  const [payoutForm, setPayoutForm] = useState({
    transfer_mode: 'IMPS' as 'IMPS' | 'NEFT',
    min_amount: 0,
    max_amount: 999999999,
    retailer_charge: 0,
    retailer_charge_type: 'flat' as 'flat' | 'percentage',
    retailer_commission: 0,
    retailer_commission_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
    company_charge: 0,
    company_charge_type: 'flat' as 'flat' | 'percentage',
  })

  const [mdrForm, setMdrForm] = useState({
    mode: 'CARD' as 'CARD' | 'UPI',
    card_type: '' as string,
    brand_type: '',
    retailer_mdr_t1: 0,
    retailer_mdr_t0: 0,
    distributor_mdr_t1: 0,
    distributor_mdr_t0: 0,
    md_mdr_t1: 0,
    md_mdr_t0: 0,
  })

  const openConfigModal = (schemeId: string, type: 'bbps' | 'payout' | 'mdr') => {
    setConfigSchemeId(schemeId)
    setConfigType(type)
    // Reset forms
    setBbpsForm({ category: '', min_amount: 0, max_amount: 999999999, retailer_charge: 0, retailer_charge_type: 'flat', retailer_commission: 0, retailer_commission_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat', company_charge: 0, company_charge_type: 'flat' })
    setPayoutForm({ transfer_mode: 'IMPS', min_amount: 0, max_amount: 999999999, retailer_charge: 0, retailer_charge_type: 'flat', retailer_commission: 0, retailer_commission_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat', company_charge: 0, company_charge_type: 'flat' })
    setMdrForm({ mode: 'CARD', card_type: '', brand_type: '', retailer_mdr_t1: 0, retailer_mdr_t0: 0, distributor_mdr_t1: 0, distributor_mdr_t0: 0, md_mdr_t1: 0, md_mdr_t0: 0 })
    setShowConfigModal(true)
  }

  const handleSaveConfig = async () => {
    try {
      if (configType === 'bbps') {
        const { error } = await supabase.from('scheme_bbps_commissions').insert({
          scheme_id: configSchemeId,
          category: bbpsForm.category || null,
          min_amount: bbpsForm.min_amount,
          max_amount: bbpsForm.max_amount,
          retailer_charge: bbpsForm.retailer_charge,
          retailer_charge_type: bbpsForm.retailer_charge_type,
          retailer_commission: bbpsForm.retailer_commission,
          retailer_commission_type: bbpsForm.retailer_commission_type,
          distributor_commission: bbpsForm.distributor_commission,
          distributor_commission_type: bbpsForm.distributor_commission_type,
          md_commission: bbpsForm.md_commission,
          md_commission_type: bbpsForm.md_commission_type,
          company_charge: bbpsForm.company_charge,
          company_charge_type: bbpsForm.company_charge_type,
          status: 'active',
        })
        if (error) throw error
      } else if (configType === 'payout') {
        const { error } = await supabase.from('scheme_payout_charges').insert({
          scheme_id: configSchemeId,
          transfer_mode: payoutForm.transfer_mode,
          min_amount: payoutForm.min_amount,
          max_amount: payoutForm.max_amount,
          retailer_charge: payoutForm.retailer_charge,
          retailer_charge_type: payoutForm.retailer_charge_type,
          retailer_commission: payoutForm.retailer_commission,
          retailer_commission_type: payoutForm.retailer_commission_type,
          distributor_commission: payoutForm.distributor_commission,
          distributor_commission_type: payoutForm.distributor_commission_type,
          md_commission: payoutForm.md_commission,
          md_commission_type: payoutForm.md_commission_type,
          company_charge: payoutForm.company_charge,
          company_charge_type: payoutForm.company_charge_type,
          status: 'active',
        })
        if (error) throw error
      } else if (configType === 'mdr') {
        const { error } = await supabase.from('scheme_mdr_rates').insert({
          scheme_id: configSchemeId,
          mode: mdrForm.mode,
          card_type: mdrForm.card_type || null,
          brand_type: mdrForm.brand_type || null,
          retailer_mdr_t1: mdrForm.retailer_mdr_t1,
          retailer_mdr_t0: mdrForm.retailer_mdr_t0,
          distributor_mdr_t1: mdrForm.distributor_mdr_t1,
          distributor_mdr_t0: mdrForm.distributor_mdr_t0,
          md_mdr_t1: mdrForm.md_mdr_t1,
          md_mdr_t0: mdrForm.md_mdr_t0,
          status: 'active',
        })
        if (error) throw error
      }
      setSuccess(`${configType.toUpperCase()} config added successfully`)
      setShowConfigModal(false)
      // Refresh expanded scheme
      if (expandedSchemeId === configSchemeId) {
        toggleExpand(configSchemeId)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDeleteConfig = async (table: string, id: string) => {
    if (!confirm('Delete this configuration?')) return
    try {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
      setSuccess('Config deleted')
      if (expandedSchemeId) toggleExpand(expandedSchemeId)
    } catch (err: any) {
      setError(err.message)
    }
  }

  // ============================================================================
  // MAPPING
  // ============================================================================

  const [mappingForm, setMappingForm] = useState({
    entity_id: '',
    entity_role: 'retailer' as string,
    service_type: 'all' as string,
  })

  const openMappingModal = (schemeId: string) => {
    setMappingSchemeId(schemeId)
    setMappingForm({ entity_id: '', entity_role: 'retailer', service_type: 'all' })
    setShowMappingModal(true)
  }

  const handleSaveMapping = async () => {
    try {
      // Deactivate existing active mapping for this entity
      await supabase
        .from('scheme_mappings')
        .update({ status: 'inactive' })
        .eq('entity_id', mappingForm.entity_id)
        .eq('entity_role', mappingForm.entity_role)
        .eq('status', 'active')

      const { error } = await supabase.from('scheme_mappings').insert({
        scheme_id: mappingSchemeId,
        entity_id: mappingForm.entity_id,
        entity_role: mappingForm.entity_role,
        service_type: mappingForm.service_type || null,
        assigned_by_id: user?.partner_id,
        assigned_by_role: user?.role || 'admin',
        status: 'active',
        priority: 100,
      })
      if (error) throw error
      setSuccess('Scheme mapped successfully')
      setShowMappingModal(false)
      fetchSchemes()
      if (expandedSchemeId) toggleExpand(expandedSchemeId)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDeleteMapping = async (id: string) => {
    if (!confirm('Remove this mapping?')) return
    try {
      const { error } = await supabase.from('scheme_mappings').update({ status: 'inactive' }).eq('id', id)
      if (error) throw error
      setSuccess('Mapping removed')
      if (expandedSchemeId) toggleExpand(expandedSchemeId)
      fetchSchemes()
    } catch (err: any) {
      setError(err.message)
    }
  }

  // Get user list based on selected role
  const getUsersForRole = (role: string) => {
    if (role === 'retailer') return retailers
    if (role === 'distributor') return distributors
    if (role === 'master_distributor') return masterDistributors
    return []
  }

  // Get available brands based on mode and card type
  const getAvailableBrands = (mode: string, cardType: string): string[] => {
    if (mode === 'CARD') {
      if (cardType === 'CREDIT') {
        return ['Amex', 'Diners Club', 'MasterCard', 'RUPAY', 'VISA', 'Business', 'Corporate Card', 'International']
      } else if (cardType === 'DEBIT') {
        return ['MasterCard', 'RUPAY', 'VISA']
      } else if (cardType === 'PREPAID') {
        return ['MasterCard', 'VISA']
      }
      return []
    } else if (mode === 'UPI') {
      // For UPI mode, treat empty card_type as 'UPI'
      const effectiveCardType = cardType || 'UPI'
      if (effectiveCardType === 'UPI') {
        return ['UPI']
      } else if (effectiveCardType === 'CREDIT') {
        return ['RUPAY']
      }
      return []
    }
    return []
  }

  // Auto-clear messages
  useEffect(() => {
    if (error || success) {
      const t = setTimeout(() => { setError(''); setSuccess(''); }, 4000)
      return () => clearTimeout(t)
    }
  }, [error, success])

  // ============================================================================
  // RENDER
  // ============================================================================

  const schemeTypeColor = (type: string) => {
    switch (type) {
      case 'global': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
      case 'golden': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
      case 'custom': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const schemeTypeIcon = (type: string) => {
    switch (type) {
      case 'global': return <Globe className="w-4 h-4" />
      case 'golden': return <Star className="w-4 h-4" />
      case 'custom': return <Settings className="w-4 h-4" />
      default: return <Layers className="w-4 h-4" />
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <main className="flex-1 lg:ml-56 p-4 md:p-6 pt-20">
        {/* Header - Sticky to prevent hiding */}
        <div className="mb-6 sticky top-20 z-10 bg-gray-50 dark:bg-gray-950 pb-4 -mx-4 md:-mx-6 px-4 md:px-6 pt-2 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Layers className="w-7 h-7 text-primary-600" />
                Scheme Management
              </h1>
              <p className="text-sm text-gray-500 mt-1">Manage Global, Golden &amp; Custom schemes with BBPS, Payout &amp; MDR configurations</p>
            </div>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-secondary-600 text-white rounded-lg hover:opacity-90 transition font-medium text-sm whitespace-nowrap flex-shrink-0"
            >
              <Plus className="w-4 h-4" /> Create Scheme
            </button>
          </div>

          {/* Alerts */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400 text-sm">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2 text-green-700 dark:text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" /> {success}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search schemes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm"
            >
              <option value="">All Types</option>
              <option value="global">Global</option>
              <option value="golden">Golden</option>
              <option value="custom">Custom</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="draft">Draft</option>
            </select>
          </div>
        </div>

        {/* Schemes List */}
        <div className="pt-6">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading schemes...</div>
        ) : schemes.length === 0 ? (
          <div className="text-center py-12">
            <Layers className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">No schemes found. Create your first scheme.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {schemes.map((scheme) => (
              <div key={scheme.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
                {/* Scheme Header */}
                <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50" onClick={() => toggleExpand(scheme.id)}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${schemeTypeColor(scheme.scheme_type)}`}>
                      {schemeTypeIcon(scheme.scheme_type)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">{scheme.name}</h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${schemeTypeColor(scheme.scheme_type)}`}>
                          {scheme.scheme_type}
                        </span>
                        <span className="text-xs text-gray-500">Scope: {scheme.service_scope}</span>
                        <span className="text-xs text-gray-500">Priority: {scheme.priority}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${scheme.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {scheme.status}
                        </span>
                        {scheme.mapping_count ? (
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <Users className="w-3 h-3" /> {scheme.mapping_count} mapped
                          </span>
                        ) : null}
                        {/* Creator Info */}
                        {scheme.creator_name && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            scheme.creator_role_label === 'Master Distributor'
                              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                              : scheme.creator_role_label === 'Distributor'
                              ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
                              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                          }`} title={`Created by ${scheme.creator_name} (${scheme.creator_email || ''}) - ${scheme.creator_role_label}`}>
                            <Users className="w-3 h-3" />
                            {scheme.creator_role_label}: {scheme.creator_name}
                          </span>
                        )}
                        {scheme.created_by_role && !scheme.creator_name && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400" title={`Created by: ${scheme.created_by_id || 'Unknown'}`}>
                            <Users className="w-3 h-3" />
                            {scheme.created_by_role === 'master_distributor' ? 'MD' : scheme.created_by_role === 'distributor' ? 'Distributor' : scheme.created_by_role}: {scheme.created_by_id || 'Unknown'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'bbps') }}
                      className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600" title="Add BBPS Config">
                      <CreditCard className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'payout') }}
                      className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600" title="Add Payout Config">
                      <Banknote className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'mdr') }}
                      className="p-1.5 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 text-orange-600" title="Add MDR Config">
                      <TrendingUp className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); openMappingModal(scheme.id) }}
                      className="p-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-600" title="Map to User">
                      <Link2 className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); openEditModal(scheme) }}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600" title="Edit">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleToggleStatus(scheme) }}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600" title="Toggle Status">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteScheme(scheme.id) }}
                      className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {expandedSchemeId === scheme.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedSchemeId === scheme.id && (
                  <div className="border-t border-gray-200 dark:border-gray-800 p-4 space-y-4 bg-gray-50 dark:bg-gray-800/30">
                    {scheme.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 italic">{scheme.description}</p>
                    )}

                    {/* Creator Info Card */}
                    {scheme.created_by_id && (
                      <div className={`rounded-lg border p-3 ${
                        scheme.created_by_role === 'master_distributor'
                          ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-800'
                          : scheme.created_by_role === 'distributor'
                          ? 'bg-teal-50 border-teal-200 dark:bg-teal-900/20 dark:border-teal-800'
                          : 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Users className={`w-4 h-4 ${
                            scheme.created_by_role === 'master_distributor'
                              ? 'text-indigo-600 dark:text-indigo-400'
                              : scheme.created_by_role === 'distributor'
                              ? 'text-teal-600 dark:text-teal-400'
                              : 'text-gray-600 dark:text-gray-400'
                          }`} />
                          <span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Created By</span>
                        </div>
                        <div className="flex items-center gap-4 flex-wrap">
                          <div>
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                              {scheme.creator_name || scheme.created_by_id}
                            </span>
                            {scheme.creator_email && (
                              <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                                ({scheme.creator_email})
                              </span>
                            )}
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            scheme.created_by_role === 'master_distributor'
                              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-800 dark:text-indigo-300'
                              : scheme.created_by_role === 'distributor'
                              ? 'bg-teal-100 text-teal-700 dark:bg-teal-800 dark:text-teal-300'
                              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                          }`}>
                            {scheme.creator_role_label || scheme.created_by_role}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            ID: {scheme.created_by_id}
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* BBPS Commissions */}
                    <div>
                      <h4 className="font-semibold text-sm text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1">
                        <CreditCard className="w-4 h-4" /> BBPS Commissions ({scheme.bbps_commissions?.length || 0})
                      </h4>
                      {scheme.bbps_commissions && scheme.bbps_commissions.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-blue-50 dark:bg-blue-900/20">
                                <th className="px-2 py-1.5 text-left">Category</th>
                                <th className="px-2 py-1.5 text-left">Slab</th>
                                <th className="px-2 py-1.5 text-right">Retailer Charge</th>
                                <th className="px-2 py-1.5 text-right">Retailer Comm</th>
                                <th className="px-2 py-1.5 text-right">Dist Comm</th>
                                <th className="px-2 py-1.5 text-right">MD Comm</th>
                                <th className="px-2 py-1.5 text-right">Company</th>
                                <th className="px-2 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {scheme.bbps_commissions.map((c: any) => (
                                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                  <td className="px-2 py-1.5">{c.category || 'All'}</td>
                                  <td className="px-2 py-1.5">{`₹${c.min_amount} - ₹${c.max_amount >= 999999 ? '∞' : c.max_amount}`}</td>
                                  <td className="px-2 py-1.5 text-right">{c.retailer_charge}{c.retailer_charge_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.retailer_commission}{c.retailer_commission_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.distributor_commission}{c.distributor_commission_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.md_commission}{c.md_commission_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.company_charge}{c.company_charge_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">
                                    <button onClick={() => handleDeleteConfig('scheme_bbps_commissions', c.id)} className="text-red-400 hover:text-red-600">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No BBPS commissions configured</p>
                      )}
                    </div>

                    {/* Payout Charges */}
                    <div>
                      <h4 className="font-semibold text-sm text-green-700 dark:text-green-400 mb-2 flex items-center gap-1">
                        <Banknote className="w-4 h-4" /> Payout Charges ({scheme.payout_charges?.length || 0})
                      </h4>
                      {scheme.payout_charges && scheme.payout_charges.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-green-50 dark:bg-green-900/20">
                                <th className="px-2 py-1.5 text-left">Mode</th>
                                <th className="px-2 py-1.5 text-left">Slab</th>
                                <th className="px-2 py-1.5 text-right">Retailer Charge</th>
                                <th className="px-2 py-1.5 text-right">Retailer Comm</th>
                                <th className="px-2 py-1.5 text-right">Dist Comm</th>
                                <th className="px-2 py-1.5 text-right">MD Comm</th>
                                <th className="px-2 py-1.5 text-right">Company</th>
                                <th className="px-2 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {scheme.payout_charges.map((c: any) => (
                                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                  <td className="px-2 py-1.5 font-medium">{c.transfer_mode}</td>
                                  <td className="px-2 py-1.5">{`₹${c.min_amount} - ₹${c.max_amount >= 999999 ? '∞' : c.max_amount}`}</td>
                                  <td className="px-2 py-1.5 text-right">{c.retailer_charge}{c.retailer_charge_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.retailer_commission}{c.retailer_commission_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.distributor_commission}{c.distributor_commission_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.md_commission}{c.md_commission_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.company_charge}{c.company_charge_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">
                                    <button onClick={() => handleDeleteConfig('scheme_payout_charges', c.id)} className="text-red-400 hover:text-red-600">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No Payout charges configured</p>
                      )}
                    </div>

                    {/* MDR Rates */}
                    <div>
                      <h4 className="font-semibold text-sm text-orange-700 dark:text-orange-400 mb-2 flex items-center gap-1">
                        <TrendingUp className="w-4 h-4" /> MDR Rates ({scheme.mdr_rates?.length || 0})
                      </h4>
                      {scheme.mdr_rates && scheme.mdr_rates.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-orange-50 dark:bg-orange-900/20">
                                <th className="px-2 py-1.5 text-left">Mode</th>
                                <th className="px-2 py-1.5 text-left">Card Type</th>
                                <th className="px-2 py-1.5 text-left">Brand Type</th>
                                <th className="px-2 py-1.5 text-right">RT T+1</th>
                                <th className="px-2 py-1.5 text-right">RT T+0</th>
                                <th className="px-2 py-1.5 text-right">DT T+1</th>
                                <th className="px-2 py-1.5 text-right">DT T+0</th>
                                <th className="px-2 py-1.5 text-right">MD T+1</th>
                                <th className="px-2 py-1.5 text-right">MD T+0</th>
                                <th className="px-2 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {scheme.mdr_rates.map((r: any) => (
                                <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700">
                                  <td className="px-2 py-1.5 font-medium">{r.mode}</td>
                                  <td className="px-2 py-1.5">{r.card_type || '-'}</td>
                                  <td className="px-2 py-1.5">{r.brand_type || '-'}</td>
                                  <td className="px-2 py-1.5 text-right">{r.retailer_mdr_t1}%</td>
                                  <td className="px-2 py-1.5 text-right">{r.retailer_mdr_t0}%</td>
                                  <td className="px-2 py-1.5 text-right">{r.distributor_mdr_t1}%</td>
                                  <td className="px-2 py-1.5 text-right">{r.distributor_mdr_t0}%</td>
                                  <td className="px-2 py-1.5 text-right">{r.md_mdr_t1}%</td>
                                  <td className="px-2 py-1.5 text-right">{r.md_mdr_t0}%</td>
                                  <td className="px-2 py-1.5 text-right">
                                    <button onClick={() => handleDeleteConfig('scheme_mdr_rates', r.id)} className="text-red-400 hover:text-red-600">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No MDR rates configured</p>
                      )}
                    </div>

                    {/* Mappings */}
                    <div>
                      <h4 className="font-semibold text-sm text-purple-700 dark:text-purple-400 mb-2 flex items-center gap-1">
                        <Link2 className="w-4 h-4" /> Mappings ({scheme.mappings?.length || 0})
                      </h4>
                      {scheme.mappings && scheme.mappings.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {scheme.mappings.map((m: any) => (
                            <div key={m.id} className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-xs">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                m.entity_role === 'retailer' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                m.entity_role === 'distributor' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' :
                                'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                              }`}>{m.entity_role === 'master_distributor' ? 'MD' : m.entity_role}</span>
                              {m.entity_name && (
                                <span className="font-semibold text-gray-900 dark:text-white">{m.entity_name}</span>
                              )}
                              <span className="text-gray-500 dark:text-gray-400">({m.entity_id})</span>
                              {m.service_type && <span className="text-purple-600">• {m.service_type}</span>}
                              <button onClick={() => handleDeleteMapping(m.id)} className="text-red-400 hover:text-red-600 ml-1">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No mappings - this scheme is not assigned to any user</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        </div>

        {/* ================================================================ */}
        {/* CREATE/EDIT SCHEME MODAL */}
        {/* ================================================================ */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold mb-4">{editingScheme ? 'Edit Scheme' : 'Create Scheme'}</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Scheme Name</label>
                  <input type="text" value={schemeForm.name} onChange={(e) => setSchemeForm({ ...schemeForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="e.g., Premium Retailer Plan" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea value={schemeForm.description} onChange={(e) => setSchemeForm({ ...schemeForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" rows={2} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Type</label>
                    <select value={schemeForm.scheme_type} onChange={(e) => setSchemeForm({ ...schemeForm, scheme_type: e.target.value as any })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                      <option value="global">Global</option>
                      <option value="golden">Golden</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Service Scope</label>
                    <select value={schemeForm.service_scope} onChange={(e) => setSchemeForm({ ...schemeForm, service_scope: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                      <option value="all">All Services</option>
                      <option value="bbps">BBPS Only</option>
                      <option value="payout">Payout Only</option>
                      <option value="mdr">MDR Only</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Priority (lower = higher priority)</label>
                  <input type="number" value={schemeForm.priority} onChange={(e) => setSchemeForm({ ...schemeForm, priority: parseInt(e.target.value) || 100 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSaveScheme} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                  {editingScheme ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* CONFIG MODAL (BBPS / Payout / MDR) */}
        {/* ================================================================ */}
        {showConfigModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg p-6 my-8">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                {configType === 'bbps' && <><CreditCard className="w-5 h-5 text-blue-600" /> Add BBPS Commission</>}
                {configType === 'payout' && <><Banknote className="w-5 h-5 text-green-600" /> Add Payout Charge</>}
                {configType === 'mdr' && <><TrendingUp className="w-5 h-5 text-orange-600" /> Add MDR Rate</>}
              </h2>

              {/* BBPS Form */}
              {configType === 'bbps' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Category (leave empty for all)</label>
                    <select value={bbpsForm.category} onChange={(e) => setBbpsForm({ ...bbpsForm, category: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                      <option value="">All Categories</option>
                      <option value="Electricity">Electricity</option>
                      <option value="Gas">Gas</option>
                      <option value="Water">Water</option>
                      <option value="Insurance">Insurance</option>
                      <option value="Credit Card">Credit Card</option>
                      <option value="Loan">Loan</option>
                      <option value="Broadband">Broadband</option>
                      <option value="DTH">DTH</option>
                      <option value="Mobile Postpaid">Mobile Postpaid</option>
                      <option value="Mobile Prepaid">Mobile Prepaid</option>
                      <option value="FASTag">FASTag</option>
                      <option value="Municipal Tax">Municipal Tax</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Min Amount (₹)</label>
                      <input type="number" value={bbpsForm.min_amount} onChange={(e) => setBbpsForm({ ...bbpsForm, min_amount: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Max Amount (₹)</label>
                      <input type="number" value={bbpsForm.max_amount} onChange={(e) => setBbpsForm({ ...bbpsForm, max_amount: parseFloat(e.target.value) || 999999999 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                  </div>
                  {/* Commission fields */}
                  {[
                    { label: 'Retailer Charge', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                    { label: 'Retailer Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' },
                    { label: 'Distributor Commission', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                    { label: 'MD Commission', key: 'md_commission', typeKey: 'md_commission_type' },
                    { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                  ].map(({ label, key, typeKey }) => (
                    <div key={key} className="grid grid-cols-3 gap-2 items-end">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium mb-1">{label}</label>
                        <input type="number" step="0.01" value={(bbpsForm as any)[key]}
                          onChange={(e) => setBbpsForm({ ...bbpsForm, [key]: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                      </div>
                      <div>
                        <select value={(bbpsForm as any)[typeKey]}
                          onChange={(e) => setBbpsForm({ ...bbpsForm, [typeKey]: e.target.value })}
                          className="w-full px-2 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                          <option value="flat">₹ Flat</option>
                          <option value="percentage">% Pct</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Payout Form */}
              {configType === 'payout' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Transfer Mode</label>
                    <select value={payoutForm.transfer_mode} onChange={(e) => setPayoutForm({ ...payoutForm, transfer_mode: e.target.value as any })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                      <option value="IMPS">IMPS</option>
                      <option value="NEFT">NEFT</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Min Amount (₹)</label>
                      <input type="number" value={payoutForm.min_amount} onChange={(e) => setPayoutForm({ ...payoutForm, min_amount: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Max Amount (₹)</label>
                      <input type="number" value={payoutForm.max_amount} onChange={(e) => setPayoutForm({ ...payoutForm, max_amount: parseFloat(e.target.value) || 999999999 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                  </div>
                  {[
                    { label: 'Retailer Charge', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                    { label: 'Retailer Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' },
                    { label: 'Distributor Commission', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                    { label: 'MD Commission', key: 'md_commission', typeKey: 'md_commission_type' },
                    { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                  ].map(({ label, key, typeKey }) => (
                    <div key={key} className="grid grid-cols-3 gap-2 items-end">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium mb-1">{label}</label>
                        <input type="number" step="0.01" value={(payoutForm as any)[key]}
                          onChange={(e) => setPayoutForm({ ...payoutForm, [key]: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                      </div>
                      <div>
                        <select value={(payoutForm as any)[typeKey]}
                          onChange={(e) => setPayoutForm({ ...payoutForm, [typeKey]: e.target.value })}
                          className="w-full px-2 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                          <option value="flat">₹ Flat</option>
                          <option value="percentage">% Pct</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* MDR Form */}
              {configType === 'mdr' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Mode</label>
                      <select value={mdrForm.mode} onChange={(e) => {
                        const newMode = e.target.value as 'CARD' | 'UPI'
                        const defaultCardType = newMode === 'UPI' ? 'UPI' : ''
                        const availableBrands = getAvailableBrands(newMode, defaultCardType)
                        setMdrForm({ 
                          ...mdrForm, 
                          mode: newMode, 
                          card_type: defaultCardType,
                          brand_type: availableBrands.length > 0 && availableBrands.includes(mdrForm.brand_type) ? mdrForm.brand_type : ''
                        })
                      }}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                        <option value="CARD">CARD</option>
                        <option value="UPI">UPI</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Card Type</label>
                      <select value={mdrForm.card_type} onChange={(e) => {
                        const newCardType = e.target.value
                        const availableBrands = getAvailableBrands(mdrForm.mode, newCardType)
                        setMdrForm({ 
                          ...mdrForm, 
                          card_type: newCardType,
                          brand_type: availableBrands.length > 0 && availableBrands.includes(mdrForm.brand_type) ? mdrForm.brand_type : ''
                        })
                      }}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                        {mdrForm.mode === 'CARD' ? (
                          <>
                            <option value="">Any</option>
                            <option value="CREDIT">CREDIT</option>
                            <option value="DEBIT">DEBIT</option>
                            <option value="PREPAID">PREPAID</option>
                          </>
                        ) : (
                          <>
                            <option value="UPI">UPI</option>
                            <option value="CREDIT">CREDIT</option>
                          </>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Brand</label>
                      <select 
                        value={mdrForm.brand_type} 
                        onChange={(e) => setMdrForm({ ...mdrForm, brand_type: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
                        disabled={getAvailableBrands(mdrForm.mode, mdrForm.card_type).length === 0}
                      >
                        <option value="">Select Brand</option>
                        {getAvailableBrands(mdrForm.mode, mdrForm.card_type).map((brand) => (
                          <option key={brand} value={brand}>{brand}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">T+0 MDR = T+1 MDR + 1% (auto calculated if left as 0)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">Retailer MDR T+1 (%)</label>
                      <input type="number" step="0.01" value={mdrForm.retailer_mdr_t1}
                        onChange={(e) => {
                          const t1 = parseFloat(e.target.value) || 0
                          setMdrForm({ ...mdrForm, retailer_mdr_t1: t1, retailer_mdr_t0: mdrForm.retailer_mdr_t0 === 0 ? t1 + 1 : mdrForm.retailer_mdr_t0 })
                        }}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Retailer MDR T+0 (%)</label>
                      <input type="number" step="0.01" value={mdrForm.retailer_mdr_t0}
                        onChange={(e) => setMdrForm({ ...mdrForm, retailer_mdr_t0: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Distributor MDR T+1 (%)</label>
                      <input type="number" step="0.01" value={mdrForm.distributor_mdr_t1}
                        onChange={(e) => {
                          const t1 = parseFloat(e.target.value) || 0
                          setMdrForm({ ...mdrForm, distributor_mdr_t1: t1, distributor_mdr_t0: mdrForm.distributor_mdr_t0 === 0 ? t1 + 1 : mdrForm.distributor_mdr_t0 })
                        }}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Distributor MDR T+0 (%)</label>
                      <input type="number" step="0.01" value={mdrForm.distributor_mdr_t0}
                        onChange={(e) => setMdrForm({ ...mdrForm, distributor_mdr_t0: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">MD MDR T+1 (%)</label>
                      <input type="number" step="0.01" value={mdrForm.md_mdr_t1}
                        onChange={(e) => {
                          const t1 = parseFloat(e.target.value) || 0
                          setMdrForm({ ...mdrForm, md_mdr_t1: t1, md_mdr_t0: mdrForm.md_mdr_t0 === 0 ? t1 + 1 : mdrForm.md_mdr_t0 })
                        }}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">MD MDR T+0 (%)</label>
                      <input type="number" step="0.01" value={mdrForm.md_mdr_t0}
                        onChange={(e) => setMdrForm({ ...mdrForm, md_mdr_t0: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowConfigModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSaveConfig} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                  Save Configuration
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* MAPPING MODAL */}
        {/* ================================================================ */}
        {showMappingModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Link2 className="w-5 h-5 text-purple-600" /> Assign Scheme to User
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">User Role</label>
                  <select value={mappingForm.entity_role} onChange={(e) => setMappingForm({ ...mappingForm, entity_role: e.target.value, entity_id: '' })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                    <option value="retailer">Retailer</option>
                    <option value="distributor">Distributor</option>
                    <option value="master_distributor">Master Distributor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Select User</label>
                  <select value={mappingForm.entity_id} onChange={(e) => setMappingForm({ ...mappingForm, entity_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                    <option value="">-- Select --</option>
                    {getUsersForRole(mappingForm.entity_role).map((u: any) => (
                      <option key={u.partner_id} value={u.partner_id}>
                        {u.name} ({u.partner_id})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Service Scope</label>
                  <select value={mappingForm.service_type} onChange={(e) => setMappingForm({ ...mappingForm, service_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                    <option value="all">All Services</option>
                    <option value="bbps">BBPS Only</option>
                    <option value="payout">Payout Only</option>
                    <option value="mdr">MDR Only</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowMappingModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSaveMapping} disabled={!mappingForm.entity_id}
                  className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                  Assign Scheme
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

