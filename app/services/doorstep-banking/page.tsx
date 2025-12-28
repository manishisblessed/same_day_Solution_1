import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Doorstep Banking - BC-Sakhi Services | Same Day Solution',
  description: 'Roinet has enabled more than 3,000 Women Mobile-Retailers called BC-Sakhi. Mobile banking services without brick & mortar shop.',
}

export default function DoorstepBanking() {
  const features = [
    {
      title: 'Mobile Banking',
      description: 'Carry banking services to customers\' doorsteps with portable equipment - no need for a physical shop.',
      icon: '🚪',
    },
    {
      title: 'Women Empowerment',
      description: 'Empower women entrepreneurs by enabling them to become mobile retailers and earn independently.',
      icon: '👩',
    },
    {
      title: 'Rural Reach',
      description: 'Extend banking services to rural and remote areas where traditional banking infrastructure is limited.',
      icon: '🌾',
    },
    {
      title: 'Flexible Operations',
      description: 'Operate from anywhere with portable equipment, providing services at customer locations.',
      icon: '📱',
    },
  ]

  const services = [
    {
      title: 'Cash Withdrawal',
      description: 'Enable customers to withdraw cash at their doorstep using AEPS or card-based transactions.',
    },
    {
      title: 'Balance Inquiry',
      description: 'Help customers check their account balance without visiting a bank or ATM.',
    },
    {
      title: 'Money Transfer',
      description: 'Facilitate money transfers and remittances for customers in their own locations.',
    },
    {
      title: 'Bill Payments',
      description: 'Assist customers in paying utility bills and other payments from their homes.',
    },
  ]

  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Doorstep Banking
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  BC-Sakhi Mobile Banking
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Roinet has enabled more than 3,000 Women Mobile-Retailers in various states. They are called "BC-Sakhi". 
                These women do not possess any brick & mortar shop and carry the equipment with them, providing banking 
                services at customers\' doorsteps.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Become BC-Sakhi
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
                  What is BC-Sakhi?
                </h2>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  BC-Sakhi (Business Correspondent - Friend) is a unique initiative that empowers women to become 
                  mobile banking agents. These women carry portable banking equipment and provide financial services 
                  directly to customers at their doorsteps or in their communities.
                </p>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  Unlike traditional retailers who operate from a fixed shop, BC-Sakhi women are mobile retailers 
                  who can operate from anywhere, making banking services accessible to people in rural and remote areas.
                </p>
                <p className="text-lg text-gray-700 leading-relaxed">
                  This program not only promotes financial inclusion but also empowers women by providing them with 
                  income-generating opportunities and financial independence.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
                <div className="text-center">
                  <div className="text-7xl mb-6">👩</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Empowering Women</h3>
                  <p className="text-gray-700 mb-6">
                    Join over 3,000 BC-Sakhi women who are providing banking services and earning independently. 
                    Be part of this empowering movement.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary-600">3,000+</div>
                      <div className="text-sm text-gray-600">BC-Sakhi</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-secondary-600">Mobile</div>
                      <div className="text-sm text-gray-600">Banking</div>
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
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {services.map((service, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card text-center h-full">
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
              Become a BC-Sakhi Today
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Join thousands of women providing doorstep banking services. Start your journey towards financial independence.
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

