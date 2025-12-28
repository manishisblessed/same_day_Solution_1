import type { Metadata } from 'next'
import ServiceCard from '@/components/ServiceCard'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Services - Same Day Solution Pvt. Ltd.',
  description: 'Comprehensive fintech services including digital payments, lending solutions, merchant services, and more.',
}

export default function Services() {
  const services = [
    {
      icon: (
        <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      ),
      title: 'Payment Solutions',
      description: 'Comprehensive digital payment processing solutions designed for businesses of all sizes. Our payment gateway integration enables seamless transactions with support for multiple payment methods including cards, UPI, net banking, and digital wallets. Experience fast, secure, and reliable payment processing with real-time transaction monitoring and reporting.',
    },
    {
      icon: (
        <svg className="w-8 h-8 text-secondary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      title: 'Lending & Credit Support',
      description: 'End-to-end lending platform solutions and credit support services to help businesses access capital efficiently. Our lending solutions include loan origination systems, credit assessment tools, and loan management platforms. We provide APIs and integration support for seamless lending operations with automated workflows and compliance management.',
    },
    {
      icon: (
        <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      title: 'Merchant Onboarding',
      description: 'Streamlined merchant onboarding process with digital KYC and verification. Our merchant services include complete payment gateway setup, dashboard access, transaction reporting, and settlement management. We support both online and offline merchants with flexible integration options and dedicated support throughout the onboarding journey.',
    },
    {
      icon: (
        <svg className="w-8 h-8 text-secondary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      ),
      title: 'API & Integration Services',
      description: 'Robust RESTful APIs and comprehensive integration support for seamless connectivity with your existing systems. Our API solutions cover payments, transactions, reporting, and account management. We provide detailed documentation, SDKs, and sandbox environments for easy testing and integration. Our technical team offers dedicated support for custom integrations.',
    },
    {
      icon: (
        <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
      title: 'KYC & Compliance Support',
      description: 'Digital KYC solutions and compliance support to help businesses meet regulatory requirements efficiently. Our KYC services include identity verification, document validation, biometric authentication, and automated compliance checks. We provide APIs for seamless integration and maintain awareness of regulatory changes to ensure ongoing compliance.',
    },
  ]

  const quickServices = [
    { name: 'Banking & Payments', link: '/services/banking-payments', icon: '🏦', desc: 'One-stop banking and digital payments centre' },
    { name: 'Mini-ATM', link: '/services/mini-atm', icon: '🏧', desc: 'Cash withdrawal and merchant payments' },
    { name: 'AEPS Services', link: '/services/aeps', icon: '👆', desc: 'Aadhaar Enabled Payment System' },
    { name: 'Aadhaar Pay', link: '/services/merchant-payments', icon: '💳', desc: 'Merchant payments with Aadhaar' },
    { name: 'DMT', link: '/services/dmt', icon: '💸', desc: 'Domestic Money Transfer' },
    { name: 'Doorstep Banking', link: '/services/doorstep-banking', icon: '🚪', desc: 'BC-Sakhi mobile banking' },
    { name: 'Bill Payments', link: '/services/bill-payments', icon: '📄', desc: 'Utility & Bill Payments' },
    { name: 'Mobile Recharge', link: '/services/recharge', icon: '📱', desc: 'Prepaid & Postpaid Recharge' },
    { name: 'Travel Services', link: '/services/travel', icon: '✈️', desc: 'Railway, bus, flight & hotel bookings' },
    { name: 'Cash Management', link: '/services/cash-management', icon: '💰', desc: 'Loan installment collection' },
    { name: 'Government Services', link: '/services/government', icon: '🏛️', desc: 'PAN, Tax filing, GST & more' },
  ]

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 to-secondary-50/30">
          <div className="max-w-7xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              Our Services
            </h1>
            <p className="text-xl text-gray-700 max-w-3xl mx-auto">
              Comprehensive fintech solutions tailored to meet your business needs
            </p>
          </div>
        </section>
      </AnimatedSection>

      {/* Quick Services */}
      <AnimatedSection delay={0.1}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Popular Services
              </h2>
              <p className="text-lg text-gray-600">
                Quick access to our most popular fintech services
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {quickServices.map((service, index) => (
                <AnimatedCard key={index} delay={index * 0.05}>
                  <Link href={service.link} className="card text-center h-full block hover:shadow-xl transition-all duration-300 group">
                    <div className="text-5xl mb-4 group-hover:scale-110 transition-transform duration-300">{service.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{service.name}</h3>
                    <p className="text-gray-600 text-sm">{service.desc}</p>
                  </Link>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Services Grid */}
      <AnimatedSection delay={0.2}>
        <section className="section-padding bg-gray-50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                All Services
              </h2>
            </div>
            <div className="space-y-12">
              {services.map((service, index) => (
                <AnimatedSection key={index} delay={index * 0.1}>
                  <div
                    className={`grid grid-cols-1 lg:grid-cols-2 gap-8 items-center ${
                      index % 2 === 1 ? 'lg:flex-row-reverse' : ''
                    }`}
                  >
                <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                  <div className="flex items-center space-x-4 mb-4">
                    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-primary-100 to-secondary-100">
                      {service.icon}
                    </div>
                    <h2 className="text-3xl font-bold text-gray-900">{service.title}</h2>
                  </div>
                  <p className="text-lg text-gray-700 leading-relaxed">{service.description}</p>
                </div>
                <div className={`bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12 h-full ${index % 2 === 1 ? 'lg:order-1' : ''}`}>
                  <div className="flex items-center justify-center h-full">
                    <div className="text-6xl opacity-50">
                      {index === 0 && '💳'}
                      {index === 1 && '💰'}
                      {index === 2 && '🏪'}
                      {index === 3 && '🔌'}
                      {index === 4 && '✅'}
                    </div>
                  </div>
                </div>
                  </div>
                </AnimatedSection>
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

