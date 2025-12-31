'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { 
  TrendingUp, DollarSign, Users, Activity, 
  LogOut, Crown, Network, BarChart3,
  ArrowUpRight, Building2, Globe
} from 'lucide-react'
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import AnimatedSection from '@/components/AnimatedSection'

export default function MasterDistributorDashboard() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalDistributors: 0,
    totalRetailers: 0,
    totalRevenue: 0,
    commissionEarned: 0,
  })

  const [distributors, setDistributors] = useState<any[]>([])
  const [chartData, setChartData] = useState<any[]>([])
  const [revenueData, setRevenueData] = useState<any[]>([])

  useEffect(() => {
    if (!user || user.role !== 'master_distributor') {
      router.push('/business-login')
      return
    }
    fetchDashboardData()
  }, [user, router])

  const fetchDashboardData = async () => {
    if (!user) return
    setLoading(true)
    try {
      // Fetch master distributor data
      const { data: masterDistributorData } = await supabase
        .from('master_distributors')
        .select('*')
        .eq('email', user.email)
        .single()

      // Fetch distributors under this master distributor
      const { data: distributorsData } = await supabase
        .from('distributors')
        .select('*')
        .eq('master_distributor_id', masterDistributorData?.partner_id || '')
        .order('created_at', { ascending: false })
        .limit(10)

      setDistributors(distributorsData || [])

      // Fetch retailers count
      const { data: retailersData } = await supabase
        .from('retailers')
        .select('id')
        .eq('master_distributor_id', masterDistributorData?.partner_id || '')

      // Mock data for demo
      setStats({
        totalDistributors: distributorsData?.length || 12,
        totalRetailers: retailersData?.length || 450,
        totalRevenue: 5245680,
        commissionEarned: 52456.80,
      })

      setChartData([
        { name: 'Mon', distributors: 10, retailers: 420 },
        { name: 'Tue', distributors: 11, retailers: 435 },
        { name: 'Wed', distributors: 11, retailers: 430 },
        { name: 'Thu', distributors: 12, retailers: 445 },
        { name: 'Fri', distributors: 12, retailers: 440 },
        { name: 'Sat', distributors: 12, retailers: 450 },
        { name: 'Sun', distributors: 12, retailers: 445 },
      ])

      setRevenueData([
        { name: 'Jan', revenue: 4200000, commission: 42000 },
        { name: 'Feb', revenue: 4500000, commission: 45000 },
        { name: 'Mar', revenue: 4800000, commission: 48000 },
        { name: 'Apr', revenue: 5000000, commission: 50000 },
        { name: 'May', revenue: 5100000, commission: 51000 },
        { name: 'Jun', revenue: 5245680, commission: 52456 },
      ])
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await logout()
    router.push('/business-login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Crown className="w-6 h-6 text-yellow-500" />
                Master Distributor Dashboard
              </h1>
              <p className="text-sm text-gray-600">Welcome back, {user?.name || user?.email}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-gray-600">Partner ID</p>
                <p className="text-sm font-semibold text-gray-900">{user?.partner_id}</p>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <AnimatedSection>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="card bg-gradient-to-br from-yellow-500 to-yellow-600 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-yellow-100 text-sm font-medium">Total Distributors</p>
                  <p className="text-3xl font-bold mt-2">{stats.totalDistributors}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <ArrowUpRight className="w-4 h-4" />
                    <span className="text-sm text-yellow-100">+2 this month</span>
                  </div>
                </div>
                <Building2 className="w-12 h-12 text-yellow-200" />
              </div>
            </div>

            <div className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-sm font-medium">Total Retailers</p>
                  <p className="text-3xl font-bold mt-2">{stats.totalRetailers}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <ArrowUpRight className="w-4 h-4" />
                    <span className="text-sm text-blue-100">+25 this month</span>
                  </div>
                </div>
                <Users className="w-12 h-12 text-blue-200" />
              </div>
            </div>

            <div className="card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-purple-100 text-sm font-medium">Total Revenue</p>
                  <p className="text-3xl font-bold mt-2">₹{(stats.totalRevenue / 100000).toFixed(1)}L</p>
                  <div className="flex items-center gap-1 mt-2">
                    <ArrowUpRight className="w-4 h-4" />
                    <span className="text-sm text-purple-100">+15% from last month</span>
                  </div>
                </div>
                <DollarSign className="w-12 h-12 text-purple-200" />
              </div>
            </div>

            <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm font-medium">Commission Earned</p>
                  <p className="text-3xl font-bold mt-2">₹{stats.commissionEarned.toLocaleString()}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <ArrowUpRight className="w-4 h-4" />
                    <span className="text-sm text-green-100">+20% from last month</span>
                  </div>
                </div>
                <TrendingUp className="w-12 h-12 text-green-200" />
              </div>
            </div>
          </div>
        </AnimatedSection>

        {/* Network Growth Chart */}
        <AnimatedSection delay={0.1}>
          <div className="card mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Network Growth</h3>
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorDistributors" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorRetailers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="distributors" stroke="#f97316" fillOpacity={1} fill="url(#colorDistributors)" name="Distributors" />
                <Area type="monotone" dataKey="retailers" stroke="#3b82f6" fillOpacity={1} fill="url(#colorRetailers)" name="Retailers" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </AnimatedSection>

        {/* Revenue & Commission Chart */}
        <AnimatedSection delay={0.2}>
          <div className="card mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue & Commission Trends</h3>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="revenue" fill="#3b82f6" name="Revenue (₹)" />
                <Bar yAxisId="right" dataKey="commission" fill="#22c55e" name="Commission (₹)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AnimatedSection>

        {/* Distributors List */}
        <AnimatedSection delay={0.3}>
          <div className="card">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">Top Distributors</h3>
              <button className="text-primary-600 hover:text-primary-700 text-sm font-medium">
                View All
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Partner ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Retailers</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Performance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {distributors.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                        No distributors found
                      </td>
                    </tr>
                  ) : (
                    distributors.map((distributor) => (
                      <tr key={distributor.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {distributor.partner_id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {distributor.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {distributor.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {Math.floor(Math.random() * 50) + 20}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            distributor.status === 'active' 
                              ? 'bg-green-100 text-green-800' 
                              : distributor.status === 'inactive'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {distributor.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-gray-200 rounded-full h-2">
                              <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.floor(Math.random() * 30) + 70}%` }}></div>
                            </div>
                            <span className="text-sm text-gray-600">{Math.floor(Math.random() * 30) + 70}%</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </div>
  )
}

