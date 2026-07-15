'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase/client'
import { getAssignableRoles } from '@/lib/role-hierarchy'
import AdminSidebar from '@/components/AdminSidebar'
import { 
  Plus, Edit2, Trash2, ChevronDown, ChevronUp, Search, Filter,
  Layers, CreditCard, Banknote, TrendingUp, Users, Link2,
  Save, X, AlertCircle, CheckCircle, Globe, Star, Settings, Eye, DollarSign, Loader2
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import { apiFetch, apiFetchJson } from '@/lib/api-client'
import { getPosCompanies } from '@/lib/merchant-companies'
import PartnerMdrSchemesCard from '@/components/PartnerMdrSchemesCard'

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
  is_partner_plan: boolean
  created_by_id: string | null
  created_by_role: string | null
  metadata?: { creator_name?: string; creator_email?: string } | null
  effective_from: string
  effective_to: string | null
  created_at: string
  updated_at: string
  bbps_commissions?: any[]
  payout_charges?: any[]
  mdr_rates?: any[]
  aeps_commissions?: any[]
  aeps_settlement_charges?: any[]
  shadval_settlement_charges?: any[]
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
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>}>
      <SchemeManagementPageContent />
    </Suspense>
  )
}

function SchemeManagementPageContent() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [schemes, setSchemes] = useState<Scheme[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [savingScheme, setSavingScheme] = useState(false)
  const [deletingScheme, setDeletingScheme] = useState(false)
  const [togglingStatusId, setTogglingStatusId] = useState<string | null>(null)
  const [expandingSchemeId, setExpandingSchemeId] = useState<string | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const [deletingConfigId, setDeletingConfigId] = useState<string | null>(null)
  const [savingMapping, setSavingMapping] = useState(false)
  const [deletingMappingId, setDeletingMappingId] = useState<string | null>(null)
  
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
  const [configType, setConfigType] = useState<'bbps' | 'payout' | 'mdr' | 'aeps' | 'aeps_settlement' | 'shadval_settlement'>('bbps')
  const [configSchemeId, setConfigSchemeId] = useState<string>('')
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null)
  
  // Mapping modal
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [mappingSchemeId, setMappingSchemeId] = useState<string>('')
  
  // Users for mapping
  const [retailers, setRetailers] = useState<any[]>([])
  const [distributors, setDistributors] = useState<any[]>([])
  const [masterDistributors, setMasterDistributors] = useState<any[]>([])
  const [partners, setPartners] = useState<any[]>([])
  
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
          .select('scheme_id, entity_role')
          .in('scheme_id', schemeIds)
          .eq('status', 'active')
        
        const mappingCounts: Record<string, number> = {}
        const partnerSchemeIds = new Set<string>()
        mappings?.forEach(m => {
          mappingCounts[m.scheme_id] = (mappingCounts[m.scheme_id] || 0) + 1
          if (m.entity_role === 'partner') partnerSchemeIds.add(m.scheme_id)
        })
        
        filtered = filtered.map(s => ({
          ...s,
          mapping_count: mappingCounts[s.id] || 0,
          is_partner_plan: s.is_partner_plan || partnerSchemeIds.has(s.id),
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

      // Admin-created schemes have no partner_id; resolve their creator from metadata.
      filtered = filtered.map(s => (
        s.created_by_role === 'admin'
          ? {
              ...s,
              creator_name: s.creator_name || s.metadata?.creator_name || null,
              creator_email: s.creator_email || s.metadata?.creator_email || null,
              creator_role_label: s.creator_role_label || 'Administrator',
            }
          : s
      ))

      setSchemes(filtered)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [filterType, filterStatus, searchQuery])

  const fetchUsers = useCallback(async () => {
    try {
      const [r, d, md, p] = await Promise.all([
        supabase.from('retailers').select('partner_id, name, email, status').eq('status', 'active'),
        supabase.from('distributors').select('partner_id, name, email, status').eq('status', 'active'),
        supabase.from('master_distributors').select('partner_id, name, email, status').eq('status', 'active'),
        supabase.from('partners').select('id, name, email, status, business_name').eq('status', 'active'),
      ])
      setRetailers(r.data || [])
      setDistributors(d.data || [])
      setMasterDistributors(md.data || [])
      setPartners((p.data || []).map((partner: any) => ({ ...partner, partner_id: partner.id })))
    } catch (err: any) {
      showToast('Failed to fetch users for mapping', 'error')
    }
  }, [showToast])

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
    
    setExpandingSchemeId(schemeId)
    try {
    const [bbps, payout, mdr, aeps, aepsSettle, shadvalSettle, mappings] = await Promise.all([
      supabase.from('scheme_bbps_commissions').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('min_amount'),
      supabase.from('scheme_payout_charges').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('transfer_mode'),
      supabase.from('scheme_mdr_rates').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('mode'),
      supabase.from('scheme_aeps_commissions').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('transaction_type').order('min_amount'),
      supabase.from('scheme_aeps_settlement_charges').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('min_amount'),
      supabase.from('scheme_shadval_settlement_charges').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('transfer_mode'),
      supabase.from('scheme_mappings').select('*').eq('scheme_id', schemeId).eq('status', 'active'),
    ])

    // Resolve entity names for mappings
    let enrichedMappings = mappings.data || []
    if (enrichedMappings.length > 0) {
      const entityIds = enrichedMappings.map((m: any) => m.entity_id)
      const [retNames, distNames, mdNames, partnerNames] = await Promise.all([
        supabase.from('retailers').select('partner_id, name, business_name').in('partner_id', entityIds),
        supabase.from('distributors').select('partner_id, name, business_name').in('partner_id', entityIds),
        supabase.from('master_distributors').select('partner_id, name, business_name').in('partner_id', entityIds),
        supabase.from('partners').select('id, name, business_name').in('id', entityIds),
      ])
      const nameMap: Record<string, string> = {}
      retNames.data?.forEach((r: any) => { nameMap[r.partner_id] = r.business_name || r.name })
      distNames.data?.forEach((d: any) => { nameMap[d.partner_id] = d.business_name || d.name })
      mdNames.data?.forEach((md: any) => { nameMap[md.partner_id] = md.business_name || md.name })
      partnerNames.data?.forEach((p: any) => { nameMap[p.id] = p.business_name || p.name })
      enrichedMappings = enrichedMappings.map((m: any) => ({ ...m, entity_name: nameMap[m.entity_id] || null }))
    }
    
    setSchemes(prev => prev.map(s => s.id === schemeId ? {
      ...s,
      bbps_commissions: bbps.data || [],
      payout_charges: payout.data || [],
      mdr_rates: mdr.data || [],
      aeps_commissions: aeps.data || [],
      aeps_settlement_charges: aepsSettle.data || [],
      shadval_settlement_charges: shadvalSettle.data || [],
      mappings: enrichedMappings,
      // Auto-detect partner plan from mappings (if any mapping is entity_role='partner')
      is_partner_plan: s.is_partner_plan || enrichedMappings.some((m: any) => m.entity_role === 'partner'),
    } : s))
    
    setExpandedSchemeId(schemeId)
    } catch (err: any) {
      showToast('Failed to load scheme details', 'error')
    } finally {
      setExpandingSchemeId(null)
    }
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
    is_partner_plan: false,
  })

  const openCreateModal = () => {
    setSchemeForm({ name: '', description: '', scheme_type: 'custom', service_scope: 'all', priority: 100, is_partner_plan: false })
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
      is_partner_plan: scheme.is_partner_plan || false,
    })
    setEditingScheme(scheme)
    setShowCreateModal(true)
  }

  const handleSaveScheme = async () => {
    setSavingScheme(true)
    try {
      if (editingScheme) {
        await apiFetchJson(`/api/schemes/${editingScheme.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: schemeForm.name,
            description: schemeForm.description || null,
            scheme_type: schemeForm.scheme_type,
            service_scope: schemeForm.service_scope,
            priority: schemeForm.priority,
            is_partner_plan: schemeForm.is_partner_plan,
          }),
        })
        setSuccess('Scheme updated successfully')
        showToast('Scheme updated successfully', 'success')
      } else {
        await apiFetchJson('/api/schemes', {
          method: 'POST',
          body: JSON.stringify({
            name: schemeForm.name,
            description: schemeForm.description || null,
            scheme_type: schemeForm.scheme_type,
            service_scope: schemeForm.service_scope,
            priority: schemeForm.priority,
            is_partner_plan: schemeForm.is_partner_plan,
          }),
        })
        setSuccess('Scheme created successfully')
        showToast('Scheme created successfully', 'success')
      }
      setShowCreateModal(false)
      fetchSchemes()
    } catch (err: any) {
      setError(err.message)
      showToast(err.message, 'error')
    } finally {
      setSavingScheme(false)
    }
  }

  const handleDeleteScheme = async (id: string) => {
    if (!confirm('Delete this scheme? All associated configs and mappings will be removed.')) return
    setDeletingScheme(true)
    try {
      await apiFetchJson(`/api/schemes/${id}`, { method: 'DELETE' })
      setSuccess('Scheme deleted')
      showToast('Scheme deleted', 'success')
      fetchSchemes()
    } catch (err: any) {
      setError(err.message)
      showToast(err.message, 'error')
    } finally {
      setDeletingScheme(false)
    }
  }

  const handleToggleStatus = async (scheme: Scheme) => {
    const newStatus = scheme.status === 'active' ? 'inactive' : 'active'
    setTogglingStatusId(scheme.id)
    try {
      await apiFetchJson(`/api/schemes/${scheme.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      })
      showToast(`Scheme ${newStatus === 'active' ? 'activated' : 'deactivated'}`, 'success')
      fetchSchemes()
    } catch (err: any) {
      showToast(err.message || 'Failed to toggle status', 'error')
    } finally {
      setTogglingStatusId(null)
    }
  }

  // ============================================================================
  // CONFIG MODALS (BBPS / Settlement / MDR / AEPS)
  // ============================================================================

  const [bbpsForm, setBbpsForm] = useState({
    bbps_type: 'bbps_1' as 'bbps_1' | 'bbps_2',
    category: '',
    min_amount: 0,
    max_amount: 100000,
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
    gst_inclusive: false,
    vendor_rate: 0,
    company_mdr_rate: 0,
  })

  const [settlementTypeSelection, setSettlementTypeSelection] = useState<'payout' | 'shadval_settlement'>('payout')

  const [payoutForm, setPayoutForm] = useState({
    transfer_mode: 'IMPS' as 'IMPS' | 'NEFT',
    min_amount: 0,
    max_amount: 100000,
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
    gst_inclusive: false,
    vendor_rate: 0,
    company_mdr_rate: 0,
  })

  const [mdrForm, setMdrForm] = useState({
    mode: 'CARD' as 'CARD' | 'UPI',
    card_type: '' as string,
    brand_type: '',
    card_classification: '',
    merchant_slug: '',
    retailer_mdr_t1: 0,
    retailer_mdr_t0: 0,
    distributor_mdr_t1: 0,
    distributor_mdr_t0: 0,
    md_mdr_t1: 0,
    md_mdr_t0: 0,
    partner_mdr: 0,
    gst_inclusive: false,
    vendor_rate: 0,
    company_mdr_rate: 0,
  })

  const [aepsForm, setAepsForm] = useState({
    transaction_type: 'cash_withdrawal' as string,
    min_amount: 0,
    max_amount: 100000,
    base_commission: 0,
    base_commission_type: 'percentage' as 'flat' | 'percentage',
    company_earning: 0,
    company_earning_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    retailer_commission: 0,
    retailer_commission_type: 'flat' as 'flat' | 'percentage',
    tds_percentage: 5,
    gst_inclusive: false,
    vendor_rate: 0,
    company_mdr_rate: 0,
  })

  const [aepsSettleForm, setAepsSettleForm] = useState({
    min_amount: 0,
    max_amount: 100000,
    retailer_charge: 0,
    retailer_charge_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
    company_charge: 0,
    company_charge_type: 'flat' as 'flat' | 'percentage',
    gst_inclusive: false,
    vendor_rate: 0,
    company_mdr_rate: 0,
  })

  const [shadvalSettleForm, setShadvalSettleForm] = useState({
    transfer_mode: 'IMPS' as 'IMPS' | 'NEFT',
    min_amount: 0,
    max_amount: 100000,
    retailer_charge: 0,
    retailer_charge_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
    company_charge: 0,
    company_charge_type: 'flat' as 'flat' | 'percentage',
    gst_inclusive: false,
    vendor_rate: 0,
    company_mdr_rate: 0,
  })

  const openConfigModal = (schemeId: string, type: 'bbps' | 'payout' | 'mdr' | 'aeps' | 'aeps_settlement' | 'shadval_settlement', editData?: any) => {
    setConfigSchemeId(schemeId)
    setEditingConfigId(editData?.id || null)
    if (type === 'shadval_settlement') {
      if (editData) {
        setConfigType('shadval_settlement')
      } else {
        setConfigType('payout')
      }
      setSettlementTypeSelection('shadval_settlement')
    } else {
      setConfigType(type)
      setSettlementTypeSelection('payout')
    }
    if (editData) {
      if (type === 'bbps') {
        setBbpsForm({ bbps_type: editData.bbps_type || 'bbps_1', category: editData.category || '', min_amount: editData.min_amount || 0, max_amount: editData.max_amount || 100000, retailer_charge: editData.retailer_charge || 0, retailer_charge_type: editData.retailer_charge_type || 'flat', retailer_commission: editData.retailer_commission || 0, retailer_commission_type: editData.retailer_commission_type || 'flat', distributor_commission: editData.distributor_commission || 0, distributor_commission_type: editData.distributor_commission_type || 'flat', md_commission: editData.md_commission || 0, md_commission_type: editData.md_commission_type || 'flat', company_charge: editData.company_charge || 0, company_charge_type: editData.company_charge_type || 'flat', gst_inclusive: editData.gst_inclusive || false, vendor_rate: editData.vendor_rate || 0, company_mdr_rate: editData.company_mdr_rate || 0 })
      } else if (type === 'payout') {
        setPayoutForm({ transfer_mode: editData.transfer_mode || 'IMPS', min_amount: editData.min_amount || 0, max_amount: editData.max_amount || 100000, retailer_charge: editData.retailer_charge || 0, retailer_charge_type: editData.retailer_charge_type || 'flat', retailer_commission: editData.retailer_commission || 0, retailer_commission_type: editData.retailer_commission_type || 'flat', distributor_commission: editData.distributor_commission || 0, distributor_commission_type: editData.distributor_commission_type || 'flat', md_commission: editData.md_commission || 0, md_commission_type: editData.md_commission_type || 'flat', company_charge: editData.company_charge || 0, company_charge_type: editData.company_charge_type || 'flat', gst_inclusive: editData.gst_inclusive || false, vendor_rate: editData.vendor_rate || 0, company_mdr_rate: editData.company_mdr_rate || 0 })
      } else if (type === 'mdr') {
        setMdrForm({ mode: editData.mode || 'CARD', card_type: editData.card_type || '', brand_type: editData.brand_type || '', card_classification: editData.card_classification || '', merchant_slug: editData.merchant_slug || '', retailer_mdr_t1: editData.retailer_mdr_t1 || 0, retailer_mdr_t0: editData.retailer_mdr_t0 || 0, distributor_mdr_t1: editData.distributor_mdr_t1 || 0, distributor_mdr_t0: editData.distributor_mdr_t0 || 0, md_mdr_t1: editData.md_mdr_t1 || 0, md_mdr_t0: editData.md_mdr_t0 || 0, partner_mdr: editData.partner_mdr || 0, gst_inclusive: editData.gst_inclusive || false, vendor_rate: editData.vendor_rate || 0, company_mdr_rate: editData.company_mdr_rate || 0 })
      } else if (type === 'aeps') {
        setAepsForm({ transaction_type: editData.transaction_type || 'cash_withdrawal', min_amount: editData.min_amount || 0, max_amount: editData.max_amount || 100000, base_commission: editData.base_commission || 0, base_commission_type: editData.base_commission_type || 'percentage', company_earning: editData.company_earning || 0, company_earning_type: editData.company_earning_type || 'flat', md_commission: editData.md_commission || 0, md_commission_type: editData.md_commission_type || 'flat', distributor_commission: editData.distributor_commission || 0, distributor_commission_type: editData.distributor_commission_type || 'flat', retailer_commission: editData.retailer_commission || 0, retailer_commission_type: editData.retailer_commission_type || 'flat', tds_percentage: editData.tds_percentage ?? 5, gst_inclusive: editData.gst_inclusive || false, vendor_rate: editData.vendor_rate || 0, company_mdr_rate: editData.company_mdr_rate || 0 })
      } else if (type === 'aeps_settlement') {
        setAepsSettleForm({ min_amount: editData.min_amount || 0, max_amount: editData.max_amount || 100000, retailer_charge: editData.retailer_charge || 0, retailer_charge_type: editData.retailer_charge_type || 'flat', distributor_commission: editData.distributor_commission || 0, distributor_commission_type: editData.distributor_commission_type || 'flat', md_commission: editData.md_commission || 0, md_commission_type: editData.md_commission_type || 'flat', company_charge: editData.company_charge || 0, company_charge_type: editData.company_charge_type || 'flat', gst_inclusive: editData.gst_inclusive || false, vendor_rate: editData.vendor_rate || 0, company_mdr_rate: editData.company_mdr_rate || 0 })
      } else if (type === 'shadval_settlement') {
        setShadvalSettleForm({ transfer_mode: editData.transfer_mode || 'IMPS', min_amount: editData.min_amount || 0, max_amount: editData.max_amount || 100000, retailer_charge: editData.retailer_charge || 0, retailer_charge_type: editData.retailer_charge_type || 'flat', distributor_commission: editData.distributor_commission || 0, distributor_commission_type: editData.distributor_commission_type || 'flat', md_commission: editData.md_commission || 0, md_commission_type: editData.md_commission_type || 'flat', company_charge: editData.company_charge || 0, company_charge_type: editData.company_charge_type || 'flat', gst_inclusive: editData.gst_inclusive || false, vendor_rate: editData.vendor_rate || 0, company_mdr_rate: editData.company_mdr_rate || 0 })
      }
    } else {
      setBbpsForm({ bbps_type: 'bbps_1', category: '', min_amount: 0, max_amount: 100000, retailer_charge: 0, retailer_charge_type: 'flat', retailer_commission: 0, retailer_commission_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat', company_charge: 0, company_charge_type: 'flat', gst_inclusive: false, vendor_rate: 0, company_mdr_rate: 0 })
      setPayoutForm({ transfer_mode: 'IMPS', min_amount: 0, max_amount: 100000, retailer_charge: 0, retailer_charge_type: 'flat', retailer_commission: 0, retailer_commission_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat', company_charge: 0, company_charge_type: 'flat', gst_inclusive: false, vendor_rate: 0, company_mdr_rate: 0 })
      setMdrForm({ mode: 'CARD', card_type: '', brand_type: '', card_classification: '', merchant_slug: '', retailer_mdr_t1: 0, retailer_mdr_t0: 0, distributor_mdr_t1: 0, distributor_mdr_t0: 0, md_mdr_t1: 0, md_mdr_t0: 0, partner_mdr: 0, gst_inclusive: false, vendor_rate: 0, company_mdr_rate: 0 })
      setAepsForm({ transaction_type: 'cash_withdrawal', min_amount: 0, max_amount: 100000, base_commission: 0, base_commission_type: 'percentage', company_earning: 0, company_earning_type: 'flat', md_commission: 0, md_commission_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', retailer_commission: 0, retailer_commission_type: 'flat', tds_percentage: 5, gst_inclusive: false, vendor_rate: 0, company_mdr_rate: 0 })
      setAepsSettleForm({ min_amount: 0, max_amount: 100000, retailer_charge: 0, retailer_charge_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat', company_charge: 0, company_charge_type: 'flat', gst_inclusive: false, vendor_rate: 0, company_mdr_rate: 0 })
      setShadvalSettleForm({ transfer_mode: 'IMPS', min_amount: 0, max_amount: 100000, retailer_charge: 0, retailer_charge_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat', company_charge: 0, company_charge_type: 'flat', gst_inclusive: false, vendor_rate: 0, company_mdr_rate: 0 })
    }
    setShowConfigModal(true)
  }

  // Resolve a flat/percentage value against a representative amount for preview/validation
  const aepsResolve = (value: number, type: string, amount: number) =>
    type === 'percentage' ? Math.round((amount * value) / 100 * 100) / 100 : value

  const aepsPreview = () => {
    const amt = (aepsForm.max_amount && aepsForm.max_amount < 100000)
      ? aepsForm.max_amount
      : (aepsForm.min_amount > 0 ? aepsForm.min_amount : 1000)
    const base = aepsResolve(aepsForm.base_commission, aepsForm.base_commission_type, amt)
    const company = aepsResolve(aepsForm.company_earning, aepsForm.company_earning_type, amt)
    const md = aepsResolve(aepsForm.md_commission, aepsForm.md_commission_type, amt)
    const dt = aepsResolve(aepsForm.distributor_commission, aepsForm.distributor_commission_type, amt)
    const rt = aepsResolve(aepsForm.retailer_commission, aepsForm.retailer_commission_type, amt)
    const distributed = Math.round((company + md + dt + rt) * 100) / 100
    return { amt, base, company, md, dt, rt, distributed, valid: distributed <= base + 0.01 }
  }

  const handleSaveConfig = async () => {
    setSavingConfig(true)
    try {
      if (configType === 'aeps') {
        const preview = aepsPreview()
        if (!preview.valid) {
          setError(`Distribution (₹${preview.distributed}) exceeds partner pool (₹${preview.base}) at ₹${preview.amt}. Reduce role commissions.`)
          showToast('Distribution exceeds partner pool', 'error')
          setSavingConfig(false)
          return
        }
      }

      // If editing, delete old record first then insert new
      if (editingConfigId) {
        const configTypeMap: Record<string, string> = {
          bbps: 'bbps', payout: 'payout', mdr: 'mdr', aeps: 'aeps',
          aeps_settlement: 'aeps_settlement', shadval_settlement: 'shadval_settlement',
        }
        const ct = configTypeMap[configType] || configType
        await apiFetch(`/api/schemes/${configSchemeId}/config?config_type=${ct}&config_id=${editingConfigId}`, { method: 'DELETE' })
      }

      let effectiveConfigType = configType
      if (configType === 'payout' && settlementTypeSelection === 'shadval_settlement' && !editingConfigId) {
        effectiveConfigType = 'shadval_settlement'
      }

      let configData: any = {}
      if (effectiveConfigType === 'bbps') {
        configData = { ...bbpsForm, category: bbpsForm.category || null }
      } else if (effectiveConfigType === 'payout') {
        configData = { ...payoutForm }
      } else if (effectiveConfigType === 'mdr') {
        const configScheme = schemes.find(s => s.id === configSchemeId)
        const isPartnerPlan = configScheme?.is_partner_plan || false
        configData = {
          mode: mdrForm.mode,
          card_type: mdrForm.card_type || null,
          brand_type: mdrForm.brand_type || null,
          card_classification: mdrForm.card_classification || null,
          merchant_slug: mdrForm.merchant_slug || null,
        }
        if (isPartnerPlan) {
          configData.partner_mdr = mdrForm.retailer_mdr_t1
          configData.retailer_mdr_t1 = mdrForm.retailer_mdr_t1
          configData.retailer_mdr_t0 = mdrForm.retailer_mdr_t0
          configData.distributor_mdr_t1 = 0
          configData.distributor_mdr_t0 = 0
          configData.md_mdr_t1 = 0
          configData.md_mdr_t0 = 0
          configData.gst_inclusive = mdrForm.gst_inclusive
          configData.vendor_rate = mdrForm.vendor_rate
          configData.company_mdr_rate = mdrForm.company_mdr_rate
        } else {
          configData.retailer_mdr_t1 = mdrForm.retailer_mdr_t1
          configData.retailer_mdr_t0 = mdrForm.retailer_mdr_t0
          configData.distributor_mdr_t1 = mdrForm.distributor_mdr_t1
          configData.distributor_mdr_t0 = mdrForm.distributor_mdr_t0
          configData.md_mdr_t1 = mdrForm.md_mdr_t1
          configData.md_mdr_t0 = mdrForm.md_mdr_t0
          configData.partner_mdr = null
          configData.gst_inclusive = mdrForm.gst_inclusive
          configData.vendor_rate = mdrForm.vendor_rate
          configData.company_mdr_rate = mdrForm.company_mdr_rate
        }
      } else if (effectiveConfigType === 'aeps') {
        configData = { ...aepsForm }
      } else if (effectiveConfigType === 'aeps_settlement') {
        configData = { ...aepsSettleForm }
      } else if (effectiveConfigType === 'shadval_settlement') {
        if (configType === 'payout') {
          configData = {
            transfer_mode: payoutForm.transfer_mode,
            min_amount: payoutForm.min_amount,
            max_amount: payoutForm.max_amount,
            retailer_charge: payoutForm.retailer_charge,
            retailer_charge_type: payoutForm.retailer_charge_type,
            distributor_commission: payoutForm.distributor_commission,
            distributor_commission_type: payoutForm.distributor_commission_type,
            md_commission: payoutForm.md_commission,
            md_commission_type: payoutForm.md_commission_type,
            company_charge: payoutForm.company_charge,
            company_charge_type: payoutForm.company_charge_type,
            gst_inclusive: payoutForm.gst_inclusive,
            vendor_rate: payoutForm.vendor_rate,
            company_mdr_rate: payoutForm.company_mdr_rate,
          }
        } else {
          configData = { ...shadvalSettleForm }
        }
      }

      const res = await apiFetch(`/api/schemes/${configSchemeId}/config`, {
        method: 'POST',
        body: JSON.stringify({ config_type: effectiveConfigType, ...configData }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save configuration')

      const action = editingConfigId ? 'updated' : 'added'
      const typeLabel = effectiveConfigType === 'payout' ? 'Settlement-1' : effectiveConfigType === 'shadval_settlement' ? 'Settlement-2' : effectiveConfigType?.toUpperCase()
      setSuccess(`${typeLabel} config ${action} successfully`)
      showToast(`${typeLabel} config ${action}`, 'success')
      setEditingConfigId(null)
      setShowConfigModal(false)
      if (expandedSchemeId === configSchemeId) {
        toggleExpand(configSchemeId)
      }
    } catch (err: any) {
      setError(err.message)
      showToast(err.message, 'error')
    } finally {
      setSavingConfig(false)
    }
  }

  const handleDeleteConfig = async (table: string, id: string) => {
    if (!confirm('Delete this configuration?')) return
    if (!expandedSchemeId) return
    setDeletingConfigId(id)
    try {
      const configTypeMap: Record<string, string> = {
        scheme_bbps_commissions: 'bbps',
        scheme_payout_charges: 'payout',
        scheme_mdr_rates: 'mdr',
        scheme_aeps_commissions: 'aeps',
        scheme_aeps_settlement_charges: 'aeps_settlement',
        scheme_shadval_settlement_charges: 'shadval_settlement',
      }
      const ct = configTypeMap[table] || table
      const res = await apiFetch(`/api/schemes/${expandedSchemeId}/config?config_type=${ct}&config_id=${id}`, {
        method: 'DELETE',
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to delete configuration')
      setSuccess('Config deleted')
      showToast('Config deleted', 'success')
      if (expandedSchemeId) toggleExpand(expandedSchemeId)
    } catch (err: any) {
      setError(err.message)
      showToast(err.message, 'error')
    } finally {
      setDeletingConfigId(null)
    }
  }

  // ============================================================================
  // MAPPING
  // ============================================================================

  const [mappingForm, setMappingForm] = useState({
    entity_id: '',
    entity_role: 'master_distributor' as string,
    service_type: 'all' as string,
  })

  const openMappingModal = (schemeId: string) => {
    const scheme = schemes.find(s => s.id === schemeId)
    const roles = getMappableRoles(scheme?.is_partner_plan)
    setMappingSchemeId(schemeId)
    setMappingForm({ entity_id: '', entity_role: roles[0]?.value || 'master_distributor', service_type: 'all' })
    setShowMappingModal(true)
  }

  // Roles that a scheme can be assigned to: Partner Plans → partner only; others → non-partner roles.
  const getMappableRoles = (isPartnerPlan?: boolean) => {
    const roles = getAssignableRoles(user?.role)
    if (isPartnerPlan) return roles.filter(r => r.value === 'partner')
    return roles.filter(r => r.value !== 'partner')
  }

  const handleSaveMapping = async () => {
    setSavingMapping(true)
    try {
      // The API deactivates any existing active mapping for this entity and
      // inserts the new one (service-role, RLS-safe).
      await apiFetchJson('/api/schemes/mappings', {
        method: 'POST',
        body: JSON.stringify({
          scheme_id: mappingSchemeId,
          entity_id: mappingForm.entity_id,
          entity_role: mappingForm.entity_role,
          service_type: mappingForm.service_type || null,
        }),
      })

      // Auto-set is_partner_plan when mapping to a partner entity
      if (mappingForm.entity_role === 'partner') {
        await apiFetchJson(`/api/schemes/${mappingSchemeId}`, {
          method: 'PUT',
          body: JSON.stringify({ is_partner_plan: true }),
        })
      }

      setSuccess('Scheme mapped successfully')
      showToast('Scheme assigned successfully', 'success')
      setShowMappingModal(false)
      fetchSchemes()
      if (expandedSchemeId) toggleExpand(expandedSchemeId)
    } catch (err: any) {
      setError(err.message)
      showToast(err.message, 'error')
    } finally {
      setSavingMapping(false)
    }
  }

  const handleDeleteMapping = async (id: string) => {
    if (!confirm('Remove this mapping?')) return
    setDeletingMappingId(id)
    try {
      await apiFetchJson(`/api/schemes/mappings?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      setSuccess('Mapping removed')
      showToast('Mapping removed', 'success')
      if (expandedSchemeId) toggleExpand(expandedSchemeId)
      fetchSchemes()
    } catch (err: any) {
      setError(err.message)
      showToast(err.message, 'error')
    } finally {
      setDeletingMappingId(null)
    }
  }

  // Get user list based on selected role
  const getUsersForRole = (role: string) => {
    if (role === 'retailer') return retailers
    if (role === 'distributor') return distributors
    if (role === 'master_distributor') return masterDistributors
    if (role === 'partner') return partners
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
              <p className="text-sm text-gray-500 mt-1">Manage Global, Golden &amp; Custom schemes with BBPS, Settlement, MDR &amp; AEPS configurations</p>
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
                        {scheme.is_partner_plan && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                            Partner Plan
                          </span>
                        )}
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
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400" title={scheme.created_by_role === 'admin' ? 'Created by an administrator' : `Created by: ${scheme.created_by_id || 'Unknown'}`}>
                            <Users className="w-3 h-3" />
                            {scheme.created_by_role === 'admin'
                              ? 'Admin'
                              : `${scheme.created_by_role === 'master_distributor' ? 'MD' : scheme.created_by_role === 'distributor' ? 'Distributor' : scheme.created_by_role}: ${scheme.created_by_id || 'Unknown'}`}
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
                      className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600" title="Add Settlement Charges">
                      <Banknote className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'mdr') }}
                      className="p-1.5 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 text-orange-600" title="Add MDR Config">
                      <TrendingUp className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'aeps') }}
                      className="p-1.5 rounded-lg hover:bg-teal-50 dark:hover:bg-teal-900/20 text-teal-600" title="Add AEPS Commission Config">
                      <Banknote className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'aeps_settlement') }}
                      className="p-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-600" title="Add AEPS Settlement Charge">
                      <DollarSign className="w-4 h-4" />
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
                      disabled={togglingStatusId === scheme.id}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 disabled:opacity-50" title="Toggle Status">
                      {togglingStatusId === scheme.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteScheme(scheme.id) }}
                      disabled={deletingScheme}
                      className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 disabled:opacity-50" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {expandingSchemeId === scheme.id ? (
                      <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                    ) : expandedSchemeId === scheme.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
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
                                <th className="px-2 py-1.5 text-left">Type</th>
                                <th className="px-2 py-1.5 text-left">Category</th>
                                <th className="px-2 py-1.5 text-left">Slab</th>
                                <th className="px-2 py-1.5 text-right">Retailer Charge</th>
                                <th className="px-2 py-1.5 text-right">Retailer Comm</th>
                                <th className="px-2 py-1.5 text-right">Dist Comm</th>
                                <th className="px-2 py-1.5 text-right">MD Comm</th>
                                <th className="px-2 py-1.5 text-right">Company</th>
                                <th className="px-2 py-1.5 text-center">GST</th>
                                <th className="px-2 py-1.5 text-right">Vendor</th>
                                <th className="px-2 py-1.5 text-right">Co. MDR</th>
                                <th className="px-2 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {scheme.bbps_commissions.map((c: any) => (
                                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                  <td className="px-2 py-1.5"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${c.bbps_type === 'bbps_2' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>{c.bbps_type === 'bbps_2' ? 'BBPS 2' : 'BBPS 1'}</span></td>
                                  <td className="px-2 py-1.5">{c.category || 'All'}</td>
                                  <td className="px-2 py-1.5">{`₹${c.min_amount} - ₹${c.max_amount >= 999999 ? '∞' : c.max_amount}`}</td>
                                  <td className="px-2 py-1.5 text-right">{c.retailer_charge}{c.retailer_charge_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.retailer_commission}{c.retailer_commission_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.distributor_commission}{c.distributor_commission_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.md_commission}{c.md_commission_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.company_charge}{c.company_charge_type === 'percentage' ? '%' : '₹'}</td>
                                  <td className="px-2 py-1.5 text-center">{c.gst_inclusive ? '✓' : '-'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.vendor_rate || '-'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.company_mdr_rate || '-'}</td>
                                  <td className="px-2 py-1.5 text-right flex gap-1">
                                    <button onClick={() => openConfigModal(scheme.id, 'bbps', c)} className="text-blue-400 hover:text-blue-600" title="Edit">
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                    <button onClick={() => handleDeleteConfig('scheme_bbps_commissions', c.id)} disabled={deletingConfigId === c.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                      {deletingConfigId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
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

                    {/* Settlement-1 Charges */}
                    <div>
                      <h4 className="font-semibold text-sm text-green-700 dark:text-green-400 mb-2 flex items-center gap-1">
                        <Banknote className="w-4 h-4" /> Settlement-1 Charges ({scheme.payout_charges?.length || 0})
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
                                <th className="px-2 py-1.5 text-center">GST</th>
                                <th className="px-2 py-1.5 text-right">Vendor</th>
                                <th className="px-2 py-1.5 text-right">Co. MDR</th>
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
                                  <td className="px-2 py-1.5 text-center">{c.gst_inclusive ? '✓' : '-'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.vendor_rate || '-'}</td>
                                  <td className="px-2 py-1.5 text-right">{c.company_mdr_rate || '-'}</td>
                                  <td className="px-2 py-1.5 text-right flex gap-1">
                                    <button onClick={() => openConfigModal(scheme.id, 'payout', c)} className="text-blue-400 hover:text-blue-600" title="Edit">
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                    <button onClick={() => handleDeleteConfig('scheme_payout_charges', c.id)} disabled={deletingConfigId === c.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                      {deletingConfigId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No Settlement-1 charges configured</p>
                      )}
                    </div>

                    {/* MDR Rates */}
                    <div>
                      <h4 className="font-semibold text-sm text-orange-700 dark:text-orange-400 mb-2 flex items-center gap-1">
                        <TrendingUp className="w-4 h-4" /> MDR Rates ({scheme.mdr_rates?.length || 0})
                        {scheme.is_partner_plan && (
                          <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">Partner Plan</span>
                        )}
                      </h4>
                      {scheme.mdr_rates && scheme.mdr_rates.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-orange-50 dark:bg-orange-900/20">
                                <th className="px-2 py-1.5 text-left">Company</th>
                                <th className="px-2 py-1.5 text-left">Mode</th>
                                <th className="px-2 py-1.5 text-left">Card Type</th>
                                <th className="px-2 py-1.5 text-left">Brand Type</th>
                                {scheme.is_partner_plan ? (
                                  <>
                                    <th className="px-2 py-1.5 text-right">MDR T+1</th>
                                    <th className="px-2 py-1.5 text-right">MDR T+0</th>
                                  </>
                                ) : (
                                  <>
                                    <th className="px-2 py-1.5 text-right">RT T+1</th>
                                    <th className="px-2 py-1.5 text-right">RT T+0</th>
                                    <th className="px-2 py-1.5 text-right">DT T+1</th>
                                    <th className="px-2 py-1.5 text-right">DT T+0</th>
                                    <th className="px-2 py-1.5 text-right">MD T+1</th>
                                    <th className="px-2 py-1.5 text-right">MD T+0</th>
                                  </>
                                )}
                                <th className="px-2 py-1.5 text-center">GST</th>
                                <th className="px-2 py-1.5 text-right">Vendor</th>
                                <th className="px-2 py-1.5 text-right">Co. MDR</th>
                                <th className="px-2 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {scheme.mdr_rates.map((r: any) => (
                                <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700">
                                  <td className="px-2 py-1.5">{r.merchant_slug ? (getPosCompanies().find(c => c.slug === r.merchant_slug)?.shortName || r.merchant_slug) : 'All'}</td>
                                  <td className="px-2 py-1.5 font-medium">{r.mode}</td>
                                  <td className="px-2 py-1.5">{r.card_type || '-'}</td>
                                  <td className="px-2 py-1.5">{r.brand_type || '-'}</td>
                                  {scheme.is_partner_plan ? (
                                    <>
                                      <td className="px-2 py-1.5 text-right font-semibold text-orange-700 dark:text-orange-400">{r.partner_mdr ?? r.retailer_mdr_t1 ?? 0}%</td>
                                      <td className="px-2 py-1.5 text-right font-semibold text-orange-700 dark:text-orange-400">{r.retailer_mdr_t0 ?? 0}%</td>
                                    </>
                                  ) : (
                                    <>
                                      <td className="px-2 py-1.5 text-right">{r.retailer_mdr_t1}%</td>
                                      <td className="px-2 py-1.5 text-right">{r.retailer_mdr_t0}%</td>
                                      <td className="px-2 py-1.5 text-right">{r.distributor_mdr_t1}%</td>
                                      <td className="px-2 py-1.5 text-right">{r.distributor_mdr_t0}%</td>
                                      <td className="px-2 py-1.5 text-right">{r.md_mdr_t1}%</td>
                                      <td className="px-2 py-1.5 text-right">{r.md_mdr_t0}%</td>
                                    </>
                                  )}
                                  <td className="px-2 py-1.5 text-center">{r.gst_inclusive ? '✓' : '-'}</td>
                                  <td className="px-2 py-1.5 text-right">{r.vendor_rate ? `${r.vendor_rate}%` : '-'}</td>
                                  <td className="px-2 py-1.5 text-right">{r.company_mdr_rate ? `${r.company_mdr_rate}%` : '-'}</td>
                                  <td className="px-2 py-1.5 text-right flex gap-1">
                                    <button onClick={() => openConfigModal(scheme.id, 'mdr', r)} className="text-blue-400 hover:text-blue-600" title="Edit">
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                    <button onClick={() => handleDeleteConfig('scheme_mdr_rates', r.id)} disabled={deletingConfigId === r.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                      {deletingConfigId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
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

                    {/* AEPS Commissions */}
                    <div>
                      <h4 className="font-semibold text-sm text-teal-700 dark:text-teal-400 mb-2 flex items-center gap-1">
                        <Banknote className="w-4 h-4" /> AEPS Commissions ({scheme.aeps_commissions?.length || 0})
                      </h4>
                      {scheme.aeps_commissions && scheme.aeps_commissions.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-teal-50 dark:bg-teal-900/20">
                                <th className="px-2 py-1.5 text-left">Txn Type</th>
                                <th className="px-2 py-1.5 text-right">Range</th>
                                <th className="px-2 py-1.5 text-right">Pool</th>
                                <th className="px-2 py-1.5 text-right">Company</th>
                                <th className="px-2 py-1.5 text-right">MD</th>
                                <th className="px-2 py-1.5 text-right">DT</th>
                                <th className="px-2 py-1.5 text-right">RT</th>
                                <th className="px-2 py-1.5 text-right">TDS</th>
                                <th className="px-2 py-1.5 text-center">GST</th>
                                <th className="px-2 py-1.5 text-right">Vendor</th>
                                <th className="px-2 py-1.5 text-right">Co. MDR</th>
                                <th className="px-2 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {scheme.aeps_commissions.map((c: any) => {
                                const fmt = (v: number, t: string) => t === 'percentage' ? `${v}%` : `₹${v}`
                                return (
                                  <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                    <td className="px-2 py-1.5 font-medium">{c.transaction_type}</td>
                                    <td className="px-2 py-1.5 text-right">₹{c.min_amount}–{c.max_amount >= 100000 ? '∞' : c.max_amount}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.base_commission, c.base_commission_type)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.company_earning, c.company_earning_type)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.md_commission, c.md_commission_type)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.distributor_commission, c.distributor_commission_type)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.retailer_commission, c.retailer_commission_type)}</td>
                                    <td className="px-2 py-1.5 text-right">{c.tds_percentage}%</td>
                                    <td className="px-2 py-1.5 text-center">{c.gst_inclusive ? '✓' : '-'}</td>
                                    <td className="px-2 py-1.5 text-right">{c.vendor_rate || '-'}</td>
                                    <td className="px-2 py-1.5 text-right">{c.company_mdr_rate || '-'}</td>
                                    <td className="px-2 py-1.5 text-right flex gap-1">
                                      <button onClick={() => openConfigModal(scheme.id, 'aeps', c)} className="text-blue-400 hover:text-blue-600" title="Edit">
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                      <button onClick={() => handleDeleteConfig('scheme_aeps_commissions', c.id)} disabled={deletingConfigId === c.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                        {deletingConfigId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                      </button>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No AEPS commissions configured</p>
                      )}
                    </div>

                    {/* AEPS Settlement Charges */}
                    <div>
                      <h4 className="font-semibold text-sm text-purple-700 dark:text-purple-400 mb-2 flex items-center gap-1">
                        <DollarSign className="w-4 h-4" /> AEPS Settlement Charges ({scheme.aeps_settlement_charges?.length || 0})
                      </h4>
                      {scheme.aeps_settlement_charges && scheme.aeps_settlement_charges.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-purple-50 dark:bg-purple-900/20">
                                <th className="px-2 py-1.5 text-left">Amount Range</th>
                                <th className="px-2 py-1.5 text-right">Retailer Charge</th>
                                <th className="px-2 py-1.5 text-right">DT Margin</th>
                                <th className="px-2 py-1.5 text-right">MD Margin</th>
                                <th className="px-2 py-1.5 text-right">Company</th>
                                <th className="px-2 py-1.5 text-center">GST</th>
                                <th className="px-2 py-1.5 text-right">Vendor</th>
                                <th className="px-2 py-1.5 text-right">Co. MDR</th>
                                <th className="px-2 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {scheme.aeps_settlement_charges.map((c: any) => {
                                const fmt = (v: number, t: string) => t === 'percentage' ? `${v}%` : `₹${v}`
                                return (
                                  <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                    <td className="px-2 py-1.5">₹{c.min_amount.toLocaleString('en-IN')} – {c.max_amount >= 100000 ? '∞' : `₹${c.max_amount.toLocaleString('en-IN')}`}</td>
                                    <td className="px-2 py-1.5 text-right font-medium">{fmt(c.retailer_charge, c.retailer_charge_type)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.distributor_commission, c.distributor_commission_type)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.md_commission, c.md_commission_type)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.company_charge, c.company_charge_type)}</td>
                                    <td className="px-2 py-1.5 text-center">{c.gst_inclusive ? '✓' : '-'}</td>
                                    <td className="px-2 py-1.5 text-right">{c.vendor_rate || '-'}</td>
                                    <td className="px-2 py-1.5 text-right">{c.company_mdr_rate || '-'}</td>
                                    <td className="px-2 py-1.5 text-right flex gap-1">
                                      <button onClick={() => openConfigModal(scheme.id, 'aeps_settlement', c)} className="text-blue-400 hover:text-blue-600" title="Edit">
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                      <button onClick={() => handleDeleteConfig('scheme_aeps_settlement_charges', c.id)} disabled={deletingConfigId === c.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                        {deletingConfigId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                      </button>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No AEPS settlement charges configured</p>
                      )}
                    </div>

                    {/* Settlement-2 (Shadval) Charges */}
                    <div>
                      <h4 className="font-semibold text-sm text-rose-700 dark:text-rose-400 mb-2 flex items-center gap-1">
                        <Banknote className="w-4 h-4" /> Settlement-2 Charges (Shadval) ({scheme.shadval_settlement_charges?.length || 0})
                      </h4>
                      {scheme.shadval_settlement_charges && scheme.shadval_settlement_charges.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-rose-50 dark:bg-rose-900/20">
                                <th className="px-2 py-1.5 text-left">Mode</th>
                                <th className="px-2 py-1.5 text-left">Slab</th>
                                <th className="px-2 py-1.5 text-right">Retailer Charge</th>
                                <th className="px-2 py-1.5 text-right">Dist Comm</th>
                                <th className="px-2 py-1.5 text-right">MD Comm</th>
                                <th className="px-2 py-1.5 text-right">Company</th>
                                <th className="px-2 py-1.5 text-center">GST</th>
                                <th className="px-2 py-1.5 text-right">Vendor</th>
                                <th className="px-2 py-1.5 text-right">Co. MDR</th>
                                <th className="px-2 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {scheme.shadval_settlement_charges.map((c: any) => {
                                const fmt = (v: number, t: string) => t === 'percentage' ? `${v}%` : `₹${v}`
                                return (
                                  <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                    <td className="px-2 py-1.5 font-medium">{c.transfer_mode}</td>
                                    <td className="px-2 py-1.5">₹{c.min_amount} - {c.max_amount >= 999999 ? '∞' : `₹${c.max_amount}`}</td>
                                    <td className="px-2 py-1.5 text-right font-medium">{fmt(c.retailer_charge, c.retailer_charge_type)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.distributor_commission, c.distributor_commission_type)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.md_commission, c.md_commission_type)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(c.company_charge, c.company_charge_type)}</td>
                                    <td className="px-2 py-1.5 text-center">{c.gst_inclusive ? '✓' : '-'}</td>
                                    <td className="px-2 py-1.5 text-right">{c.vendor_rate || '-'}</td>
                                    <td className="px-2 py-1.5 text-right">{c.company_mdr_rate || '-'}</td>
                                    <td className="px-2 py-1.5 text-right flex gap-1">
                                      <button onClick={() => openConfigModal(scheme.id, 'shadval_settlement', c)} className="text-blue-400 hover:text-blue-600" title="Edit">
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                      <button onClick={() => handleDeleteConfig('scheme_shadval_settlement_charges', c.id)} disabled={deletingConfigId === c.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                        {deletingConfigId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                      </button>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No Settlement-2 charges configured</p>
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
                              <button onClick={() => handleDeleteMapping(m.id)} disabled={deletingMappingId === m.id} className="text-red-400 hover:text-red-600 ml-1 disabled:opacity-50">
                                {deletingMappingId === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
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

        {/* Partner MDR Schemes (B2B partner T+1 auto settlement rates) */}
        <div className="mt-8">
          <PartnerMdrSchemesCard partners={partners} />
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
                      <option value="payout">Settlement-1 Only</option>
                      <option value="mdr">MDR Only</option>
                      <option value="aeps">AEPS Commission Only</option>
                      <option value="aeps_settlement">AEPS Settlement Only</option>
                      <option value="shadval_settlement">Settlement-2 Only</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Priority (lower = higher priority)</label>
                  <input type="number" value={schemeForm.priority} onChange={(e) => setSchemeForm({ ...schemeForm, priority: parseInt(e.target.value) || 100 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20">
                  <input
                    type="checkbox"
                    id="is_partner_plan"
                    checked={schemeForm.is_partner_plan}
                    onChange={(e) => setSchemeForm({ ...schemeForm, is_partner_plan: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                  />
                  <label htmlFor="is_partner_plan" className="text-sm cursor-pointer">
                    <span className="font-medium text-gray-900 dark:text-white">Partner Plan</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">Uses a single MDR rate instead of RT/DT/MD breakdown for easier reconciliation</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowCreateModal(false)} disabled={savingScheme} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSaveScheme} disabled={savingScheme} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                  {savingScheme ? 'Saving...' : editingScheme ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* CONFIG MODAL (BBPS / Settlement / MDR / AEPS) */}
        {/* ================================================================ */}
        {showConfigModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col my-4">
              <div className="px-6 pt-5 pb-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  {configType === 'bbps' && <><CreditCard className="w-5 h-5 text-blue-600" /> {editingConfigId ? 'Edit' : 'Add'} BBPS Commission</>}
                  {configType === 'payout' && <><Banknote className="w-5 h-5 text-green-600" /> {editingConfigId ? 'Edit' : 'Add'} Settlement Charge</>}
                  {configType === 'mdr' && <><TrendingUp className="w-5 h-5 text-orange-600" /> {editingConfigId ? 'Edit' : 'Add'} MDR Rate</>}
                  {configType === 'aeps' && <><Banknote className="w-5 h-5 text-teal-600" /> {editingConfigId ? 'Edit' : 'Add'} AEPS Commission</>}
                  {configType === 'aeps_settlement' && <><DollarSign className="w-5 h-5 text-purple-600" /> {editingConfigId ? 'Edit' : 'Add'} AEPS Settlement Charge</>}
                  {configType === 'shadval_settlement' && <><Banknote className="w-5 h-5 text-rose-600" /> {editingConfigId ? 'Edit' : 'Add'} Settlement Charge</>}
                </h2>
              </div>

              <div className="overflow-y-auto flex-1 min-h-0 px-6 py-4">
              {/* BBPS Form */}
              {configType === 'bbps' && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">BBPS Type</label>
                    <select value={bbpsForm.bbps_type} onChange={(e) => setBbpsForm({ ...bbpsForm, bbps_type: e.target.value as 'bbps_1' | 'bbps_2' })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                      <option value="bbps_1">BBPS 1</option>
                      <option value="bbps_2">BBPS 2</option>
                    </select>
                  </div>
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
                      <input type="number" value={bbpsForm.max_amount} onChange={(e) => setBbpsForm({ ...bbpsForm, max_amount: parseFloat(e.target.value) || 100000 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                  </div>
                  {(() => {
                    const isPartnerPlan = schemes.find(s => s.id === configSchemeId)?.is_partner_plan || false
                    const fields = isPartnerPlan
                      ? [
                          { label: 'Partner Charge', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                          { label: 'Partner Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' },
                          { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                        ]
                      : [
                          { label: 'Retailer Charge', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                          { label: 'Retailer Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' },
                          { label: 'Distributor Commission', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                          { label: 'MD Commission', key: 'md_commission', typeKey: 'md_commission_type' },
                          { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                        ]
                    return (
                      <>
                        {isPartnerPlan && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                            <TrendingUp className="w-4 h-4 text-orange-600" />
                            <span className="text-xs font-medium text-orange-700 dark:text-orange-400">Partner Plan — single rate (no RT/DT/MD breakdown)</span>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {fields.map(({ label, key, typeKey }) => (
                          <div key={key} className="grid grid-cols-3 gap-2 items-end">
                            <div className="col-span-2">
                              <label className="block text-xs font-medium mb-1">{label}</label>
                              <input type="number" step="0.01" value={(bbpsForm as any)[key]}
                                onChange={(e) => setBbpsForm({ ...bbpsForm, [key]: parseFloat(e.target.value) || 0 })}
                                className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                            </div>
                            <div>
                              <select value={(bbpsForm as any)[typeKey]}
                                onChange={(e) => setBbpsForm({ ...bbpsForm, [typeKey]: e.target.value })}
                                className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                                <option value="flat">₹ Flat</option>
                                <option value="percentage">% Pct</option>
                              </select>
                            </div>
                          </div>
                        ))}
                        </div>
                      </>
                    )
                  })()}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={bbpsForm.gst_inclusive}
                        onChange={(e) => setBbpsForm({ ...bbpsForm, gst_inclusive: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">With GST (18% added on top)</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Vendor Rate (%)</label>
                        <input type="number" step="0.0001" value={bbpsForm.vendor_rate}
                          onChange={(e) => setBbpsForm({ ...bbpsForm, vendor_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Company MDR Rate (%)</label>
                        <input type="number" step="0.0001" value={bbpsForm.company_mdr_rate}
                          onChange={(e) => setBbpsForm({ ...bbpsForm, company_mdr_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Payout / Settlement Form */}
              {configType === 'payout' && (
                <div className="space-y-2">
                  {!editingConfigId && (
                    <div>
                      <label className="block text-sm font-medium mb-1">Settlement Type</label>
                      <select value={settlementTypeSelection} onChange={(e) => setSettlementTypeSelection(e.target.value as 'payout' | 'shadval_settlement')}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                        <option value="payout">Settlement-1</option>
                        <option value="shadval_settlement">Settlement-2 (Shadval)</option>
                      </select>
                    </div>
                  )}
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
                      <input type="number" value={payoutForm.max_amount} onChange={(e) => setPayoutForm({ ...payoutForm, max_amount: parseFloat(e.target.value) || 100000 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                  </div>
                  {(() => {
                    const isPartnerPlan = schemes.find(s => s.id === configSchemeId)?.is_partner_plan || false
                    const fields = isPartnerPlan
                      ? [
                          { label: 'Partner Charge', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                          ...(settlementTypeSelection === 'payout' ? [{ label: 'Partner Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' }] : []),
                          { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                        ]
                      : [
                          { label: 'Retailer Charge', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                          ...(settlementTypeSelection === 'payout' ? [{ label: 'Retailer Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' }] : []),
                          { label: 'Distributor Commission', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                          { label: 'MD Commission', key: 'md_commission', typeKey: 'md_commission_type' },
                          { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                        ]
                    return (
                      <>
                        {isPartnerPlan && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                            <TrendingUp className="w-4 h-4 text-orange-600" />
                            <span className="text-xs font-medium text-orange-700 dark:text-orange-400">Partner Plan — single rate (no RT/DT/MD breakdown)</span>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {fields.map(({ label, key, typeKey }) => (
                          <div key={key} className="grid grid-cols-3 gap-2 items-end">
                            <div className="col-span-2">
                              <label className="block text-xs font-medium mb-1">{label}</label>
                              <input type="number" step="0.01" value={(payoutForm as any)[key]}
                                onChange={(e) => setPayoutForm({ ...payoutForm, [key]: parseFloat(e.target.value) || 0 })}
                                className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                            </div>
                            <div>
                              <select value={(payoutForm as any)[typeKey]}
                                onChange={(e) => setPayoutForm({ ...payoutForm, [typeKey]: e.target.value })}
                                className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                                <option value="flat">₹ Flat</option>
                                <option value="percentage">% Pct</option>
                              </select>
                            </div>
                          </div>
                        ))}
                        </div>
                      </>
                    )
                  })()}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={payoutForm.gst_inclusive}
                        onChange={(e) => setPayoutForm({ ...payoutForm, gst_inclusive: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">With GST (18% added on top)</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Vendor Rate (%)</label>
                        <input type="number" step="0.0001" value={payoutForm.vendor_rate}
                          onChange={(e) => setPayoutForm({ ...payoutForm, vendor_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Company MDR Rate (%)</label>
                        <input type="number" step="0.0001" value={payoutForm.company_mdr_rate}
                          onChange={(e) => setPayoutForm({ ...payoutForm, company_mdr_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* MDR Form */}
              {configType === 'mdr' && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Company</label>
                      <select
                        value={mdrForm.merchant_slug}
                        onChange={(e) => setMdrForm({ ...mdrForm, merchant_slug: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
                      >
                        <option value="">All Companies</option>
                        {getPosCompanies().map((c) => (
                          <option key={c.slug} value={c.slug}>{c.shortName}</option>
                        ))}
                      </select>
                    </div>
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
                          brand_type: availableBrands.length > 0 && availableBrands.includes(mdrForm.brand_type) ? mdrForm.brand_type : '',
                          card_classification: ''
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
                    <div>
                      <label className="block text-sm font-medium mb-1">Classification</label>
                      <select
                        value={mdrForm.card_classification}
                        onChange={(e) => setMdrForm({ ...mdrForm, card_classification: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
                        disabled={mdrForm.mode === 'UPI'}
                      >
                        <option value="">Any</option>
                        <option value="CLASSIC">CLASSIC</option>
                        <option value="GOLD">GOLD</option>
                        <option value="PLATINUM">PLATINUM</option>
                        <option value="TITANIUM">TITANIUM</option>
                        <option value="SIGNATURE">SIGNATURE</option>
                        <option value="INFINITE">INFINITE</option>
                        <option value="WORLD">WORLD</option>
                        <option value="BUSINESS">BUSINESS</option>
                        <option value="CORPORATE">CORPORATE</option>
                        <option value="PREMIUM">PREMIUM</option>
                        <option value="STANDARD">STANDARD</option>
                        <option value="OTHER">OTHER</option>
                      </select>
                    </div>
                  </div>
                  {(() => {
                    const configScheme = schemes.find(s => s.id === configSchemeId)
                    const isPartnerPlan = configScheme?.is_partner_plan || false
                    if (isPartnerPlan) {
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                            <TrendingUp className="w-4 h-4 text-orange-600" />
                            <span className="text-xs font-medium text-orange-700 dark:text-orange-400">Partner Plan — Only MDR T+1 and T+0 rates (no RT/DT/MD breakdown)</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-medium mb-1">MDR T+1 (%)</label>
                              <input type="number" step="0.01" value={mdrForm.retailer_mdr_t1}
                                onChange={(e) => {
                                  const t1 = parseFloat(e.target.value) || 0
                                  setMdrForm({ ...mdrForm, retailer_mdr_t1: t1, partner_mdr: t1, retailer_mdr_t0: mdrForm.retailer_mdr_t0 === 0 ? t1 + 1 : mdrForm.retailer_mdr_t0 })
                                }}
                                className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
                                placeholder="e.g. 1.25" />
                            </div>
                            <div>
                              <label className="block text-sm font-medium mb-1">MDR T+0 (%)</label>
                              <input type="number" step="0.01" value={mdrForm.retailer_mdr_t0}
                                onChange={(e) => setMdrForm({ ...mdrForm, retailer_mdr_t0: parseFloat(e.target.value) || 0 })}
                                className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
                                placeholder="e.g. 2.25" />
                            </div>
                          </div>
                          <p className="text-xs text-gray-500">T+0 rate auto-fills as T+1 + 1% if left at 0. Used for reconciliation and Net Pay calculation.</p>
                        </div>
                      )
                    }
                    return (
                      <>
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
                      </>
                    )
                  })()}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={mdrForm.gst_inclusive}
                        onChange={(e) => setMdrForm({ ...mdrForm, gst_inclusive: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">With GST (18% added on top)</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Vendor Rate (%)</label>
                        <input type="number" step="0.0001" value={mdrForm.vendor_rate}
                          onChange={(e) => setMdrForm({ ...mdrForm, vendor_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Company MDR Rate (%)</label>
                        <input type="number" step="0.0001" value={mdrForm.company_mdr_rate}
                          onChange={(e) => setMdrForm({ ...mdrForm, company_mdr_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* AEPS Form */}
              {configType === 'aeps' && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Transaction Type</label>
                    <select value={aepsForm.transaction_type} onChange={(e) => setAepsForm({ ...aepsForm, transaction_type: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                      <option value="cash_withdrawal">Cash Withdrawal</option>
                      <option value="cash_deposit">Cash Deposit</option>
                      <option value="balance_inquiry">Balance Enquiry</option>
                      <option value="mini_statement">Mini Statement</option>
                      <option value="aadhaar_to_aadhaar">Aadhaar to Aadhaar</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Min Amount (₹)</label>
                      <input type="number" value={aepsForm.min_amount} onChange={(e) => setAepsForm({ ...aepsForm, min_amount: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Max Amount (₹)</label>
                      <input type="number" value={aepsForm.max_amount} onChange={(e) => setAepsForm({ ...aepsForm, max_amount: parseFloat(e.target.value) || 100000 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                  </div>
                  {(() => {
                    const isPartnerPlan = schemes.find(s => s.id === configSchemeId)?.is_partner_plan || false
                    const fields = isPartnerPlan
                      ? [
                          { label: 'Partner Pool (base)', key: 'base_commission', typeKey: 'base_commission_type' },
                          { label: 'Company Earning', key: 'company_earning', typeKey: 'company_earning_type' },
                          { label: 'Partner Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' },
                        ]
                      : [
                          { label: 'Partner Pool (base)', key: 'base_commission', typeKey: 'base_commission_type' },
                          { label: 'Company Earning', key: 'company_earning', typeKey: 'company_earning_type' },
                          { label: 'MD Commission', key: 'md_commission', typeKey: 'md_commission_type' },
                          { label: 'Distributor Commission', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                          { label: 'Retailer Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' },
                        ]
                    return (
                      <>
                        <p className="text-xs text-gray-500">
                          {isPartnerPlan
                            ? 'Pool = what the API Partner pays the company. Company profit is taken first; remainder goes to Partner.'
                            : 'Pool = what the API Partner pays the company. Company profit is taken first; remainder cascades MD → DT → RT.'}
                        </p>
                        {isPartnerPlan && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                            <TrendingUp className="w-4 h-4 text-orange-600" />
                            <span className="text-xs font-medium text-orange-700 dark:text-orange-400">Partner Plan — single rate (no RT/DT/MD breakdown)</span>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {fields.map(({ label, key, typeKey }) => (
                          <div key={key} className="grid grid-cols-3 gap-2 items-end">
                            <div className="col-span-2">
                              <label className="block text-xs font-medium mb-1">{label}</label>
                              <input type="number" step="0.0001" value={(aepsForm as any)[key]}
                                onChange={(e) => setAepsForm({ ...aepsForm, [key]: parseFloat(e.target.value) || 0 })}
                                className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                            </div>
                            <div>
                              <select value={(aepsForm as any)[typeKey]}
                                onChange={(e) => setAepsForm({ ...aepsForm, [typeKey]: e.target.value })}
                                className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                                <option value="flat">₹ Flat</option>
                                <option value="percentage">% Pct</option>
                              </select>
                            </div>
                          </div>
                        ))}
                        </div>
                      </>
                    )
                  })()}
                  <div>
                    <label className="block text-xs font-medium mb-1">TDS (%)</label>
                    <input type="number" step="0.01" value={aepsForm.tds_percentage}
                      onChange={(e) => setAepsForm({ ...aepsForm, tds_percentage: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                  {/* Waterfall preview */}
                  {(() => {
                    const p = aepsPreview()
                    return (
                      <div className={`p-3 rounded-lg text-sm border ${p.valid ? 'bg-teal-50 border-teal-200 text-teal-800 dark:bg-teal-900/20 dark:border-teal-800 dark:text-teal-300' : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300'}`}>
                        <div className="font-medium mb-1">Preview at ₹{p.amt}</div>
                        <div>Partner pays ₹{p.base} → Company ₹{p.company} · MD ₹{p.md} · DT ₹{p.dt} · RT ₹{p.rt}</div>
                        <div className="mt-1">Distributed ₹{p.distributed} / Pool ₹{p.base} {p.valid ? '✓ valid' : '✗ exceeds pool'}</div>
                      </div>
                    )
                  })()}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={aepsForm.gst_inclusive}
                        onChange={(e) => setAepsForm({ ...aepsForm, gst_inclusive: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">With GST (18% added on top)</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Vendor Rate (%)</label>
                        <input type="number" step="0.0001" value={aepsForm.vendor_rate}
                          onChange={(e) => setAepsForm({ ...aepsForm, vendor_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Company MDR Rate (%)</label>
                        <input type="number" step="0.0001" value={aepsForm.company_mdr_rate}
                          onChange={(e) => setAepsForm({ ...aepsForm, company_mdr_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* AEPS Settlement Form */}
              {configType === 'aeps_settlement' && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Min Amount (₹)</label>
                      <input type="number" value={aepsSettleForm.min_amount} onChange={(e) => setAepsSettleForm({ ...aepsSettleForm, min_amount: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Max Amount (₹)</label>
                      <input type="number" value={aepsSettleForm.max_amount} onChange={(e) => setAepsSettleForm({ ...aepsSettleForm, max_amount: parseFloat(e.target.value) || 100000 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">Retailer charge is deducted from AEPS wallet on settlement. Margins are distributed to DT/MD/Company.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: 'Retailer Charge (deducted)', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                    { label: 'Distributor Margin', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                    { label: 'MD Margin', key: 'md_commission', typeKey: 'md_commission_type' },
                    { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                  ].map(({ label, key, typeKey }) => (
                    <div key={key} className="grid grid-cols-3 gap-2 items-end">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium mb-1">{label}</label>
                        <input type="number" step="0.01" value={(aepsSettleForm as any)[key]}
                          onChange={(e) => setAepsSettleForm({ ...aepsSettleForm, [key]: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                      </div>
                      <div>
                        <select value={(aepsSettleForm as any)[typeKey]}
                          onChange={(e) => setAepsSettleForm({ ...aepsSettleForm, [typeKey]: e.target.value })}
                          className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                          <option value="flat">₹ Flat</option>
                          <option value="percentage">% Pct</option>
                        </select>
                      </div>
                    </div>
                  ))}
                  </div>
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={aepsSettleForm.gst_inclusive}
                        onChange={(e) => setAepsSettleForm({ ...aepsSettleForm, gst_inclusive: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">With GST (18% added on top)</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Vendor Rate (%)</label>
                        <input type="number" step="0.0001" value={aepsSettleForm.vendor_rate}
                          onChange={(e) => setAepsSettleForm({ ...aepsSettleForm, vendor_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Company MDR Rate (%)</label>
                        <input type="number" step="0.0001" value={aepsSettleForm.company_mdr_rate}
                          onChange={(e) => setAepsSettleForm({ ...aepsSettleForm, company_mdr_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Settlement-2 (Shadval Pay) Form */}
              {configType === 'shadval_settlement' && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Transfer Mode</label>
                    <select value={shadvalSettleForm.transfer_mode} onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, transfer_mode: e.target.value as any })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                      <option value="IMPS">IMPS</option>
                      <option value="NEFT">NEFT</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Min Amount (₹)</label>
                      <input type="number" value={shadvalSettleForm.min_amount} onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, min_amount: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Max Amount (₹)</label>
                      <input type="number" value={shadvalSettleForm.max_amount} onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, max_amount: parseFloat(e.target.value) || 100000 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">Retailer charge is deducted on Settlement-2 (Shadval) payout. Margins go to DT/MD/Company.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: 'Retailer Charge (deducted)', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                    { label: 'Distributor Margin', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                    { label: 'MD Margin', key: 'md_commission', typeKey: 'md_commission_type' },
                    { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                  ].map(({ label, key, typeKey }) => (
                    <div key={key} className="grid grid-cols-3 gap-2 items-end">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium mb-1">{label}</label>
                        <input type="number" step="0.01" value={(shadvalSettleForm as any)[key]}
                          onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, [key]: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                      </div>
                      <div>
                        <select value={(shadvalSettleForm as any)[typeKey]}
                          onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, [typeKey]: e.target.value })}
                          className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                          <option value="flat">₹ Flat</option>
                          <option value="percentage">% Pct</option>
                        </select>
                      </div>
                    </div>
                  ))}
                  </div>
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={shadvalSettleForm.gst_inclusive}
                        onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, gst_inclusive: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">With GST (18% added on top)</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Vendor Rate (%)</label>
                        <input type="number" step="0.0001" value={shadvalSettleForm.vendor_rate}
                          onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, vendor_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Company MDR Rate (%)</label>
                        <input type="number" step="0.0001" value={shadvalSettleForm.company_mdr_rate}
                          onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, company_mdr_rate: parseFloat(e.target.value) || 0 })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="0" />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              </div>

              <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 shrink-0 flex justify-end gap-2">
                <button onClick={() => setShowConfigModal(false)} disabled={savingConfig} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSaveConfig} disabled={savingConfig} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                  {savingConfig ? 'Saving...' : editingConfigId ? 'Update Configuration' : 'Save Configuration'}
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
                  {(() => {
                    const isPartnerPlan = schemes.find(s => s.id === mappingSchemeId)?.is_partner_plan
                    const mappableRoles = getMappableRoles(isPartnerPlan)
                    return (
                      <>
                        <select value={mappingForm.entity_role} onChange={(e) => setMappingForm({ ...mappingForm, entity_role: e.target.value, entity_id: '' })}
                          disabled={isPartnerPlan}
                          className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700 disabled:opacity-70 disabled:cursor-not-allowed">
                          {mappableRoles.map(role => (
                            <option key={role.value} value={role.value}>{role.label}</option>
                          ))}
                        </select>
                        {isPartnerPlan && (
                          <p className="mt-1 text-xs text-purple-600 dark:text-purple-400">This is a Partner Plan — it can only be assigned to Partners.</p>
                        )}
                      </>
                    )
                  })()}
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
                    <option value="payout">Settlement-1 Only</option>
                    <option value="mdr">MDR Only</option>
                    <option value="aeps">AEPS Commission Only</option>
                    <option value="aeps_settlement">AEPS Settlement Only</option>
                    <option value="shadval_settlement">Settlement-2 Only</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowMappingModal(false)} disabled={savingMapping} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSaveMapping} disabled={!mappingForm.entity_id || savingMapping}
                  className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                  {savingMapping ? 'Assigning...' : 'Assign Scheme'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

