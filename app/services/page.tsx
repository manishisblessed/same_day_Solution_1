import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Services - Same Day Solution Pvt. Ltd.',
  description: 'Comprehensive fintech services including digital payments, lending solutions, merchant services, and more.',
}

export default function Services() {
  const quickServices = [
    { name: 'Banking & Payments', link: '/services/banking-payments', icon: '🏦', desc: 'Complete banking solutions for your customers' },
    { name: 'Mini-ATM, POS & WPOS', link: '/services/mini-atm', icon: '🏧', desc: 'Cash withdrawal and card payment services at your shop' },
    { name: 'AEPS Services', link: '/services/aeps', icon: '👆', desc: 'Banking with just Aadhaar and fingerprint' },
    { name: 'Aadhaar Pay', link: '/services/merchant-payments', icon: '💳', desc: 'Secure payments using Aadhaar' },
    { name: 'Domestic Money Transfer', link: '/services/dmt', icon: '💸', desc: 'Send money across India instantly' },
    { name: 'Utility Bill Payments', link: '/services/bill-payments', icon: '📄', desc: 'Pay all utility bills in one place' },
    { name: 'Mobile Recharge', link: '/services/recharge', icon: '📱', desc: 'Instant mobile and DTH recharge' },
    { name: 'Travel Services', link: '/services/travel', icon: '✈️', desc: 'Book buses, flights & hotels' },
    { name: 'Cash Management', link: '/services/cash-management', icon: '💰', desc: 'Collect loan installments easily' },
    { name: 'LIC Bill Payment', link: '/services/lic-payment', icon: '🛡️', desc: 'Pay LIC premiums conveniently' },
    { name: 'Insurance', link: '/services/insurance', icon: '🏥', desc: 'Protect what matters with insurance' },
  ]

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 to-secondary-50/30">
          <div className="max-w-7xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
              Transform Your Business
              <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                With Complete Financial Solutions
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-gray-700 max-w-3xl mx-auto leading-relaxed">
              From banking and payments to insurance and travel bookings - offer everything your customers need, all from one platform
            </p>
          </div>
        </section>
      </AnimatedSection>

      {/* Services Grid */}
      <AnimatedSection delay={0.1}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                What We Offer
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Choose from our wide range of services and start earning with every transaction
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {quickServices.map((service, index) => (
                <AnimatedCard key={index} delay={index * 0.05}>
                  <Link href={service.link} className="block h-full">
                    <div className="banking-card h-full hover:shadow-lg transition-all duration-300 group border border-gray-200 rounded-xl p-6">
                      <div className="flex items-center justify-center w-16 h-16 rounded-lg bg-gradient-to-br from-primary-500/10 to-primary-600/10 mb-4 group-hover:scale-105 transition-transform duration-300 border border-primary-200 mx-auto">
                        <span className="text-3xl">{service.icon}</span>
                      </div>
                      <h3 className="text-xl font-bold text-gray-900 mb-2 text-center">{service.name}</h3>
                      <p className="text-gray-600 text-sm leading-relaxed text-center">{service.desc}</p>
                    </div>
                  </Link>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Benefits Section */}
      <AnimatedSection delay={0.2}>
        <section className="section-padding bg-gradient-to-br from-primary-50/50 to-secondary-50/50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Why Choose Our Services?
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Everything you need to transform your business into a complete financial services hub
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  icon: '⚡',
                  title: 'Fast & Reliable',
                  description: 'Lightning-fast transactions with 99.9% uptime guarantee. Your customers get instant service every time.',
                },
                {
                  icon: '🔒',
                  title: 'Secure & Safe',
                  description: 'Bank-level security with encrypted transactions. Your customers\' data and money are always protected.',
                },
                {
                  icon: '💰',
                  title: 'Earn More',
                  description: 'Competitive commission structure on every transaction. The more you serve, the more you earn.',
                },
                {
                  icon: '🎯',
                  title: 'Easy Setup',
                  description: 'Quick onboarding process with dedicated support. Get started in just 24-48 hours.',
                },
              ].map((benefit, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card text-center h-full">
                    <div className="text-5xl mb-4">{benefit.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{benefit.title}</h3>
                    <p className="text-gray-600 leading-relaxed">{benefit.description}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* CTA Section */}
      <AnimatedSection delay={0.3}>
        <section className="section-padding bg-gradient-to-br from-primary-50 to-secondary-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
            Ready to Get Started?
          </h2>
          <p className="text-lg text-gray-700 mb-8">
            Contact us today to learn how our fintech solutions can help your business grow.
          </p>
          <Link href="/contact" className="btn-primary inline-block">
            Contact Us
          </Link>
        </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

