'use client'

import { useState } from 'react'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export default function BusinessLogin() {
  const [userType, setUserType] = useState<'retailer' | 'distributor' | 'master-distributor' | null>(null)
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    rememberMe: false,
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value,
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Handle login logic here
    console.log('Login attempt:', { userType, ...formData })
  }

  const userTypes = [
    {
      id: 'retailer',
      title: 'Retailer',
      icon: '🏪',
      description: 'Login to access your retailer dashboard and manage transactions',
    },
    {
      id: 'distributor',
      title: 'Distributor',
      icon: '📦',
      description: 'Access distributor portal to manage your retailer network',
    },
    {
      id: 'master-distributor',
      title: 'Master Distributor',
      icon: '🌟',
      description: 'Login to master distributor dashboard for advanced analytics',
    },
  ]

  return (
    <div className="bg-white min-h-screen">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Business Login
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Partner Portal Access
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Access your partner dashboard to manage transactions, view reports, and grow your business
              </p>
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.2}>
        <section className="section-padding">
          <div className="max-w-5xl mx-auto">
            {!userType ? (
              <div>
                <div className="text-center mb-12">
                  <h2 className="text-3xl font-bold text-gray-900 mb-4">Select Your Account Type</h2>
                  <p className="text-gray-600">Choose your partner type to continue</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {userTypes.map((type, index) => (
                    <AnimatedCard key={type.id} delay={index * 0.1}>
                      <button
                        onClick={() => setUserType(type.id as any)}
                        className="card w-full text-center h-full hover:shadow-xl transition-all duration-300 group"
                      >
                        <div className="text-6xl mb-4">{type.icon}</div>
                        <h3 className="text-2xl font-bold text-gray-900 mb-3">{type.title}</h3>
                        <p className="text-gray-600 mb-4">{type.description}</p>
                        <div className="text-primary-600 font-semibold group-hover:text-primary-700">
                          Continue →
                        </div>
                      </button>
                    </AnimatedCard>
                  ))}
                </div>
              </div>
            ) : (
              <AnimatedCard>
                <div className="max-w-md mx-auto">
                  <div className="card">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-bold text-gray-900">
                        {userTypes.find(t => t.id === userType)?.title} Login
                      </h2>
                      <button
                        onClick={() => setUserType(null)}
                        className="text-gray-500 hover:text-gray-700"
                        aria-label="Change account type"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                      <div>
                        <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                          Username / Partner ID
                        </label>
                        <input
                          type="text"
                          id="username"
                          name="username"
                          required
                          value={formData.username}
                          onChange={handleChange}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                          placeholder="Enter your username or partner ID"
                        />
                      </div>

                      <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                          Password
                        </label>
                        <input
                          type="password"
                          id="password"
                          name="password"
                          required
                          value={formData.password}
                          onChange={handleChange}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                          placeholder="Enter your password"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <input
                            id="rememberMe"
                            name="rememberMe"
                            type="checkbox"
                            checked={formData.rememberMe}
                            onChange={handleChange}
                            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                          />
                          <label htmlFor="rememberMe" className="ml-2 block text-sm text-gray-700">
                            Remember me
                          </label>
                        </div>
                        <Link href="/contact" className="text-sm text-primary-600 hover:text-primary-700">
                          Forgot password?
                        </Link>
                      </div>

                      <button
                        type="submit"
                        className="w-full btn-primary"
                      >
                        Sign In
                      </button>
                    </form>

                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <p className="text-center text-sm text-gray-600">
                        Not a partner yet?{' '}
                        <Link href="/partner" className="text-primary-600 hover:text-primary-700 font-semibold">
                          Become a Partner
                        </Link>
                      </p>
                    </div>
                  </div>
                </div>
              </AnimatedCard>
            )}
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.3}>
        <section className="section-padding bg-gray-50">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Need Help?</h2>
              <p className="text-gray-600 mb-6">
                If you're having trouble accessing your account, our support team is here to help
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-secondary">
                  Contact Support
                </Link>
                <Link href="/faq" className="btn-secondary">
                  View FAQs
                </Link>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

