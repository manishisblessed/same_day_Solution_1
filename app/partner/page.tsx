import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Partner With Us - Become a Partner | Same Day Solution',
  description: 'Join Same Day Solution as a partner. Become a retailer, distributor, or master distributor and grow your business with our fintech solutions.',
}

export default function Partner() {
  const partnershipTypes = [
    {
      title: 'Retailer',
      icon: '🏪',
      description: 'Start your own fintech business by becoming a retailer. Offer banking and payment services to customers from your shop.',
      benefits: [
        'Low investment required',
        'Multiple revenue streams',
        'Comprehensive training provided',
        '24/7 support',
        'Branded equipment and materials',
      ],
    },
    {
      title: 'Distributor',
      icon: '📦',
      description: 'Expand your business by becoming a distributor. Manage a network of retailers and earn commissions on their transactions.',
      benefits: [
        'Higher earning potential',
        'Manage multiple retailers',
        'Territory exclusivity',
        'Marketing support',
        'Priority technical support',
      ],
    },
    {
      title: 'Master Distributor',
      icon: '🌟',
      description: 'Take your business to the next level as a master distributor. Build and manage a large network with maximum earning potential.',
      benefits: [
        'Maximum earning potential',
        'Regional exclusivity',
        'Dedicated account manager',
        'Customized solutions',
        'Premium support and training',
      ],
    },
  ]

  const whyPartner = [
    {
      title: 'Proven Business Model',
      description: 'Join thousands of successful partners already earning with our platform. Our business model is tested and proven.',
      icon: '✅',
    },
    {
      title: 'Comprehensive Training',
      description: 'We provide complete training on all services, operations, and business management to ensure your success.',
      icon: '📚',
    },
    {
      title: 'Marketing Support',
      description: 'Get marketing materials, promotional support, and brand assets to help you grow your business.',
      icon: '📢',
    },
    {
      title: 'Technology Platform',
      description: 'Access our secure, certified technology platform with 24/7 uptime and real-time transaction monitoring.',
      icon: '💻',
    },
    {
      title: 'Multiple Services',
      description: 'Offer a wide range of services including banking, payments, bill payments, travel, and government services.',
      icon: '🎯',
    },
    {
      title: 'Ongoing Support',
      description: 'Our dedicated support team is always available to help you with any queries or technical issues.',
      icon: '🤝',
    },
  ]

  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Partner With Us
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Grow Your Business with Fintech
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Join Same Day Solution and become part of India's leading fintech network. Whether you're a retailer, 
                distributor, or master distributor, we have the right partnership opportunity for you.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Become a Partner
                </Link>
                <Link href="/business-login" className="btn-secondary">
                  Existing Partner Login
                </Link>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Partnership Types */}
      <AnimatedSection delay={0.2}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Choose Your Partnership Level
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Select the partnership model that best fits your business goals and investment capacity
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {partnershipTypes.map((type, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card h-full">
                    <div className="text-6xl mb-6 text-center">{type.icon}</div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-4 text-center">{type.title}</h3>
                    <p className="text-gray-700 mb-6 leading-relaxed">{type.description}</p>
                    <div className="border-t pt-6">
                      <h4 className="font-semibold text-gray-900 mb-3">Key Benefits:</h4>
                      <ul className="space-y-2">
                        {type.benefits.map((benefit, bIndex) => (
                          <li key={bIndex} className="flex items-start text-gray-600">
                            <svg className="w-5 h-5 text-primary-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>{benefit}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Why Partner */}
      <AnimatedSection delay={0.3}>
        <section className="section-padding bg-gray-50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Why Partner With Us?
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Discover the advantages of partnering with Same Day Solution
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {whyPartner.map((item, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card text-center h-full">
                    <div className="text-5xl mb-4">{item.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{item.title}</h3>
                    <p className="text-gray-600">{item.description}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Services You Can Offer */}
      <AnimatedSection delay={0.4}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Services You Can Offer
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                As a partner, you can offer a comprehensive range of fintech services
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { name: 'Banking & Payments', icon: '🏦' },
                { name: 'Mini-ATM Services', icon: '🏧' },
                { name: 'Aadhaar Pay', icon: '👆' },
                { name: 'Doorstep Banking', icon: '🚪' },
                { name: 'Travel Services', icon: '✈️' },
                { name: 'Bill Payments', icon: '📄' },
                { name: 'Cash Management', icon: '💰' },
                { name: 'Government Services', icon: '🏛️' },
              ].map((service, index) => (
                <AnimatedCard key={index} delay={index * 0.05}>
                  <div className="card text-center">
                    <div className="text-4xl mb-3">{service.icon}</div>
                    <h3 className="font-semibold text-gray-900">{service.name}</h3>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* How to Get Started */}
      <AnimatedSection delay={0.5}>
        <section className="section-padding bg-gradient-to-br from-primary-50 to-secondary-50">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                How to Get Started
              </h2>
            </div>
            <div className="space-y-6">
              {[
                { step: '1', title: 'Contact Us', desc: 'Fill out the partnership inquiry form or contact our partnership team' },
                { step: '2', title: 'Choose Partnership Level', desc: 'Select the partnership model that suits your business - Retailer, Distributor, or Master Distributor' },
                { step: '3', title: 'Complete Documentation', desc: 'Submit required documents and complete the KYC process' },
                { step: '4', title: 'Training & Setup', desc: 'Attend comprehensive training sessions and get your equipment set up' },
                { step: '5', title: 'Start Earning', desc: 'Begin offering services to customers and start earning commissions' },
              ].map((item, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="flex items-start space-x-6">
                    <div className="flex-shrink-0 w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 text-white text-2xl font-bold flex items-center justify-center">
                      {item.step}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-gray-900 mb-2">{item.title}</h3>
                      <p className="text-gray-700">{item.desc}</p>
                    </div>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* CTA */}
      <AnimatedSection delay={0.6}>
        <section className="section-padding bg-gradient-to-r from-primary-600 to-secondary-600">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              Ready to Start Your Partnership Journey?
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Join thousands of successful partners already earning with Same Day Solution. 
              Contact us today to get started.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/contact" className="bg-white text-primary-600 px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-all duration-300 shadow-lg">
                Contact Partnership Team
              </Link>
              <Link href="/business-login" className="bg-transparent border-2 border-white text-white px-8 py-3 rounded-lg font-semibold hover:bg-white/10 transition-all duration-300">
                Partner Login
              </Link>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

