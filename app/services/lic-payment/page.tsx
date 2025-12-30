import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'LIC Bill Payment - Life Insurance Premium Payments | Same Day Solution',
  description: 'Help your customers pay their LIC premium payments conveniently at your shop. Secure, fast, and reliable LIC bill payment services.',
}

export default function LICPaymentService() {
  const features = [
    {
      title: 'All LIC Policies',
      description: 'Accept premium payments for all types of LIC policies including term insurance, endowment plans, and ULIPs.',
      icon: '🛡️',
    },
    {
      title: 'Instant Confirmation',
      description: 'Get instant payment confirmation and receipts. Real-time status updates for all LIC premium payments.',
      icon: '⚡',
    },
    {
      title: 'Multiple Payment Modes',
      description: 'Accept payments through cash, cards, UPI, and other digital payment methods.',
      icon: '💳',
    },
    {
      title: 'Policy Information',
      description: 'Help customers check their policy details, premium due dates, and payment history.',
      icon: '📋',
    },
  ]

  const benefits = [
    {
      title: 'Customer Trust',
      description: 'Build trust with your customers by helping them maintain their life insurance coverage. They\'ll appreciate the convenience of paying premiums at your shop.',
    },
    {
      title: 'Regular Footfall',
      description: 'LIC premium payments are recurring, bringing customers back to your shop regularly. This increases your overall footfall and sales opportunities.',
    },
    {
      title: 'Service Fees',
      description: 'Earn service fees on every LIC premium payment. Regular customers mean regular income for your business.',
    },
    {
      title: 'Community Service',
      description: 'Help your community stay financially protected by making insurance premium payments accessible and convenient.',
    },
  ]

  const paymentTypes = [
    {
      title: 'Term Insurance Premiums',
      description: 'Accept payments for term life insurance policies that provide pure life coverage.',
    },
    {
      title: 'Endowment Plans',
      description: 'Process premium payments for endowment policies that combine insurance and savings.',
    },
    {
      title: 'ULIP Premiums',
      description: 'Handle premium payments for Unit Linked Insurance Plans that offer investment benefits.',
    },
    {
      title: 'Health Insurance',
      description: 'Accept premium payments for LIC health insurance policies and riders.',
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
              <span className="text-gray-900 font-medium">LIC Bill Payment</span>
            </nav>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                LIC Bill Payment
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Secure Premium Payments
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Help your customers stay protected by making their LIC premium payments easy and convenient. 
                They can pay their insurance premiums right at your shop, ensuring their family's financial security stays intact.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Start LIC Payments
                </Link>
                <Link href="/partner" className="btn-secondary">
                  Become a Partner
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
                  Why Offer LIC Bill Payment Services?
                </h2>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  Life Insurance Corporation (LIC) is one of India's most trusted insurance providers, with millions 
                  of policyholders across the country. Many people find it inconvenient to visit LIC offices or 
                  remember premium due dates.
                </p>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  By offering LIC premium payment services at your shop, you provide a valuable service to your 
                  community while creating a steady revenue stream. Your customers will appreciate the convenience 
                  of paying their insurance premiums while running other errands.
                </p>
                <p className="text-lg text-gray-700 leading-relaxed">
                  This service not only helps customers maintain their life insurance coverage but also brings them 
                  back to your shop regularly, increasing your overall business opportunities.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
                <div className="text-center">
                  <div className="text-7xl mb-6">🛡️</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Protect What Matters</h3>
                  <p className="text-gray-700 mb-6">
                    Help your customers maintain their life insurance coverage. Every premium payment ensures 
                    their family's financial security.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary-600">Secure</div>
                      <div className="text-sm text-gray-600">Payments</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-secondary-600">Instant</div>
                      <div className="text-sm text-gray-600">Confirmation</div>
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
                LIC Policy Types Supported
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {paymentTypes.map((type, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card">
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{type.title}</h3>
                    <p className="text-gray-700 leading-relaxed">{type.description}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.5}>
        <section className="section-padding bg-gray-50">
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

      <AnimatedSection delay={0.6}>
        <section className="section-padding bg-gradient-to-r from-primary-600 to-secondary-600">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              Start Offering LIC Bill Payment Services
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Help your customers protect their families while building a steady revenue stream for your business.
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

