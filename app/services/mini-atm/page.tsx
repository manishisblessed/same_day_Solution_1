import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Mini-ATM Services - Cash Withdrawal Solutions | Same Day Solution',
  description: 'Choose from a wide range of Mini-ATM branded ATMs. Help customers withdraw cash and make merchant payments using debit/credit cards.',
}

export default function MiniATM() {
  const features = [
    {
      title: 'Wide Range of ATMs',
      description: 'Choose from our extensive range of Mini-ATM devices, all branded and certified for secure transactions.',
      icon: '🏧',
    },
    {
      title: 'Card-Based Transactions',
      description: 'Enable cash withdrawal and merchant payments using debit and credit cards from all major banks.',
      icon: '💳',
    },
    {
      title: 'Easy Setup',
      description: 'Quick and easy installation process with comprehensive training and support.',
      icon: '⚙️',
    },
    {
      title: 'Real-Time Settlement',
      description: 'Fast settlement of transactions with real-time reporting and monitoring.',
      icon: '💰',
    },
  ]

  const benefits = [
    {
      title: 'Increased Footfall',
      description: 'Attract more customers to your shop by offering convenient cash withdrawal services.',
    },
    {
      title: 'Additional Revenue',
      description: 'Earn commissions on every transaction, creating a new revenue stream for your business.',
    },
    {
      title: 'Customer Convenience',
      description: 'Provide essential banking services to your customers right at your location.',
    },
    {
      title: 'Branded Equipment',
      description: 'Get professionally branded Mini-ATM equipment that enhances your shop\'s credibility.',
    },
  ]

  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Mini-ATM Services
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Cash Withdrawal Made Easy
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Choose from a wide range of Mini-ATM branded ATMs. Help your customers withdraw cash and make 
                merchant payments using their debit/credit cards. Transform your shop into a banking service point.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Get Mini-ATM
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
                  What is Mini-ATM?
                </h2>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  Mini-ATM is a portable device that enables cash withdrawal and payment transactions using 
                  debit and credit cards. It works like a traditional ATM but is more compact and can be 
                  installed at your shop or business location.
                </p>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  With our Mini-ATM services, you can offer banking services to your customers, helping 
                  them withdraw cash and make payments without visiting a bank branch or ATM.
                </p>
                <p className="text-lg text-gray-700 leading-relaxed">
                  Our branded Mini-ATM devices are secure, easy to use, and come with comprehensive 
                  training and support to help you get started quickly.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
                <div className="text-center">
                  <div className="text-7xl mb-6">🏧</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Banking at Your Doorstep</h3>
                  <p className="text-gray-700 mb-6">
                    Bring banking services to your customers. With Mini-ATM, you can offer cash withdrawal 
                    and payment services right from your shop.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary-600">24/7</div>
                      <div className="text-sm text-gray-600">Service</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-secondary-600">Secure</div>
                      <div className="text-sm text-gray-600">Transactions</div>
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
              Start Offering Mini-ATM Services
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Join our network of partners offering Mini-ATM services. Get started today with our easy setup process.
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

