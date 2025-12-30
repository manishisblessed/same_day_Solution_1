import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'AEPS Services - Aadhaar Enabled Payment System | Same Day Solution',
  description: 'Comprehensive AEPS services for cash withdrawal, balance inquiry, and Aadhaar-based transactions. Secure, fast, and reliable Aadhaar payment solutions.',
}

export default function AEPSService() {
  const features = [
    {
      title: 'Cash Withdrawal',
      description: 'Enable your customers to withdraw cash using Aadhaar authentication at any AEPS-enabled terminal. No need for debit cards or PINs.',
      icon: '💵',
    },
    {
      title: 'Balance Inquiry',
      description: 'Real-time balance checking through Aadhaar authentication. Customers can check their account balance instantly and securely.',
      icon: '📊',
    },
    {
      title: 'Aadhaar to Aadhaar Transfer',
      description: 'Seamless money transfer from one Aadhaar-linked account to another. Fast, secure, and convenient for your customers.',
      icon: '🔄',
    },
    {
      title: 'Mini Statement',
      description: 'Get instant mini statements of recent transactions through Aadhaar authentication. Help customers track their account activity.',
      icon: '📄',
    },
    {
      title: 'Biometric Authentication',
      description: 'Secure transactions using fingerprint or iris scan. Bank-level security with Aadhaar biometric verification.',
      icon: '👆',
    },
    {
      title: '24/7 Availability',
      description: 'Round-the-clock service availability. Your customers can access banking services anytime, anywhere.',
      icon: '⏰',
    },
  ]

  const benefits = [
    {
      title: 'Financial Inclusion',
      description: 'Bridge the gap between traditional banking and underserved populations. Enable banking services for everyone, even without a debit card.',
    },
    {
      title: 'Cost-Effective',
      description: 'Reduce operational costs by eliminating the need for physical debit cards. Lower transaction fees compared to traditional methods.',
    },
    {
      title: 'Secure & Compliant',
      description: 'All transactions are secured with Aadhaar authentication and comply with RBI guidelines. Your customers\' data is always protected.',
    },
    {
      title: 'Easy Integration',
      description: 'Simple API integration with comprehensive documentation. Get started quickly with our developer-friendly platform.',
    },
  ]

  const useCases = [
    {
      title: 'Retail Outlets',
      description: 'Enable your retail stores to offer cash withdrawal and banking services. Increase footfall and customer engagement.',
    },
    {
      title: 'Rural Banking',
      description: 'Extend banking services to rural areas where traditional banking infrastructure is limited. Serve unbanked populations.',
    },
    {
      title: 'Micro ATMs',
      description: 'Transform any device into a micro ATM with our AEPS services. Provide banking services at the customer\'s doorstep.',
    },
    {
      title: 'Business Correspondents',
      description: 'Empower your business correspondents to offer comprehensive banking services through Aadhaar authentication.',
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
              <span className="text-gray-900 font-medium">AEPS Services</span>
            </nav>
          </div>
        </section>
      </AnimatedSection>

      {/* Hero Section */}
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                AEPS Services
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Aadhaar Enabled Payment System
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Transform your business with secure, fast, and reliable Aadhaar-based payment solutions. 
                Enable cashless transactions and financial inclusion with our comprehensive AEPS services.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Get Started Today
                </Link>
                <Link href="/contact" className="btn-secondary">
                  Contact Sales
                </Link>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* What is AEPS */}
      <AnimatedSection delay={0.2}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
                  What is AEPS?
                </h2>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  Aadhaar Enabled Payment System (AEPS) is a bank-led model that allows online 
                  interoperable financial transactions at Point of Sale (PoS) and Micro ATMs 
                  through the business correspondent of any bank using Aadhaar authentication.
                </p>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  This revolutionary payment system enables customers to access their Aadhaar-linked 
                  bank accounts for basic banking transactions using only their Aadhaar number and 
                  biometric authentication - no need for debit cards, PINs, or physical presence at a bank branch.
                </p>
                <p className="text-lg text-gray-700 leading-relaxed">
                  At Same Day Solution, we make it easy for businesses to integrate AEPS services 
                  and offer these convenient banking solutions to their customers, driving financial 
                  inclusion and expanding your service offerings.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
                <div className="text-center">
                  <div className="text-7xl mb-6">🏦</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Banking Made Simple</h3>
                  <p className="text-gray-700 mb-6">
                    With AEPS, your customers can access banking services with just their Aadhaar number 
                    and fingerprint. No cards, no PINs, no hassle.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary-600">99.9%</div>
                      <div className="text-sm text-gray-600">Uptime</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-secondary-600">&lt;3s</div>
                      <div className="text-sm text-gray-600">Transaction Time</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Features */}
      <AnimatedSection delay={0.3}>
        <section className="section-padding bg-gray-50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Comprehensive AEPS Features
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Everything you need to offer complete banking services through Aadhaar authentication
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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

      {/* Benefits */}
      <AnimatedSection delay={0.4}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Why Choose Our AEPS Services?
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Experience the benefits of partnering with Same Day Solution for your AEPS needs
              </p>
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

      {/* Use Cases */}
      <AnimatedSection delay={0.5}>
        <section className="section-padding bg-gradient-to-br from-primary-50 to-secondary-50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Perfect For Your Business
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Discover how different businesses leverage our AEPS services
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {useCases.map((useCase, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card h-full">
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{useCase.title}</h3>
                    <p className="text-gray-600">{useCase.description}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* How It Works */}
      <AnimatedSection delay={0.6}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                How AEPS Works
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Simple, secure, and fast - here's how the process works
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              {[
                { step: '1', title: 'Customer Authentication', desc: 'Customer provides Aadhaar number and biometric (fingerprint/iris)' },
                { step: '2', title: 'Secure Verification', desc: 'System verifies Aadhaar with UIDAI and authenticates the customer' },
                { step: '3', title: 'Transaction Processing', desc: 'Transaction is processed securely through the banking network' },
                { step: '4', title: 'Instant Confirmation', desc: 'Customer receives instant confirmation and receipt of the transaction' },
              ].map((item, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 text-white text-2xl font-bold flex items-center justify-center mx-auto mb-4">
                      {item.step}
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{item.title}</h3>
                    <p className="text-gray-600">{item.desc}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* CTA */}
      <AnimatedSection delay={0.7}>
        <section className="section-padding bg-gradient-to-r from-primary-600 to-secondary-600">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              Ready to Start Offering AEPS Services?
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Join thousands of businesses already using our AEPS platform. Get started in minutes with our easy integration.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/contact" className="bg-white text-primary-600 px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-all duration-300 shadow-lg">
                Contact Sales
              </Link>
              <Link href="/how-it-works" className="bg-transparent border-2 border-white text-white px-8 py-3 rounded-lg font-semibold hover:bg-white/10 transition-all duration-300">
                Learn More
              </Link>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

