import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'DMT Services - Domestic Money Transfer | Same Day Solution',
  description: 'Fast, secure, and reliable domestic money transfer services. Enable instant money transfers across India with our comprehensive DMT solutions.',
}

export default function DMTService() {
  const features = [
    {
      title: 'Instant Transfers',
      description: 'Send money instantly to any bank account in India. Real-time processing ensures your customers receive funds immediately.',
      icon: '⚡',
    },
    {
      title: '24/7 Availability',
      description: 'Round-the-clock money transfer services. Your customers can send money anytime, anywhere, even on holidays.',
      icon: '🌙',
    },
    {
      title: 'Multi-Bank Support',
      description: 'Transfer money to any bank account across India. Support for all major banks and payment networks.',
      icon: '🏦',
    },
    {
      title: 'Secure Transactions',
      description: 'Bank-level security with end-to-end encryption. Every transaction is protected and monitored for fraud.',
      icon: '🔒',
    },
    {
      title: 'Low Transaction Fees',
      description: 'Competitive pricing with transparent fee structure. Help your customers save money on every transfer.',
      icon: '💰',
    },
    {
      title: 'Transaction History',
      description: 'Complete transaction records and history. Easy tracking and reconciliation for your business.',
      icon: '📋',
    },
  ]

  const benefits = [
    {
      title: 'Increased Revenue',
      description: 'Generate additional revenue streams by offering money transfer services. Earn commissions on every transaction.',
    },
    {
      title: 'Customer Retention',
      description: 'Keep your customers coming back with convenient money transfer services. Build stronger customer relationships.',
    },
    {
      title: 'Competitive Advantage',
      description: 'Stand out from competitors by offering comprehensive financial services including money transfers.',
    },
    {
      title: 'Easy Integration',
      description: 'Simple API integration with comprehensive documentation. Start offering DMT services in days, not months.',
    },
  ]

  const transferTypes = [
    {
      title: 'IMPS (Immediate Payment Service)',
      description: 'Instant money transfer service available 24/7. Transfer funds immediately to any bank account.',
      features: ['Instant transfer', '24/7 availability', 'Real-time processing'],
    },
    {
      title: 'NEFT (National Electronic Funds Transfer)',
      description: 'Batch-based transfer system for scheduled transfers. Ideal for larger amounts and planned transactions.',
      features: ['Batch processing', 'Lower fees', 'Scheduled transfers'],
    },
    {
      title: 'RTGS (Real Time Gross Settlement)',
      description: 'Real-time gross settlement for high-value transactions. Perfect for large business transfers.',
      features: ['High-value transfers', 'Real-time settlement', 'Secure processing'],
    },
    {
      title: 'UPI (Unified Payments Interface)',
      description: 'Modern payment system for instant transfers using UPI IDs or mobile numbers. Fast and convenient.',
      features: ['UPI ID transfers', 'Mobile number transfers', 'QR code payments'],
    },
  ]

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                DMT Services
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Domestic Money Transfer
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Enable your customers to send money instantly across India with our secure and reliable 
                domestic money transfer services. Fast, affordable, and trusted by thousands of businesses.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Start Offering DMT
                </Link>
                <Link href="/contact" className="btn-secondary">
                  Contact Sales
                </Link>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* What is DMT */}
      <AnimatedSection delay={0.2}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
                  What is DMT?
                </h2>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  Domestic Money Transfer (DMT) is a service that allows individuals and businesses 
                  to transfer money from one bank account to another within India. It's one of the 
                  most essential financial services in today's digital economy.
                </p>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  At Same Day Solution, we provide comprehensive DMT services that enable your business 
                  to offer money transfer facilities to your customers. Whether it's sending money to 
                  family, paying bills, or business transactions, our platform makes it simple and secure.
                </p>
                <p className="text-lg text-gray-700 leading-relaxed">
                  With support for multiple transfer methods including IMPS, NEFT, RTGS, and UPI, 
                  we ensure your customers have access to the fastest and most convenient money 
                  transfer options available.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
                <div className="text-center">
                  <div className="text-7xl mb-6">💸</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Money Transfer Made Simple</h3>
                  <p className="text-gray-700 mb-6">
                    Enable your customers to send money anywhere in India with just a few clicks. 
                    Fast, secure, and reliable.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary-600">&lt;30s</div>
                      <div className="text-sm text-gray-600">Transfer Time</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-secondary-600">99.9%</div>
                      <div className="text-sm text-gray-600">Success Rate</div>
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
                Powerful DMT Features
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Everything you need to offer comprehensive money transfer services
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

      {/* Transfer Types */}
      <AnimatedSection delay={0.4}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Multiple Transfer Options
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Support for all major money transfer methods in India
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {transferTypes.map((type, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card h-full">
                    <h3 className="text-2xl font-bold text-gray-900 mb-3">{type.title}</h3>
                    <p className="text-gray-700 mb-4 leading-relaxed">{type.description}</p>
                    <ul className="space-y-2">
                      {type.features.map((feature, fIndex) => (
                        <li key={fIndex} className="flex items-center text-gray-600">
                          <svg className="w-5 h-5 text-primary-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Benefits */}
      <AnimatedSection delay={0.5}>
        <section className="section-padding bg-gradient-to-br from-primary-50 to-secondary-50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Benefits for Your Business
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Why businesses choose our DMT services
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

      {/* How It Works */}
      <AnimatedSection delay={0.6}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Simple 3-Step Process
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Getting started with DMT services is quick and easy
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { step: '1', title: 'Customer Registration', desc: 'Customer provides beneficiary details and account information' },
                { step: '2', title: 'Transaction Initiation', desc: 'Customer initiates transfer with amount and selects transfer method' },
                { step: '3', title: 'Instant Processing', desc: 'Transaction is processed instantly and beneficiary receives funds' },
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
              Start Offering Money Transfer Services Today
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Join thousands of businesses already using our DMT platform. Get started in minutes.
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

