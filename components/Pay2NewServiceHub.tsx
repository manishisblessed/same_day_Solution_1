'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Smartphone, Tv, Phone, Zap, Flame, Droplets, Wifi, Shield,
  Car, CreditCard, Banknote, GraduationCap, Building2, Gift,
} from 'lucide-react'
import Pay2NewServiceFlow from './Pay2NewServiceFlow'

interface ServiceConfig {
  id: string
  label: string
  description: string
  serviceId: number
  mode: 'bill' | 'recharge'
  icon: React.ReactNode
  iconColor: string
  bgGradient: string
  numberLabel: string
  numberPlaceholder: string
  numberMaxLength?: number
  numberDigitsOnly?: boolean
  showOptional1?: boolean
  optional1Label?: string
  optional1Placeholder?: string
  accent: 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'red' | 'cyan' | 'indigo'
  category: 'recharge' | 'utility' | 'finance' | 'other'
}

// service_id values per Pay2New /apis/v1/servicesList response.
const SERVICES: ServiceConfig[] = [
  // Recharges
  {
    id: 'mobile-prepaid', label: 'Mobile Prepaid', description: 'Recharge any prepaid number',
    serviceId: 1, mode: 'recharge', category: 'recharge',
    icon: <Smartphone className="w-6 h-6" />, iconColor: 'text-blue-600', bgGradient: 'from-blue-500/10 to-blue-600/5',
    numberLabel: 'Mobile Number', numberPlaceholder: '10-digit mobile', numberMaxLength: 10,
    accent: 'blue',
  },
  {
    id: 'dth', label: 'DTH Recharge', description: 'Recharge your TV connection',
    serviceId: 3, mode: 'recharge', category: 'recharge',
    icon: <Tv className="w-6 h-6" />, iconColor: 'text-purple-600', bgGradient: 'from-purple-500/10 to-purple-600/5',
    numberLabel: 'Subscriber ID', numberPlaceholder: 'Enter subscriber ID',
    accent: 'purple',
  },
  {
    id: 'fastag', label: 'FASTag', description: 'Recharge FASTag wallet',
    serviceId: 9, mode: 'recharge', category: 'recharge',
    icon: <Car className="w-6 h-6" />, iconColor: 'text-cyan-600', bgGradient: 'from-cyan-500/10 to-cyan-600/5',
    numberLabel: 'Vehicle Number', numberPlaceholder: 'e.g. MH12AB1234',
    numberDigitsOnly: false,
    accent: 'cyan',
  },

  // Utility bill payments
  {
    id: 'mobile-postpaid', label: 'Mobile Postpaid', description: 'Pay your postpaid mobile bill',
    serviceId: 2, mode: 'bill', category: 'utility',
    icon: <Phone className="w-6 h-6" />, iconColor: 'text-indigo-600', bgGradient: 'from-indigo-500/10 to-indigo-600/5',
    numberLabel: 'Mobile Number', numberPlaceholder: '10-digit mobile', numberMaxLength: 10,
    accent: 'indigo',
  },
  {
    id: 'electricity', label: 'Electricity', description: 'Pay your electricity bill',
    serviceId: 8, mode: 'bill', category: 'utility',
    icon: <Zap className="w-6 h-6" />, iconColor: 'text-orange-600', bgGradient: 'from-orange-500/10 to-orange-600/5',
    numberLabel: 'Consumer Number', numberPlaceholder: 'Enter consumer number',
    numberDigitsOnly: false,
    accent: 'orange',
  },
  {
    id: 'gas', label: 'Piped Gas', description: 'Pay piped gas bill',
    serviceId: 11, mode: 'bill', category: 'utility',
    icon: <Flame className="w-6 h-6" />, iconColor: 'text-red-600', bgGradient: 'from-red-500/10 to-red-600/5',
    numberLabel: 'Account Number', numberPlaceholder: 'Enter account number',
    numberDigitsOnly: false,
    accent: 'red',
  },
  {
    id: 'water', label: 'Water', description: 'Pay water bill',
    serviceId: 22, mode: 'bill', category: 'utility',
    icon: <Droplets className="w-6 h-6" />, iconColor: 'text-cyan-600', bgGradient: 'from-cyan-500/10 to-cyan-600/5',
    numberLabel: 'Consumer Number', numberPlaceholder: 'Enter consumer number',
    numberDigitsOnly: false,
    accent: 'cyan',
  },
  {
    id: 'broadband', label: 'Broadband / Landline', description: 'Pay internet bill',
    serviceId: 15, mode: 'bill', category: 'utility',
    icon: <Wifi className="w-6 h-6" />, iconColor: 'text-blue-600', bgGradient: 'from-blue-500/10 to-blue-600/5',
    numberLabel: 'Account / User ID', numberPlaceholder: 'Enter account number',
    numberDigitsOnly: false,
    accent: 'blue',
  },
  {
    id: 'lpg', label: 'LPG Cylinder', description: 'Book LPG / Pay LPG bill',
    serviceId: 10, mode: 'bill', category: 'utility',
    icon: <Flame className="w-6 h-6" />, iconColor: 'text-orange-600', bgGradient: 'from-orange-500/10 to-orange-600/5',
    numberLabel: 'Consumer / LPG ID', numberPlaceholder: 'Enter consumer number',
    numberDigitsOnly: false,
    accent: 'orange',
  },
  {
    id: 'cable', label: 'Cable TV', description: 'Pay cable TV bill',
    serviceId: 4, mode: 'bill', category: 'utility',
    icon: <Tv className="w-6 h-6" />, iconColor: 'text-pink-600', bgGradient: 'from-pink-500/10 to-pink-600/5',
    numberLabel: 'Subscriber ID', numberPlaceholder: 'Enter subscriber ID',
    numberDigitsOnly: false,
    accent: 'pink',
  },
  {
    id: 'municipal', label: 'Municipal Tax', description: 'Property / municipal tax',
    serviceId: 20, mode: 'bill', category: 'utility',
    icon: <Building2 className="w-6 h-6" />, iconColor: 'text-indigo-600', bgGradient: 'from-indigo-500/10 to-indigo-600/5',
    numberLabel: 'Account / Property ID', numberPlaceholder: 'Enter account number',
    numberDigitsOnly: false,
    accent: 'indigo',
  },

  // Finance
  {
    id: 'credit-card', label: 'Credit Card', description: 'Pay any credit card bill',
    serviceId: 34, mode: 'bill', category: 'finance',
    icon: <CreditCard className="w-6 h-6" />, iconColor: 'text-purple-600', bgGradient: 'from-purple-500/10 to-purple-600/5',
    numberLabel: 'Last 4 Digits of Credit Card', numberPlaceholder: 'e.g. 1266', numberMaxLength: 4,
    showOptional1: true, optional1Label: 'Registered Mobile Number (Optional)', optional1Placeholder: 'e.g. 9876543210',
    accent: 'purple',
  },
  {
    id: 'insurance', label: 'Insurance Premium', description: 'Pay insurance premium',
    serviceId: 14, mode: 'bill', category: 'finance',
    icon: <Shield className="w-6 h-6" />, iconColor: 'text-green-600', bgGradient: 'from-green-500/10 to-green-600/5',
    numberLabel: 'Policy Number', numberPlaceholder: 'Enter policy number',
    numberDigitsOnly: false,
    accent: 'green',
  },
  {
    id: 'loan', label: 'Loan EMI', description: 'Repay loan installment',
    serviceId: 17, mode: 'bill', category: 'finance',
    icon: <Banknote className="w-6 h-6" />, iconColor: 'text-green-600', bgGradient: 'from-green-500/10 to-green-600/5',
    numberLabel: 'Loan Account Number', numberPlaceholder: 'Enter loan account',
    numberDigitsOnly: false,
    accent: 'green',
  },

  // Other
  {
    id: 'education', label: 'Education Fees', description: 'Pay school / college fees',
    serviceId: 19, mode: 'bill', category: 'other',
    icon: <GraduationCap className="w-6 h-6" />, iconColor: 'text-pink-600', bgGradient: 'from-pink-500/10 to-pink-600/5',
    numberLabel: 'Roll / Reference No.', numberPlaceholder: 'Enter reference',
    numberDigitsOnly: false,
    accent: 'pink',
  },
]

const CATEGORIES: { id: ServiceConfig['category']; label: string; icon: React.ReactNode }[] = [
  { id: 'recharge', label: 'Recharges',          icon: <Smartphone className="w-4 h-4" /> },
  { id: 'utility',  label: 'Utility Bills',      icon: <Zap className="w-4 h-4" /> },
  { id: 'finance',  label: 'Finance & Cards',    icon: <CreditCard className="w-4 h-4" /> },
  { id: 'other',    label: 'Other Services',     icon: <Gift className="w-4 h-4" /> },
]

export default function Pay2NewServiceHub() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = selectedId ? SERVICES.find((s) => s.id === selectedId) || null : null

  if (selected) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedId(null)}
          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
        >
          ← All Pay2New Services
        </button>
        <Pay2NewServiceFlow
          key={selected.id}
          serviceId={selected.serviceId}
          title={selected.label}
          subtitle={selected.description}
          icon={selected.icon}
          mode={selected.mode}
          numberLabel={selected.numberLabel}
          numberPlaceholder={selected.numberPlaceholder}
          numberMaxLength={selected.numberMaxLength}
          numberDigitsOnly={selected.numberDigitsOnly}
          showOptional1={selected.showOptional1}
          optional1Label={selected.optional1Label}
          optional1Placeholder={selected.optional1Placeholder}
          accent={selected.accent}
        />
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl p-5 text-white shadow-md">
        <h2 className="text-xl font-bold mb-1">Pay2New Services</h2>
        <p className="text-sm text-blue-50">
          Recharges, utility bills, credit card payments, and more — all powered by BBPS-2
        </p>
      </div>

      {CATEGORIES.map((cat) => {
        const items = SERVICES.filter((s) => s.category === cat.id)
        if (items.length === 0) return null
        return (
          <div key={cat.id} className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                {cat.icon}
              </div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide">
                {cat.label}
              </h3>
              <div className="flex-1 h-px bg-gradient-to-r from-gray-200 dark:from-gray-700 to-transparent" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {items.map((svc) => (
                <button
                  key={svc.id}
                  onClick={() => setSelectedId(svc.id)}
                  className="group relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg hover:-translate-y-0.5 hover:border-blue-300 dark:hover:border-blue-600 transition-all text-left overflow-hidden"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${svc.bgGradient} opacity-0 group-hover:opacity-100 transition-opacity`} />
                  <div className="relative">
                    <div className={`inline-flex p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700 ${svc.iconColor} mb-3 group-hover:scale-110 transition-transform`}>
                      {svc.icon}
                    </div>
                    <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                      {svc.label}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                      {svc.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </motion.div>
  )
}
