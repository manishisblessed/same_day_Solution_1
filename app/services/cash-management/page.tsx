import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Cash Management Services - Loan Installment Collection | Same Day Solution',
  description: 'Customers can pay their loan installments at retailer shops instead of going to branch. Cash management services for micro-finance companies.',
}

export default function CashManagement() {
  const features = [
    {
      title: 'Loan Installment Collection',
      description: 'Collect loan installments from customers on behalf of micro-finance and finance companies.',
      icon: '💰',
    },
    {
      title: 'Multiple Lenders',
      description: 'Support for various micro-finance companies and product finance companies.',
      icon: '🏦',
    },
    {
      title: 'Real-Time Processing',
      description: 'Instant processing and confirmation of payments with real-time updates to lenders.',
      icon: '⚡',
    },
    {
      title: 'Secure Transactions',
      description: 'All transactions are secure and properly recorded for audit and compliance purposes.',
      icon: '🔒',
    },
  ]

  const benefits = [
    {
      title: 'Customer Convenience',
      description: 'Customers can pay loan installments at nearby shops instead of traveling to branch offices.',
    },
    {
      title: 'Additional Revenue',
      description: 'Earn commissions on every installment collection, creating a steady revenue stream.',
    },
    {
      title: 'Increased Footfall',
      description: 'Regular customers coming for installment payments increase footfall to your shop.',
    },
    {
      title: 'Community Service',
      description: 'Help customers in your community by providing convenient payment options for their loans.',
    },
  ]

  return (
    <div className="bg-white">
      {/* Breadcrumb Navigation */}
      <AnimatedSection>
        <section className="section-padding bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto">
            <nav className="flex items-center space-x-2 text-sm">
              <Link href="/" className="text-gray-600 hover:text-primary-600 transition-colors">Home</Link>
              <span className="text-gray-400">/</span>
              <Link href="/services" className="text-gray-600 hover:text-primary-600 transition-colors">Services</Link>
              <span className="text-gray-400">/</span>
              <span className="text-gray-900 font-medium">Cash Management</span>
            </nav>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Cash Management Services
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Loan Installment Collection
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Customers who have availed loans from micro-finance companies and other product finance companies 
                can pay their installment at retailer shops, instead of going to branch offices. Provide convenient 
                payment solutions for loan customers in your area.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Start Collection Service
                </Link>
                <Link href="/partner" className="btn-secondary">
                  Learn More
                </Link>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.2}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
                  How Cash Management Works
                </h2>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  Cash Management Services enable you to collect loan installments from customers on behalf of 
                  micro-finance companies, product finance companies, and other lenders. Instead of customers 
                  traveling to branch offices, they can make payments at your convenient location.
                </p>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  This service benefits both customers and retailers - customers get convenience, and retailers 
                  earn commissions while increasing footfall to their shops.
                </p>
                <p className="text-lg text-gray-700 leading-relaxed">
                  All payments are processed securely and in real-time, with instant confirmation and updates 
                  to the lending companies.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
                <div className="text-center">
                  <div className="text-7xl mb-6">💰</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Convenient Payments</h3>
                  <p className="text-gray-700 mb-6">
                    Help customers pay loan installments without visiting branch offices. 
                    Convenient, secure, and reliable.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary-600">Secure</div>
                      <div className="text-sm text-gray-600">Processing</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-secondary-600">Real-Time</div>
                      <div className="text-sm text-gray-600">Updates</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.3}>
        <section className="section-padding bg-gray-50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Key Features
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card text-center h-full">
                    <div className="text-5xl mb-4">{feature.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{feature.title}</h3>
                    <p className="text-gray-600">{feature.description}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.4}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Benefits for Your Business
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {benefits.map((benefit, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card">
                    <h3 className="text-2xl font-bold text-gray-900 mb-3">{benefit.title}</h3>
                    <p className="text-gray-700 leading-relaxed">{benefit.description}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.5}>
        <section className="section-padding bg-gradient-to-r from-primary-600 to-secondary-600">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              Start Offering Cash Management Services
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Help customers pay loan installments conveniently while earning additional revenue.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/contact" className="bg-white text-primary-600 px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-all duration-300 shadow-lg">
                Contact Us
              </Link>
              <Link href="/partner" className="bg-transparent border-2 border-white text-white px-8 py-3 rounded-lg font-semibold hover:bg-white/10 transition-all duration-300">
                Become a Partner
              </Link>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

