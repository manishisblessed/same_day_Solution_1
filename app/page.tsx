import Hero from '@/components/Hero'
import ServiceCard from '@/components/ServiceCard'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export default function Home() {
  const services = [
    {
      icon: '🏦',
      title: 'Banking & Payments',
      description: 'Transform your shop into a complete banking hub where customers can access all their banking needs. From account services to digital payments, we make it easy for you to serve your community with trusted, secure financial solutions.',
      link: '/services/banking-payments',
    },
    {
      icon: '🏧',
      title: 'Mini-ATM, POS & WPOS',
      description: 'Help your customers withdraw cash and make card payments right at your store! Our Mini-ATM, POS, and WPOS services let you offer banking facilities without the heavy investment. Your customers can use their debit/credit cards to withdraw money and make payments, and you earn with every transaction.',
      link: '/services/mini-atm',
    },
    {
      icon: '👆',
      title: 'AEPS Services',
      description: 'No card? No problem! With AEPS, your customers can withdraw cash, check balances, and transfer money using just their Aadhaar number and fingerprint. It\'s simple, secure, and perfect for everyone in your community.',
      link: '/services/aeps',
    },
    {
      icon: '💳',
      title: 'Aadhaar Pay',
      description: 'Let your customers pay for purchases using their Aadhaar card and fingerprint - no need for cash or cards! This secure payment method makes shopping easier for your customers and helps you serve more people.',
      link: '/services/merchant-payments',
    },
    {
      icon: '💸',
      title: 'Domestic Money Transfer',
      description: 'Help people send money to their loved ones across India instantly. Whether it\'s supporting family back home or paying for services, your customers can transfer money quickly and safely through your shop.',
      link: '/services/dmt',
    },
    {
      icon: '📄',
      title: 'Utility Bill Payments',
      description: 'Make life easier for your customers by letting them pay all their utility bills at your shop. From electricity and water to internet and gas - one place for all their monthly payments. They\'ll thank you for the convenience!',
      link: '/services/bill-payments',
    },
    {
      icon: '📱',
      title: 'Mobile Recharge',
      description: 'Keep your customers connected! Offer instant mobile, DTH, and data card recharges for all major operators. Whether it\'s prepaid or postpaid, your customers can recharge in seconds right at your counter.',
      link: '/services/recharge',
    },
    {
      icon: '✈️',
      title: 'Travel Services',
      description: 'Turn your shop into a travel booking center! Help your customers book bus tickets, flights, and hotels. They\'ll love the convenience of booking their trips while running other errands.',
      link: '/services/travel',
    },
    {
      icon: '💰',
      title: 'Cash Management',
      description: 'Partner with micro-finance companies to collect loan installments from customers. It\'s a reliable way to earn while helping people manage their loan payments conveniently at your location.',
      link: '/services/cash-management',
    },
    {
      icon: '🛡️',
      title: 'LIC Bill Payment',
      description: 'Help your customers stay protected by making their LIC premium payments easy and convenient. They can pay their insurance premiums right at your shop, ensuring their family\'s financial security stays intact.',
      link: '/services/lic-payment',
    },
    {
      icon: '🏥',
      title: 'Insurance',
      description: 'Offer comprehensive insurance services to help your customers protect what matters most. From health and life insurance to vehicle and property coverage, make insurance accessible to everyone in your community.',
      link: '/services/insurance',
    },
  ]

  const whyChooseUs = [
    {
      title: 'Fast Processing',
      description: 'Same-day processing capabilities ensure your transactions are handled with speed and efficiency.',
      icon: '⚡',
    },
    {
      title: 'Secure Systems',
      description: 'Bank-level encryption and security protocols protect your data and transactions at every step.',
      icon: '🔒',
    },
    {
      title: 'Compliance-First',
      description: 'We prioritize regulatory compliance and stay updated with the latest financial regulations.',
      icon: '✅',
    },
    {
      title: 'Dedicated Support',
      description: 'Our expert team provides round-the-clock support to ensure smooth operations.',
      icon: '💼',
    },
  ]

  const testimonials = [
    {
      name: 'Rajesh Kumar',
      role: 'Retail Store Owner',
      company: 'Kumar General Store',
      content: 'Same Day Solution has transformed our business. We can now offer banking services to our customers, which has increased footfall significantly. The AEPS integration was seamless, and the support team is always helpful.',
      rating: 5,
    },
    {
      name: 'Priya Sharma',
      role: 'Business Correspondent',
      company: 'Sharma Financial Services',
      content: 'I\'ve been using their DMT and bill payment services for over a year now. The platform is reliable, transactions are fast, and the commission structure is very competitive. Highly recommended!',
      rating: 5,
    },
    {
      name: 'Amit Patel',
      role: 'CEO',
      company: 'Tech Solutions Pvt. Ltd.',
      content: 'The API integration was straightforward, and their documentation is excellent. We integrated multiple services within a week. The dashboard provides great insights into our transactions.',
      rating: 5,
    },
  ]

  return (
    <>
      <Hero />
      
      {/* Services Overview */}
      <AnimatedSection delay={0.1}>
        <section className="section-padding bg-gray-50 border-b border-gray-200">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Our Services
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Comprehensive fintech solutions tailored to meet your business needs
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {services.map((service, index) => (
                <AnimatedCard key={index} delay={index * 0.05}>
                  <Link href={service.link || '/services'} className="block h-full">
                    <div className="banking-card h-full hover:shadow-lg transition-all duration-300 group">
                      <div className="flex items-center justify-center w-16 h-16 rounded-lg bg-gradient-to-br from-primary-500/10 to-primary-600/10 mb-4 group-hover:scale-105 transition-transform duration-300 border border-primary-200">
                        {typeof service.icon === 'string' ? (
                          <span className="text-3xl">{service.icon}</span>
                        ) : (
                          service.icon
                        )}
                      </div>
                      <h3 className="text-xl font-bold text-gray-900 mb-2">{service.title}</h3>
                      <p className="text-gray-600 text-sm leading-relaxed">{service.description}</p>
                    </div>
                  </Link>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Why Choose Us */}
      <AnimatedSection delay={0.2}>
        <section className="section-padding bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Why Same Day Solution Pvt. Ltd.?
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Trusted by businesses for reliable, fast, and secure fintech solutions
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {whyChooseUs.map((item, index) => (
              <AnimatedCard key={index} delay={index * 0.1}>
                <div className="card text-center">
                  <div className="text-4xl mb-4">{item.icon}</div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{item.title}</h3>
                  <p className="text-gray-600">{item.description}</p>
                </div>
              </AnimatedCard>
            ))}
          </div>
        </div>
        </section>
      </AnimatedSection>

      {/* Testimonials */}
      <AnimatedSection delay={0.3}>
        <section className="section-padding bg-gray-50 border-b border-gray-200">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                What Our Customers Say
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Real stories from businesses using our fintech solutions
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {testimonials.map((testimonial, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card h-full">
                    <div className="flex items-center mb-4">
                      {[...Array(testimonial.rating)].map((_, i) => (
                        <svg key={i} className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      ))}
                    </div>
                    <p className="text-gray-700 mb-6 leading-relaxed italic">"{testimonial.content}"</p>
                    <div>
                      <div className="font-semibold text-gray-900">{testimonial.name}</div>
                      <div className="text-sm text-gray-600">{testimonial.role}, {testimonial.company}</div>
                    </div>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* Trust & Security Section */}
      <AnimatedSection delay={0.4}>
        <section className="section-padding bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
                Trust & Security
              </h2>
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
                    <svg className="w-6 h-6 text-primary-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Data Encryption
                  </h3>
                  <p className="text-gray-600">
                    All data is encrypted using industry-standard protocols to ensure maximum security and privacy.
                  </p>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
                    <svg className="w-6 h-6 text-secondary-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    Secure Infrastructure
                  </h3>
                  <p className="text-gray-600">
                    Our infrastructure is built with security as a priority, ensuring reliable and protected operations.
                  </p>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
                    <svg className="w-6 h-6 text-primary-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Regulatory Awareness
                  </h3>
                  <p className="text-gray-600">
                    We maintain awareness of financial regulations and operate with compliance as a core principle.
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-banking-50 to-gray-50 rounded-lg p-8 lg:p-12 border-2 border-primary-600/20 shadow-lg">
              <div className="text-center">
                <div className="flex justify-center mb-6">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-500 flex items-center justify-center shadow-lg">
                    <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">Your Security is Our Priority</h3>
                <p className="text-gray-700 leading-relaxed">
                  We understand the importance of trust in financial services. Every transaction, every interaction, 
                  and every piece of data is handled with the utmost care and security.
                </p>
              </div>
            </div>
          </div>
        </div>
        </section>
      </AnimatedSection>

      {/* Stats Section */}
      <AnimatedSection delay={0.5}>
        <section className="section-padding bg-gradient-to-r from-primary-600 via-primary-500 to-secondary-500 relative overflow-hidden">
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute inset-0" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}></div>
          </div>
          <div className="max-w-7xl mx-auto relative z-10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
              {[
                { number: '10,000+', label: 'Active Merchants', icon: '👥' },
                { number: '50M+', label: 'Transactions Processed', icon: '💳' },
                { number: '99.9%', label: 'Uptime Guarantee', icon: '⚡' },
                { number: '24/7', label: 'Support Available', icon: '🛟' },
              ].map((stat, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="transform hover:scale-105 transition-transform duration-300">
                    <div className="text-4xl mb-2">{stat.icon}</div>
                    <div className="text-4xl md:text-5xl font-bold text-white mb-2">{stat.number}</div>
                    <div className="text-white/90 font-medium">{stat.label}</div>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>
    </>
  )
}

