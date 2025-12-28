import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Mobile Recharge Services - Prepaid & Postpaid | Same Day Solution',
  description: 'Mobile recharge services for all major operators. Enable prepaid and postpaid recharges with instant activation.',
}

export default function RechargeService() {
  const operators = [
    { name: 'Airtel', icon: '📶' },
    { name: 'Jio', icon: '📱' },
    { name: 'Vodafone Idea', icon: '📞' },
    { name: 'BSNL', icon: '📡' },
  ]

  const rechargeTypes = [
    {
      title: 'Prepaid Recharge',
      description: 'Instant prepaid mobile recharges for all major operators. Support for all recharge plans and data packs.',
      features: ['Instant activation', 'All plans supported', 'Data packs available'],
    },
    {
      title: 'Postpaid Bill Payment',
      description: 'Pay postpaid mobile and landline bills. Support for all major telecom operators.',
      features: ['Bill payment', 'All operators', 'Instant confirmation'],
    },
    {
      title: 'DTH Recharge',
      description: 'Recharge DTH services for all major providers. Support for all DTH operators in India.',
      features: ['DTH recharge', 'All providers', 'Package selection'],
    },
    {
      title: 'Data Card Recharge',
      description: 'Recharge data cards and dongles. Support for all major data card providers.',
      features: ['Data card recharge', 'Multiple providers', 'Flexible plans'],
    },
  ]

  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Mobile Recharge Services
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Instant Recharges, All Operators
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Enable your customers to recharge their mobile phones, DTH, and data cards instantly. 
                Support for all major operators with instant activation and confirmation.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Start Offering Recharge
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
                Supported Operators
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Recharge services for all major telecom operators
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {operators.map((operator, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card text-center">
                    <div className="text-5xl mb-4">{operator.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900">{operator.name}</h3>
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
                Recharge Services
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {rechargeTypes.map((type, index) => (
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

      <AnimatedSection delay={0.4}>
        <section className="section-padding bg-gradient-to-r from-primary-600 to-secondary-600">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              Start Offering Recharge Services
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Join thousands of businesses offering instant recharge services.
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

