import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Banking and Payments - Digital Payment Solutions | Same Day Solution',
  description: 'Become a one-stop banking and digital payments centre. Security certified platform for all your financial transactions.',
}

export default function BankingPayments() {
  const features = [
    {
      title: 'Security Certified Platform',
      description: 'Our technology platform is security certified, ensuring all transactions are fully secure and protected.',
      icon: '🔒',
    },
    {
      title: 'Comprehensive Services',
      description: 'Offer a wide range of banking and payment services from a single platform to your customers.',
      icon: '🎯',
    },
    {
      title: 'Real-Time Processing',
      description: 'All transactions are processed in real-time with instant confirmation and receipts.',
      icon: '⚡',
    },
    {
      title: '24/7 Availability',
      description: 'Round-the-clock service availability ensures your customers can access services anytime.',
      icon: '🌙',
    },
  ]

  const services = [
    {
      title: 'Cash Withdrawal',
      description: 'Enable customers to withdraw cash using AEPS, debit cards, or other payment methods.',
    },
    {
      title: 'Balance Inquiry',
      description: 'Real-time balance checking for bank accounts through multiple channels.',
    },
    {
      title: 'Money Transfer',
      description: 'Domestic money transfer services including IMPS, NEFT, RTGS, and UPI.',
    },
    {
      title: 'Digital Payments',
      description: 'Accept payments through UPI, cards, net banking, and digital wallets.',
    },
    {
      title: 'Bill Payments',
      description: 'Pay utility bills, insurance premiums, and other recurring payments.',
    },
    {
      title: 'Mobile Recharge',
      description: 'Prepaid and postpaid mobile, DTH, and data card recharge services.',
    },
  ]

  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Banking and Payments
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  One-Stop Financial Centre
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Become a one-stop banking and digital payments centre. Our security certified technology platform 
                ensures all transactions are fully secure, giving your customers confidence in every transaction.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Get Started
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
                  Why Choose Our Banking & Payments Platform?
                </h2>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  Transform your business into a comprehensive financial services hub. Our security certified 
                  platform enables you to offer multiple banking and payment services from a single location, 
                  increasing footfall and revenue opportunities.
                </p>
                <p className="text-lg text-gray-700 leading-relaxed">
                  With our advanced technology and secure infrastructure, you can provide your customers with 
                  convenient access to banking services, digital payments, and financial transactions - all 
                  in one place.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
                <div className="text-center">
                  <div className="text-7xl mb-6">🏦</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Security First</h3>
                  <p className="text-gray-700 mb-6">
                    Our platform is security certified, ensuring every transaction is protected and secure. 
                    Your customers can transact with complete confidence.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary-600">100%</div>
                      <div className="text-sm text-gray-600">Secure</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-secondary-600">24/7</div>
                      <div className="text-sm text-gray-600">Available</div>
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
                Services You Can Offer
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Comprehensive range of banking and payment services
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((service, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card h-full">
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{service.title}</h3>
                    <p className="text-gray-600">{service.description}</p>
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
              Start Your Banking & Payments Business Today
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Join thousands of partners offering comprehensive banking and payment services. 
              Get started with our security certified platform.
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

