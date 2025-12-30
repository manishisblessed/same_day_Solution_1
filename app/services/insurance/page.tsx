import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Insurance Services - Comprehensive Insurance Solutions | Same Day Solution',
  description: 'Offer comprehensive insurance services to help your customers protect what matters most. From health and life insurance to vehicle and property coverage.',
}

export default function InsuranceService() {
  const insuranceTypes = [
    {
      title: 'Health Insurance',
      description: 'Help customers secure health insurance policies that cover medical expenses, hospitalization, and critical illnesses. Protect their health and finances.',
      icon: '🏥',
    },
    {
      title: 'Life Insurance',
      description: 'Offer life insurance policies that provide financial security to families. Help customers protect their loved ones\' future.',
      icon: '🛡️',
    },
    {
      title: 'Vehicle Insurance',
      description: 'Enable customers to purchase or renew vehicle insurance for cars, bikes, and commercial vehicles. Mandatory coverage made easy.',
      icon: '🚗',
    },
    {
      title: 'Property Insurance',
      description: 'Provide home and property insurance coverage to protect against damages, theft, and natural disasters.',
      icon: '🏠',
    },
  ]

  const features = [
    {
      title: 'Multiple Insurance Providers',
      description: 'Access to policies from leading insurance companies. Compare and choose the best coverage for your customers.',
      icon: '🏢',
    },
    {
      title: 'Easy Policy Management',
      description: 'Help customers purchase new policies, renew existing ones, and manage their insurance portfolio all from your shop.',
      icon: '📋',
    },
    {
      title: 'Instant Policy Issuance',
      description: 'Quick policy processing and instant issuance for most insurance types. Your customers get coverage immediately.',
      icon: '⚡',
    },
    {
      title: 'Claims Support',
      description: 'Assist customers with insurance claims processing. Help them navigate the claims procedure smoothly.',
      icon: '✅',
    },
  ]

  const benefits = [
    {
      title: 'Comprehensive Coverage',
      description: 'Offer a wide range of insurance products covering health, life, vehicle, and property. Become a one-stop insurance solution center for your community.',
    },
    {
      title: 'Commission Earnings',
      description: 'Earn attractive commissions on every insurance policy sold or renewed. Build a steady income stream through insurance services.',
    },
    {
      title: 'Customer Loyalty',
      description: 'Insurance policies are long-term commitments. Customers will return to your shop for renewals and new policies, building lasting relationships.',
    },
    {
      title: 'Community Protection',
      description: 'Help your community stay financially protected. Insurance provides peace of mind and financial security during difficult times.',
    },
  ]

  const services = [
    {
      title: 'New Policy Purchase',
      description: 'Help customers buy new insurance policies. Guide them through policy selection and documentation.',
    },
    {
      title: 'Policy Renewal',
      description: 'Enable customers to renew their existing insurance policies conveniently at your shop without visiting insurance offices.',
    },
    {
      title: 'Premium Payments',
      description: 'Accept insurance premium payments for all types of policies. Multiple payment options for customer convenience.',
    },
    {
      title: 'Policy Information',
      description: 'Help customers check their policy details, coverage information, premium due dates, and claim status.',
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
              <span className="text-gray-900 font-medium">Insurance</span>
            </nav>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Insurance Services
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Protect What Matters Most
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Offer comprehensive insurance services to help your customers protect what matters most. From health and life 
                insurance to vehicle and property coverage, make insurance accessible to everyone in your community.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Start Insurance Services
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
                  Why Offer Insurance Services?
                </h2>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  Insurance is essential for financial security and peace of mind. However, many people find it 
                  challenging to navigate the insurance market, understand policy terms, or remember renewal dates. 
                  They often need guidance and support to make the right insurance decisions.
                </p>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  By offering insurance services at your shop, you provide valuable assistance to your community 
                  while creating multiple revenue opportunities. Your customers will appreciate having a trusted 
                  advisor nearby who can help them protect their health, life, vehicles, and property.
                </p>
                <p className="text-lg text-gray-700 leading-relaxed">
                  Insurance policies are long-term commitments, meaning customers will return to your shop for 
                  renewals, premium payments, and new policies. This creates a steady stream of business and 
                  builds lasting customer relationships.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
                <div className="text-center">
                  <div className="text-7xl mb-6">🏥</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Complete Protection</h3>
                  <p className="text-gray-700 mb-6">
                    Help your customers protect their health, life, vehicles, and property. 
                    Comprehensive insurance coverage for all their needs.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary-600">All</div>
                      <div className="text-sm text-gray-600">Insurance Types</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-secondary-600">Easy</div>
                      <div className="text-sm text-gray-600">Management</div>
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
                Insurance Types We Offer
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Comprehensive insurance solutions covering all aspects of your customers' lives
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {insuranceTypes.map((type, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card text-center h-full">
                    <div className="text-5xl mb-4">{type.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{type.title}</h3>
                    <p className="text-gray-600">{type.description}</p>
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

      <AnimatedSection delay={0.5}>
        <section className="section-padding bg-gray-50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Services Available
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {services.map((service, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card">
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{service.title}</h3>
                    <p className="text-gray-700 leading-relaxed">{service.description}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.6}>
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

      <AnimatedSection delay={0.7}>
        <section className="section-padding bg-gradient-to-r from-primary-600 to-secondary-600">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              Start Offering Insurance Services
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Help your customers protect what matters most while building a profitable insurance business.
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

