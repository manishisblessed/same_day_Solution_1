'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { 
  TrendingUp, DollarSign, Users, Activity, 
  LogOut, Package, Network, BarChart3,
  ArrowUpRight, ArrowDownRight, UserPlus
} from 'lucide-react'
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import AnimatedSection from '@/components/AnimatedSection'

export default function DistributorDashboard() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalRetailers: 0,
    activeRetailers: 0,
    totalRevenue: 0,
    commissionEarned: 0,
  })

  const [retailers, setRetailers] = useState<any[]>([])
  const [chartData, setChartData] = useState<any[]>([])
  const [pieData, setPieData] = useState<any[]>([])

  const COLORS = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ef4444']

  useEffect(() => {
    if (!user || user.role !== 'distributor') {
      router.push('/business-login')
      return
    }
    fetchDashboardData()
  }, [user, router])

  const fetchDashboardData = async () => {
    if (!user) return
    setLoading(true)
    try {
      // Fetch distributor data
      const { data: distributorData } = await supabase
        .from('distributors')
        .select('*')
        .eq('email', user.email)
        .single()

      // Fetch retailers under this distributor
      const { data: retailersData } = await supabase
        .from('retailers')
        .select('*')
        .eq('distributor_id', distributorData?.partner_id || '')
        .order('created_at', { ascending: false })
        .limit(10)

      setRetailers(retailersData || [])

      // Mock data for demo
      setStats({
        totalRetailers: retailersData?.length || 45,
        activeRetailers: 38,
        totalRevenue: 1245680,
        commissionEarned: 12456.80,
      })

      setChartData([
        { name: 'Mon', retailers: 42, revenue: 45000 },
        { name: 'Tue', retailers: 45, revenue: 52000 },
        { name: 'Wed', retailers: 43, revenue: 48000 },
        { name: 'Thu', retailers: 48, revenue: 55000 },
        { name: 'Fri', retailers: 46, revenue: 51000 },
        { name: 'Sat', retailers: 50, revenue: 60000 },
        { name: 'Sun', retailers: 47, revenue: 54000 },
      ])

      setPieData([
        { name: 'Active', value: 38 },
        { name: 'Inactive', value: 5 },
        { name: 'Suspended', value: 2 },
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
              <h1 className="text-2xl font-bold text-gray-900">Distributor Dashboard</h1>
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
            <div className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-sm font-medium">Total Retailers</p>
                  <p className="text-3xl font-bold mt-2">{stats.totalRetailers}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <ArrowUpRight className="w-4 h-4" />
                    <span className="text-sm text-blue-100">+3 this month</span>
                  </div>
                </div>
                <Users className="w-12 h-12 text-blue-200" />
              </div>
            </div>

            <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm font-medium">Active Retailers</p>
                  <p className="text-3xl font-bold mt-2">{stats.activeRetailers}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <ArrowUpRight className="w-4 h-4" />
                    <span className="text-sm text-green-100">84% active rate</span>
                  </div>
                </div>
                <UserPlus className="w-12 h-12 text-green-200" />
              </div>
            </div>

            <div className="card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-purple-100 text-sm font-medium">Total Revenue</p>
                  <p className="text-3xl font-bold mt-2">₹{stats.totalRevenue.toLocaleString()}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <ArrowUpRight className="w-4 h-4" />
                    <span className="text-sm text-purple-100">+12% from last month</span>
                  </div>
                </div>
                <DollarSign className="w-12 h-12 text-purple-200" />
              </div>
            </div>

            <div className="card bg-gradient-to-br from-orange-500 to-orange-600 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-orange-100 text-sm font-medium">Commission Earned</p>
                  <p className="text-3xl font-bold mt-2">₹{stats.commissionEarned.toLocaleString()}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <ArrowUpRight className="w-4 h-4" />
                    <span className="text-sm text-orange-100">+18% from last month</span>
                  </div>
                </div>
                <TrendingUp className="w-12 h-12 text-orange-200" />
              </div>
            </div>
          </div>
        </AnimatedSection>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <AnimatedSection delay={0.1}>
            <div className="card lg:col-span-2">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Retailer Network Performance</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="retailers" stroke="#3b82f6" strokeWidth={2} name="Active Retailers" />
                  <Line type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} name="Revenue (₹)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </AnimatedSection>

          <AnimatedSection delay={0.2}>
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Retailer Status</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${percent ? (percent * 100).toFixed(0) : 0}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </AnimatedSection>
        </div>

        {/* Retailers List */}
        <AnimatedSection delay={0.3}>
          <div className="card">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">Top Retailers</h3>
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Performance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {retailers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                        No retailers found
                      </td>
                    </tr>
                  ) : (
                    retailers.map((retailer) => (
                      <tr key={retailer.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {retailer.partner_id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {retailer.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {retailer.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            retailer.status === 'active' 
                              ? 'bg-green-100 text-green-800' 
                              : retailer.status === 'inactive'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {retailer.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-gray-200 rounded-full h-2">
                              <div className="bg-green-500 h-2 rounded-full" style={{ width: '75%' }}></div>
                            </div>
                            <span className="text-sm text-gray-600">75%</span>
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

