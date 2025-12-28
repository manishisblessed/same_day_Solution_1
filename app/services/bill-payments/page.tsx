import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Bill Payment Services - Utility Bill Payments | Same Day Solution',
  description: 'Comprehensive bill payment services for electricity, water, gas, insurance, and more. Enable your customers to pay all bills from one platform.',
}

export default function BillPaymentsService() {
  const billTypes = [
    { name: 'Electricity', icon: '⚡', description: 'Pay electricity bills for all major providers across India' },
    { name: 'Water', icon: '💧', description: 'Water bill payments for municipal and private suppliers' },
    { name: 'Gas', icon: '🔥', description: 'LPG and piped gas bill payments' },
    { name: 'Internet & TV', icon: '📺', description: 'Broadband, DTH, and cable TV subscriptions' },
    { name: 'Insurance', icon: '🛡️', description: 'Life, health, and vehicle insurance premium payments' },
    { name: 'Mobile Postpaid', icon: '📱', description: 'Postpaid mobile and landline bill payments' },
    { name: 'Credit Card', icon: '💳', description: 'Credit card bill payments for all major banks' },
    { name: 'Loan EMI', icon: '🏦', description: 'Loan EMI payments for personal, home, and vehicle loans' },
  ]

  const features = [
    {
      title: 'One Platform, All Bills',
      description: 'Your customers can pay all their bills from a single platform. No need to visit multiple websites or apps.',
    },
    {
      title: 'Instant Confirmation',
      description: 'Get instant payment confirmation and receipts. Real-time status updates for all transactions.',
    },
    {
      title: 'Auto-Pay Options',
      description: 'Enable customers to set up automatic bill payments. Never miss a due date again.',
    },
    {
      title: 'Bill Reminders',
      description: 'Automated reminders for upcoming bill due dates. Help customers stay on top of their payments.',
    },
  ]

  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Bill Payment Services
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Pay All Bills, One Platform
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Enable your customers to pay all their utility bills, insurance premiums, and subscriptions 
                from a single, convenient platform. Fast, secure, and comprehensive bill payment solutions.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Get Started
                </Link>
                <Link href="/contact" className="btn-secondary">
                  Contact Sales
                </Link>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.2}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                All Types of Bills Supported
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Comprehensive coverage for all major bill categories
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {billTypes.map((bill, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card text-center h-full">
                    <div className="text-5xl mb-4">{bill.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{bill.name}</h3>
                    <p className="text-gray-600 text-sm">{bill.description}</p>
                  </div>
                </AnimatedCard>
              ))}
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {features.map((feature, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card">
                    <h3 className="text-2xl font-bold text-gray-900 mb-3">{feature.title}</h3>
                    <p className="text-gray-700 leading-relaxed">{feature.description}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.4}>
        <section className="section-padding bg-gradient-to-r from-primary-600 to-secondary-600">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              Simplify Bill Payments for Your Customers
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Offer comprehensive bill payment services and increase customer engagement.
            </p>
            <Link href="/contact" className="bg-white text-primary-600 px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-all duration-300 shadow-lg inline-block">
              Contact Us
            </Link>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

