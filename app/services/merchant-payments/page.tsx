import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Merchant Payments - Aadhaar Pay Services | Same Day Solution',
  description: 'Enable customers to purchase goods from your shop and make payments using Aadhaar card and fingerprint. Secure Aadhaar Pay services.',
}

export default function MerchantPayments() {
  const features = [
    {
      title: 'Aadhaar-Based Payment',
      description: 'Customers can make payments using just their Aadhaar number and fingerprint - no need for cards or PINs.',
      icon: '👆',
    },
    {
      title: 'Secure Transactions',
      description: 'All transactions are authenticated through UIDAI, ensuring maximum security and fraud prevention.',
      icon: '🔒',
    },
    {
      title: 'Instant Processing',
      description: 'Payments are processed instantly with real-time confirmation and receipts.',
      icon: '⚡',
    },
    {
      title: 'No Card Required',
      description: 'Customers don\'t need to carry debit or credit cards - just their Aadhaar number.',
      icon: '💳',
    },
  ]

  const benefits = [
    {
      title: 'Increased Sales',
      description: 'Accept payments from customers who don\'t have cards, expanding your customer base and increasing sales.',
    },
    {
      title: 'Faster Checkout',
      description: 'Faster payment processing means shorter queues and better customer experience.',
    },
    {
      title: 'Lower Transaction Costs',
      description: 'Aadhaar Pay transactions typically have lower processing fees compared to card payments.',
    },
    {
      title: 'Financial Inclusion',
      description: 'Enable customers without bank cards to make digital payments, promoting financial inclusion.',
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
              <span className="text-gray-900 font-medium">Aadhaar Pay</span>
            </nav>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Aadhaar Pay
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Secure Payment Services
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                If you run other businesses from your shop, customers can purchase goods from your shop and make 
                payments by using Aadhaar card and fingerprint. This service is called Aadhaar Pay - a secure 
                and convenient payment method.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Enable Aadhaar Pay
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
                  What is Aadhaar Pay?
                </h2>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  Aadhaar Pay is a payment system that allows customers to make payments using their Aadhaar 
                  number and biometric authentication (fingerprint). It eliminates the need for debit cards, 
                  credit cards, or mobile phones for making payments.
                </p>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  When a customer wants to make a purchase at your shop, they simply provide their Aadhaar 
                  number and authenticate using their fingerprint. The payment is then processed directly from 
                  their Aadhaar-linked bank account.
                </p>
                <p className="text-lg text-gray-700 leading-relaxed">
                  This service is particularly beneficial for customers who don\'t have debit or credit cards, 
                  helping promote financial inclusion and digital payments.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
                <div className="text-center">
                  <div className="text-7xl mb-6">👆</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Pay with Fingerprint</h3>
                  <p className="text-gray-700 mb-6">
                    Customers can make payments with just their Aadhaar number and fingerprint. 
                    Simple, secure, and convenient.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary-600">Secure</div>
                      <div className="text-sm text-gray-600">UIDAI Verified</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-secondary-600">Instant</div>
                      <div className="text-sm text-gray-600">Payment</div>
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
              Start Accepting Aadhaar Pay
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Enable Aadhaar Pay at your shop and start accepting payments from customers without cards.
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

