import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'

export const metadata: Metadata = {
  title: 'About Us - Same Day Solution Pvt. Ltd.',
  description: 'Learn about Same Day Solution Pvt. Ltd. - Your trusted partner for innovative fintech solutions.',
}

export default function About() {
  return (
    <div className="bg-white">
      {/* Hero Section */}
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 to-secondary-50/30">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            About Same Day Solution Pvt. Ltd.
          </h1>
          <p className="text-xl text-gray-700 max-w-3xl mx-auto">
            Empowering businesses with cutting-edge financial technology solutions
          </p>
        </div>
        </section>
      </AnimatedSection>

      {/* Company Introduction */}
      <AnimatedSection delay={0.2}>
        <section className="section-padding">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">Who We Are</h2>
              <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                Same Day Solution Pvt. Ltd. is a leading fintech company dedicated to providing fast, 
                secure, and reliable financial technology solutions. We specialize in digital payments, 
                lending solutions, merchant services, and comprehensive fintech APIs.
              </p>
              <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                Our mission is to bridge the gap between traditional financial services and modern 
                digital solutions, making financial technology accessible, secure, and efficient for 
                businesses of all sizes.
              </p>
              <p className="text-lg text-gray-700 leading-relaxed">
                With a focus on innovation, security, and customer satisfaction, we have built a 
                reputation for delivering same-day processing capabilities while maintaining the 
                highest standards of data protection and regulatory compliance.
              </p>
            </div>
            <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
              <div className="text-center">
                <div className="text-6xl mb-6">🚀</div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">Innovation Driven</h3>
                <p className="text-gray-700">
                  We continuously evolve our technology stack to stay ahead of industry trends 
                  and provide cutting-edge solutions to our clients.
                </p>
              </div>
            </div>
          </div>
        </div>
        </section>
      </AnimatedSection>

      {/* Mission & Vision */}
      <AnimatedSection delay={0.3}>
        <section className="section-padding bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <AnimatedCard delay={0.1}>
              <div className="card">
                <div className="text-4xl mb-4">🎯</div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">Our Mission</h3>
                <p className="text-gray-700 leading-relaxed">
                  To provide fast, secure, and reliable fintech solutions that empower businesses 
                  to thrive in the digital economy. We are committed to delivering same-day 
                  processing capabilities while maintaining the highest standards of security, 
                  compliance, and customer service.
                </p>
              </div>
            </AnimatedCard>
            <AnimatedCard delay={0.2}>
              <div className="card">
                <div className="text-4xl mb-4">👁️</div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">Our Vision</h3>
                <p className="text-gray-700 leading-relaxed">
                  To become the most trusted fintech partner for businesses across industries, 
                  recognized for our innovation, reliability, and commitment to excellence. We 
                  envision a future where financial technology is seamlessly integrated into 
                  every business operation.
                </p>
              </div>
            </AnimatedCard>
          </div>
        </div>
        </section>
      </AnimatedSection>

      {/* Core Values */}
      <AnimatedSection delay={0.4}>
        <section className="section-padding">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Our Core Values
            </h2>
            <p className="text-lg text-gray-600">
              The principles that guide everything we do
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <AnimatedCard delay={0.1}>
              <div className="text-center">
                <div className="text-5xl mb-4">⚡</div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Speed</h3>
                <p className="text-gray-600">
                  Same-day processing and rapid response times to keep your business moving forward.
                </p>
              </div>
            </AnimatedCard>
            <AnimatedCard delay={0.2}>
              <div className="text-center">
                <div className="text-5xl mb-4">🔒</div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Security</h3>
                <p className="text-gray-600">
                  Bank-level encryption and security protocols to protect your data and transactions.
                </p>
              </div>
            </AnimatedCard>
            <AnimatedCard delay={0.3}>
              <div className="text-center">
                <div className="text-5xl mb-4">💡</div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Innovation</h3>
                <p className="text-gray-600">
                  Continuously evolving technology to provide cutting-edge solutions for your needs.
                </p>
              </div>
            </AnimatedCard>
          </div>
        </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

