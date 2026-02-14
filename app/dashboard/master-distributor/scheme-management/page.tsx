'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import MasterDistributorSidebar from '@/components/MasterDistributorSidebar'
import { 
  Plus, Edit2, Trash2, ChevronDown, ChevronUp, Search,
  Layers, CreditCard, Banknote, TrendingUp, Users, Link2,
  Save, X, AlertCircle, CheckCircle, Settings, Eye, ArrowLeft
} from 'lucide-react'

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
  bbps_commissions?: any[]
  payout_charges?: any[]
  mdr_rates?: any[]
  mappings?: any[]
  mapping_count?: number
}

export default function MasterDistributorSchemeManagementPage() {
  const { user } = useAuth()
  const router = useRouter()
  
  // Redirect to tab-based route
  useEffect(() => {
    router.replace('/dashboard/master-distributor?tab=scheme-management')
  }, [router])
  
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [schemes, setSchemes] = useState<Scheme[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedSchemeId, setExpandedSchemeId] = useState<string | null>(null)
  const [editingScheme, setEditingScheme] = useState<Scheme | null>(null)
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [mappingSchemeId, setMappingSchemeId] = useState<string>('')
  const [distributors, setDistributors] = useState<any[]>([])

  const [schemeForm, setSchemeForm] = useState({
    name: '',
    description: '',
    scheme_type: 'custom' as 'custom',
    service_scope: 'all' as string,
    priority: 100,
  })

  // Fetch schemes created by this MD
  const fetchSchemes = useCallback(async () => {
    if (!user?.partner_id) return
    setLoading(true)
    try {
      let query = supabase
        .from('schemes')
        .select('*')
        .eq('created_by_id', user.partner_id)
        .eq('created_by_role', 'master_distributor')
        .order('created_at', { ascending: false })
      
      const { data, error } = await query
      if (error) throw error
      
      let filtered = data || []
      if (searchQuery) {
        filtered = filtered.filter(s => 
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
        )
      }
      
      // Fetch mapping counts
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
      
      setSchemes(filtered)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.partner_id, searchQuery])

  // Fetch distributors under this MD
  const fetchDistributors = useCallback(async () => {
    if (!user?.partner_id) return
    try {
      const { data, error } = await supabase
        .from('distributors')
        .select('partner_id, name, email, status')
        .eq('master_distributor_id', user.partner_id)
        .eq('status', 'active')
      
      if (error) throw error
      setDistributors(data || [])
    } catch (err: any) {
      console.error('Error fetching distributors:', err)
    }
  }, [user?.partner_id])

  useEffect(() => {
    if (user?.role !== 'master_distributor') {
      router.push('/dashboard/master-distributor')
      return
    }
    fetchSchemes()
    fetchDistributors()
  }, [user, fetchSchemes, fetchDistributors, router])

  const toggleExpand = async (schemeId: string) => {
    if (expandedSchemeId === schemeId) {
      setExpandedSchemeId(null)
      return
    }
    
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
      const [distNames, retNames] = await Promise.all([
        supabase.from('distributors').select('partner_id, name, business_name').in('partner_id', entityIds),
        supabase.from('retailers').select('partner_id, name, business_name').in('partner_id', entityIds),
      ])
      const nameMap: Record<string, string> = {}
      distNames.data?.forEach((d: any) => { nameMap[d.partner_id] = d.business_name || d.name })
      retNames.data?.forEach((r: any) => { nameMap[r.partner_id] = r.business_name || r.name })
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

  const openCreateModal = () => {
    setSchemeForm({ name: '', description: '', scheme_type: 'custom', service_scope: 'all', priority: 100 })
    setEditingScheme(null)
    setShowCreateModal(true)
  }

  const handleSaveScheme = async () => {
    if (!user?.partner_id) return
    try {
      if (editingScheme) {
        const { error } = await supabase.from('schemes').update({
          name: schemeForm.name,
          description: schemeForm.description || null,
          service_scope: schemeForm.service_scope,
        }).eq('id', editingScheme.id)
        if (error) throw error
        setSuccess('Scheme updated successfully')
      } else {
        const { error } = await supabase.from('schemes').insert({
          name: schemeForm.name,
          description: schemeForm.description || null,
          scheme_type: 'custom',
          service_scope: schemeForm.service_scope,
          priority: 100,
          created_by_id: user.partner_id,
          created_by_role: 'master_distributor',
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

  const openMappingModal = (schemeId: string) => {
    setMappingSchemeId(schemeId)
    setShowMappingModal(true)
  }

  const handleMapScheme = async (distributorId: string) => {
    try {
      // Check if mapping already exists
      const { data: existing } = await supabase
        .from('scheme_mappings')
        .select('id')
        .eq('scheme_id', mappingSchemeId)
        .eq('entity_id', distributorId)
        .eq('entity_role', 'distributor')
        .eq('status', 'active')
        .maybeSingle()

      if (existing) {
        setError('Scheme already mapped to this distributor')
        return
      }

      // Deactivate any existing mapping for this distributor
      await supabase
        .from('scheme_mappings')
        .update({ status: 'inactive' })
        .eq('entity_id', distributorId)
        .eq('entity_role', 'distributor')

      // Create new mapping
      const { error } = await supabase.from('scheme_mappings').insert({
        scheme_id: mappingSchemeId,
        entity_id: distributorId,
        entity_role: 'distributor',
        assigned_by_id: user?.partner_id,
        assigned_by_role: 'master_distributor',
        status: 'active',
        priority: 100,
      })

      if (error) throw error
      setSuccess('Scheme mapped successfully')
      setShowMappingModal(false)
      fetchSchemes()
    } catch (err: any) {
      setError(err.message)
    }
  }

  if (!user || user.role !== 'master_distributor') {
    return <div>Loading...</div>
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <MasterDistributorSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <main className="flex-1 lg:ml-56 p-4 md:p-6">
        <div className="mb-6 sticky top-4 z-10 bg-gray-50 dark:bg-gray-950 pb-4 -mx-4 md:-mx-6 px-4 md:px-6 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-4">
              <button onClick={() => router.push('/dashboard/master-distributor')} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Layers className="w-7 h-7 text-yellow-600" />
                  Scheme Management
                </h1>
                <p className="text-sm text-gray-500 mt-1">Create and assign custom schemes to your distributors</p>
              </div>
            </div>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-600 to-yellow-700 text-white rounded-lg hover:opacity-90 transition font-medium text-sm whitespace-nowrap flex-shrink-0"
            >
              <Plus className="w-4 h-4" /> Create Scheme
            </button>
          </div>

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
        </div>

        {loading ? (
          <div className="text-center py-12">Loading schemes...</div>
        ) : schemes.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Layers className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p>No schemes created yet</p>
            <button onClick={openCreateModal} className="mt-4 text-yellow-600 hover:underline">Create your first scheme</button>
          </div>
        ) : (
          <div className="space-y-4">
            {schemes.map((scheme) => (
              <div key={scheme.id} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(scheme.id)}>
                  <div className="flex items-center gap-3 flex-1">
                    <Settings className="w-5 h-5 text-yellow-600" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{scheme.name}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {scheme.service_scope} • {scheme.mapping_count || 0} mappings
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); openMappingModal(scheme.id) }}
                      className="p-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-600" title="Map to Distributor">
                      <Link2 className="w-4 h-4" />
                    </button>
                    {expandedSchemeId === scheme.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>

                {expandedSchemeId === scheme.id && (
                  <div className="border-t border-gray-200 dark:border-gray-800 p-4 space-y-4 bg-gray-50 dark:bg-gray-800/30">
                    {scheme.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 italic">{scheme.description}</p>
                    )}
                    
                    <div>
                      <h4 className="font-semibold text-sm mb-2">Mapped Distributors ({scheme.mappings?.length || 0})</h4>
                      {scheme.mappings && scheme.mappings.length > 0 ? (
                        <div className="space-y-1.5">
                          {scheme.mappings.map((m: any) => (
                            <div key={m.id} className="flex items-center gap-2 px-3 py-1.5 bg-teal-50 dark:bg-teal-900/20 rounded-lg text-xs">
                              <span className="px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400 text-[10px] font-semibold uppercase">{m.entity_role}</span>
                              {m.entity_name && (
                                <span className="font-semibold text-gray-900 dark:text-white">{m.entity_name}</span>
                              )}
                              <span className="text-gray-500 dark:text-gray-400">({m.entity_id})</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No distributors mapped yet</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold mb-4">{editingScheme ? 'Edit Scheme' : 'Create Scheme'}</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Scheme Name</label>
                  <input type="text" value={schemeForm.name} onChange={(e) => setSchemeForm({ ...schemeForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="e.g., Premium Distributor Plan" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea value={schemeForm.description} onChange={(e) => setSchemeForm({ ...schemeForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" rows={3} placeholder="Optional description" />
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
              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSaveScheme} className="px-4 py-2 text-sm bg-yellow-600 text-white rounded-lg hover:bg-yellow-700">
                  {editingScheme ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mapping Modal */}
        {showMappingModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold mb-4">Map Scheme to Distributor</h2>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {distributors.length === 0 ? (
                  <p className="text-sm text-gray-500">No distributors available</p>
                ) : (
                  distributors.map((dist) => (
                    <button
                      key={dist.partner_id}
                      onClick={() => handleMapScheme(dist.partner_id)}
                      className="w-full text-left p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                    >
                      <div className="font-medium">{dist.name}</div>
                      <div className="text-xs text-gray-500">{dist.partner_id}</div>
                    </button>
                  ))
                )}
              </div>
              <button onClick={() => setShowMappingModal(false)} className="mt-4 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg w-full">Close</button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

