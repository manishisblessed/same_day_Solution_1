import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Government Services - PAN Card, Tax Filing & More | Same Day Solution',
  description: 'Help customers with government services like PAN card application, income tax filing, GST returns, and other government-related services.',
}

export default function GovernmentServices() {
  const services = [
    {
      title: 'PAN Card Application',
      description: 'Assist customers in applying for new PAN cards or making corrections to existing PAN cards.',
      icon: '🆔',
    },
    {
      title: 'Income Tax Filing',
      description: 'Help customers file their income tax returns with proper guidance and support.',
      icon: '📊',
    },
    {
      title: 'GST Returns',
      description: 'Assist businesses in filing GST returns and managing their GST compliance.',
      icon: '📋',
    },
    {
      title: 'Aadhaar Services',
      description: 'Help customers with Aadhaar enrollment, updates, and corrections.',
      icon: '👤',
    },
    {
      title: 'Voter ID Services',
      description: 'Assist customers with voter ID card applications and updates.',
      icon: '🗳️',
    },
    {
      title: 'Other Government Services',
      description: 'Support for various other government services and document-related assistance.',
      icon: '🏛️',
    },
  ]

  const benefits = [
    {
      title: 'Customer Trust',
      description: 'Build trust with customers by helping them with important government services and documentation.',
    },
    {
      title: 'Service Fees',
      description: 'Earn service fees for assisting customers with government service applications and filings.',
    },
    {
      title: 'Increased Footfall',
      description: 'Attract customers who need assistance with government services, increasing shop visits.',
    },
    {
      title: 'Community Service',
      description: 'Provide valuable community service by helping people navigate government processes.',
    },
  ]

  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Government Services
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Citizen Service Center
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Roinet retailers can help customers with several services that they find difficult to do on their 
                own and need guidance, such as applying for a PAN card or filing income tax and GST returns. 
                Become a citizen service center in your area.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Start Government Services
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
                  Your Shop as a Citizen Service Center
                </h2>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  Many people find it difficult to navigate government processes and need assistance with services 
                  like PAN card applications, tax filing, GST returns, and other government-related documentation.
                </p>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  As a Roinet retailer, you can help these customers by providing guidance and assistance with 
                  various government services. This not only helps your community but also creates additional 
                  revenue opportunities for your business.
                </p>
                <p className="text-lg text-gray-700 leading-relaxed">
                  We provide training and support to help you assist customers with these services effectively 
                  and accurately.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
                <div className="text-center">
                  <div className="text-7xl mb-6">🏛️</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Citizen Services</h3>
                  <p className="text-gray-700 mb-6">
                    Help customers with government services and documentation. 
                    Become a trusted service provider in your community.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary-600">Expert</div>
                      <div className="text-sm text-gray-600">Guidance</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-secondary-600">Trusted</div>
                      <div className="text-sm text-gray-600">Service</div>
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
                Government Services Available
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map((service, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card text-center h-full">
                    <div className="text-5xl mb-4">{service.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{service.title}</h3>
                    <p className="text-gray-600">{service.description}</p>
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
              Start Offering Government Services
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Help customers with government services and become a trusted citizen service center in your area.
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

