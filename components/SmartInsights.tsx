'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Lightbulb, Target, Clock, Users, IndianRupee, Zap, Award,
  ChevronRight, Sparkles, BarChart3, ArrowUpRight, Bell, Receipt
} from 'lucide-react'

interface Insight {
  id: string
  type: 'success' | 'warning' | 'info' | 'opportunity'
  title: string
  description: string
  metric?: string
  metricLabel?: string
  action?: string
  priority: 'high' | 'medium' | 'low'
}

interface SmartInsightsProps {
  userRole: 'admin' | 'retailer' | 'distributor' | 'master_distributor'
  stats?: {
    revenue?: number
    transactions?: number
    growth?: number
    activeUsers?: number
  }
}

export default function SmartInsights({ userRole, stats }: SmartInsightsProps) {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [activeInsight, setActiveInsight] = useState(0)

  useEffect(() => {
    generateInsights()
  }, [userRole, stats])

  const generateInsights = () => {
    setLoading(true)
    
    // Generate smart insights based on role and stats
    const generatedInsights: Insight[] = []

    if (userRole === 'admin') {
      generatedInsights.push(
        {
          id: '1',
          type: 'success',
          title: 'Network Growth',
          description: 'Your partner network has grown by 15% this month. Consider expanding into new regions.',
          metric: '+15%',
          metricLabel: 'Growth Rate',
          action: 'View Network Analytics',
          priority: 'high'
        },
        {
          id: '2',
          type: 'opportunity',
          title: 'Revenue Opportunity',
          description: 'AEPS transactions show 23% higher margins. Promote this service to boost profits.',
          metric: '₹2.5L',
          metricLabel: 'Potential Revenue',
          action: 'Launch Campaign',
          priority: 'high'
        },
        {
          id: '3',
          type: 'warning',
          title: 'Verification Pending',
          description: 'Some partner verifications are pending. Complete them to activate services.',
          action: 'Review Pending',
          priority: 'medium'
        }
      )
    } else if (userRole === 'retailer') {
      generatedInsights.push(
        {
          id: '1',
          type: 'success',
          title: 'Peak Hours Identified',
          description: 'Your busiest hours are 10 AM - 1 PM. Keep adequate wallet balance during this time.',
          metric: '₹45K',
          metricLabel: 'Peak Volume',
          action: 'View Analytics',
          priority: 'high'
        },
        {
          id: '2',
          type: 'opportunity',
          title: 'Unlock More Services',
          description: 'Add AEPS services to earn 40% higher commissions on each transaction.',
          metric: '+40%',
          metricLabel: 'Extra Earnings',
          action: 'Enable AEPS',
          priority: 'high'
        },
        {
          id: '3',
          type: 'info',
          title: 'Commission Update',
          description: 'New commission structure effective from next month with improved rates.',
          action: 'View Details',
          priority: 'medium'
        }
      )
    } else if (userRole === 'distributor') {
      generatedInsights.push(
        {
          id: '1',
          type: 'success',
          title: 'Top Performing Retailer',
          description: 'Nishant Computers has done 150+ transactions this week. Reward loyalty!',
          metric: '150+',
          metricLabel: 'Transactions',
          action: 'View Retailer',
          priority: 'high'
        },
        {
          id: '2',
          type: 'warning',
          title: 'Inactive Retailers Alert',
          description: '3 retailers have been inactive for 7+ days. Reach out to re-engage them.',
          metric: '3',
          metricLabel: 'Need Attention',
          action: 'Contact Now',
          priority: 'high'
        },
        {
          id: '3',
          type: 'opportunity',
          title: 'Expansion Opportunity',
          description: 'Your area has demand for 10 more retailers. Onboard new partners!',
          metric: '10',
          metricLabel: 'Potential',
          action: 'Start Onboarding',
          priority: 'medium'
        }
      )
    } else if (userRole === 'master_distributor') {
      generatedInsights.push(
        {
          id: '1',
          type: 'success',
          title: 'Network Revenue Up',
          description: 'Your entire network generated ₹50L this month, up 20% from last month.',
          metric: '₹50L',
          metricLabel: 'Monthly Revenue',
          action: 'View Report',
          priority: 'high'
        },
        {
          id: '2',
          type: 'opportunity',
          title: 'Distributor Potential',
          description: 'Shailesh Pandey is ready for upgrade. They have consistently hit targets.',
          action: 'Review Profile',
          priority: 'medium'
        },
        {
          id: '3',
          type: 'info',
          title: 'Regional Performance',
          description: 'North region is outperforming by 35%. Apply successful strategies elsewhere.',
          metric: '+35%',
          metricLabel: 'Above Average',
          action: 'View Analysis',
          priority: 'medium'
        }
      )
    }

    setInsights(generatedInsights)
    setLoading(false)
  }

  const getTypeStyles = (type: Insight['type']) => {
    switch (type) {
      case 'success':
        return {
          bg: 'from-emerald-500/20 to-green-500/20',
          border: 'border-emerald-500/30',
          icon: CheckCircle2,
          iconBg: 'bg-emerald-500',
          text: 'text-emerald-600 dark:text-emerald-400'
        }
      case 'warning':
        return {
          bg: 'from-amber-500/20 to-orange-500/20',
          border: 'border-amber-500/30',
          icon: AlertTriangle,
          iconBg: 'bg-amber-500',
          text: 'text-amber-600 dark:text-amber-400'
        }
      case 'opportunity':
        return {
          bg: 'from-blue-500/20 to-indigo-500/20',
          border: 'border-blue-500/30',
          icon: Lightbulb,
          iconBg: 'bg-blue-500',
          text: 'text-blue-600 dark:text-blue-400'
        }
      case 'info':
        return {
          bg: 'from-purple-500/20 to-pink-500/20',
          border: 'border-purple-500/30',
          icon: Sparkles,
          iconBg: 'bg-purple-500',
          text: 'text-purple-600 dark:text-purple-400'
        }
    }
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl p-6 shadow-xl border border-gray-700 overflow-hidden relative"
    >
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-purple-500/10 to-blue-500/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-full blur-3xl"></div>
      
      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Smart Insights
                <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded-full font-medium">
                  AI Powered
                </span>
              </h3>
              <p className="text-xs text-gray-400">Personalized recommendations for you</p>
            </div>
          </div>
          <div className="flex gap-1">
            {insights.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setActiveInsight(idx)}
                className={`w-2 h-2 rounded-full transition-all ${
                  activeInsight === idx
                    ? 'w-6 bg-purple-500'
                    : 'bg-gray-600 hover:bg-gray-500'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Insights Carousel */}
        <AnimatePresence mode="wait">
          {insights[activeInsight] && (
            <motion.div
              key={insights[activeInsight].id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              {(() => {
                const insight = insights[activeInsight]
                const styles = getTypeStyles(insight.type)
                const Icon = styles.icon
                
                return (
                  <div className={`bg-gradient-to-r ${styles.bg} rounded-xl p-5 border ${styles.border}`}>
                    <div className="flex items-start gap-4">
                      <div className={`p-2.5 ${styles.iconBg} rounded-lg flex-shrink-0`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-white">{insight.title}</h4>
                          {insight.priority === 'high' && (
                            <span className="px-2 py-0.5 bg-red-500/20 text-red-300 text-xs rounded-full">
                              Priority
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-300 mb-3">{insight.description}</p>
                        
                        <div className="flex items-center justify-between">
                          {insight.metric && (
                            <div className="flex items-center gap-2">
                              <span className={`text-2xl font-bold ${styles.text}`}>
                                {insight.metric}
                              </span>
                              <span className="text-xs text-gray-400">{insight.metricLabel}</span>
                            </div>
                          )}
                          {insight.action && (
                            <button className="flex items-center gap-1 text-sm text-purple-300 hover:text-purple-200 transition-colors font-medium">
                              {insight.action}
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick Stats Row */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-emerald-400 mb-1">
              <TrendingUp className="w-3 h-3" />
              <span className="text-xs font-medium">Growth</span>
            </div>
            <p className="text-lg font-bold text-white">+{stats?.growth || 12}%</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-blue-400 mb-1">
              <Target className="w-3 h-3" />
              <span className="text-xs font-medium">Target</span>
            </div>
            <p className="text-lg font-bold text-white">85%</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-amber-400 mb-1">
              <Award className="w-3 h-3" />
              <span className="text-xs font-medium">Rank</span>
            </div>
            <p className="text-lg font-bold text-white">#12</p>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// Goal Progress Component
export function GoalProgress({ 
  current, 
  target, 
  label, 
  color = 'primary' 
}: { 
  current: number
  target: number
  label: string
  color?: 'primary' | 'success' | 'warning' | 'danger'
}) {
  const percentage = Math.min((current / target) * 100, 100)
  
  const colorClasses = {
    primary: 'from-blue-500 to-indigo-600',
    success: 'from-emerald-500 to-green-600',
    warning: 'from-amber-500 to-orange-600',
    danger: 'from-red-500 to-rose-600'
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md border border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {current.toLocaleString()} / {target.toLocaleString()}
        </span>
      </div>
      <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className={`h-full bg-gradient-to-r ${colorClasses[color]} rounded-full`}
        />
      </div>
      <div className="mt-2 text-right">
        <span className={`text-sm font-bold ${
          percentage >= 100 ? 'text-emerald-500' : 'text-gray-600 dark:text-gray-400'
        }`}>
          {percentage.toFixed(0)}%
        </span>
      </div>
    </div>
  )
}

// Quick Action Button Component
export function QuickActionButton({
  icon: Icon,
  label,
  onClick,
  color = 'blue'
}: {
  icon: any
  label: string
  onClick?: () => void
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'pink'
}) {
  const colorClasses = {
    blue: 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400',
    green: 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
    purple: 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400',
    orange: 'bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400',
    pink: 'bg-pink-500/10 hover:bg-pink-500/20 text-pink-600 dark:text-pink-400'
  }

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-2 p-4 rounded-xl transition-all ${colorClasses[color]} hover:scale-105`}
    >
      <Icon className="w-6 h-6" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}

// Activity Feed Component
export function ActivityFeed({ 
  activities 
}: { 
  activities: Array<{
    id: string
    type: 'transaction' | 'user' | 'system' | 'commission'
    message: string
    time: string
    amount?: string
  }> 
}) {
  const typeIcons = {
    transaction: Receipt,
    user: Users,
    system: Bell,
    commission: IndianRupee
  }

  const typeColors = {
    transaction: 'bg-blue-500',
    user: 'bg-green-500',
    system: 'bg-purple-500',
    commission: 'bg-amber-500'
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md border border-gray-100 dark:border-gray-700">
      <h4 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <Clock className="w-4 h-4 text-gray-400" />
        Recent Activity
      </h4>
      <div className="space-y-3">
        {activities.slice(0, 5).map((activity) => {
          const Icon = typeIcons[activity.type]
          return (
            <motion.div
              key={activity.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-start gap-3"
            >
              <div className={`p-1.5 ${typeColors[activity.type]} rounded-lg`}>
                <Icon className="w-3 h-3 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 dark:text-gray-300 truncate">
                  {activity.message}
                </p>
                <p className="text-xs text-gray-400">{activity.time}</p>
              </div>
              {activity.amount && (
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {activity.amount}
                </span>
              )}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

