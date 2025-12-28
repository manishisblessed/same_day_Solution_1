import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'How It Works - Simple Integration Process | Same Day Solution',
  description: 'Learn how easy it is to integrate our fintech services. Simple 3-step process to get started with our platform.',
}

export default function HowItWorks() {
  const steps = [
    {
      number: '1',
      title: 'Sign Up & Get Approved',
      description: 'Register your business with us and complete the onboarding process. Our team will verify your documents and approve your account within 24-48 hours.',
      details: [
        'Fill out the registration form',
        'Submit required business documents',
        'Complete KYC verification',
        'Get account approval',
      ],
      icon: '📝',
    },
    {
      number: '2',
      title: 'Integrate Our APIs',
      description: 'Integrate our APIs into your platform using our comprehensive documentation and SDKs. Our developer-friendly APIs make integration quick and easy.',
      details: [
        'Access developer dashboard',
        'Get API keys and credentials',
        'Use our SDKs and documentation',
        'Test in sandbox environment',
      ],
      icon: '🔌',
    },
    {
      number: '3',
      title: 'Go Live & Start Serving',
      description: 'Once integration is complete, go live and start offering fintech services to your customers. Our support team is always available to help.',
      details: [
        'Complete integration testing',
        'Switch to production environment',
        'Start offering services',
        'Monitor transactions in dashboard',
      ],
      icon: '🚀',
    },
  ]

  const features = [
    {
      title: 'Developer-Friendly APIs',
      description: 'RESTful APIs with comprehensive documentation, code samples, and SDKs for popular programming languages.',
    },
    {
      title: 'Sandbox Environment',
      description: 'Test all features in our sandbox environment before going live. No risk, full functionality.',
    },
    {
      title: '24/7 Support',
      description: 'Our technical support team is available round-the-clock to help you with integration and troubleshooting.',
    },
    {
      title: 'Real-Time Dashboard',
      description: 'Monitor all transactions, generate reports, and manage your account through our intuitive dashboard.',
    },
  ]

  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                How It Works
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Simple 3-Step Integration
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Getting started with Same Day Solution is quick and easy. Follow our simple integration 
                process and start offering fintech services to your customers in no time.
              </p>
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Steps */}
      <AnimatedSection delay={0.2}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="space-y-16">
              {steps.map((step, index) => (
                <AnimatedSection key={index} delay={index * 0.2}>
                  <div className={`grid grid-cols-1 lg:grid-cols-2 gap-12 items-center ${index % 2 === 1 ? 'lg:flex-row-reverse' : ''}`}>
                    <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                      <div className="flex items-center mb-6">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 text-white text-3xl font-bold flex items-center justify-center mr-6">
                          {step.number}
                        </div>
                        <div className="text-5xl">{step.icon}</div>
                      </div>
                      <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">{step.title}</h2>
                      <p className="text-lg text-gray-700 mb-6 leading-relaxed">{step.description}</p>
                      <ul className="space-y-3">
                        {step.details.map((detail, dIndex) => (
                          <li key={dIndex} className="flex items-start">
                            <svg className="w-6 h-6 text-primary-600 mr-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="text-gray-700">{detail}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className={`bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12 ${index % 2 === 1 ? 'lg:order-1' : ''}`}>
                      <div className="text-center">
                        <div className="text-7xl mb-6">{step.icon}</div>
                        <h3 className="text-2xl font-bold text-gray-900 mb-4">{step.title}</h3>
                        <p className="text-gray-700">{step.description}</p>
                      </div>
                    </div>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Features */}
      <AnimatedSection delay={0.4}>
        <section className="section-padding bg-gray-50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Why Integration is Easy
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Everything you need for seamless integration
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {features.map((feature, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card">
                    <h3 className="text-2xl font-bold text-gray-900 mb-3">{feature.title}</h3>
                    <p className="text-gray-700 leading-relaxed">{feature.description}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Timeline */}
      <AnimatedSection delay={0.5}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Typical Integration Timeline
              </h2>
            </div>
            <div className="max-w-4xl mx-auto">
              <div className="space-y-8">
                {[
                  { time: 'Day 1-2', title: 'Account Setup', desc: 'Registration and document verification' },
                  { time: 'Day 3-5', title: 'API Integration', desc: 'Developers integrate APIs using our SDKs' },
                  { time: 'Day 6-7', title: 'Testing', desc: 'Comprehensive testing in sandbox environment' },
                  { time: 'Day 8+', title: 'Go Live', desc: 'Production launch and start serving customers' },
                ].map((item, index) => (
                  <AnimatedCard key={index} delay={index * 0.1}>
                    <div className="flex items-start space-x-6">
                      <div className="flex-shrink-0 w-24 text-right">
                        <div className="text-primary-600 font-bold text-lg">{item.time}</div>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-gray-900 mb-2">{item.title}</h3>
                        <p className="text-gray-600">{item.desc}</p>
                      </div>
                    </div>
                  </AnimatedCard>
                ))}
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* CTA */}
      <AnimatedSection delay={0.6}>
        <section className="section-padding bg-gradient-to-r from-primary-600 to-secondary-600">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              Ready to Get Started?
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Join thousands of businesses already using our platform. Start your integration today.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/contact" className="bg-white text-primary-600 px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-all duration-300 shadow-lg">
                Start Integration
              </Link>
              <Link href="/services" className="bg-transparent border-2 border-white text-white px-8 py-3 rounded-lg font-semibold hover:bg-white/10 transition-all duration-300">
                View Services
              </Link>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

