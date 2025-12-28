import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Compliance & Security - Same Day Solution Pvt. Ltd.',
  description: 'Learn about our commitment to data protection, security, and regulatory compliance.',
}

export default function Compliance() {
  const securityFeatures = [
    {
      title: 'Data Encryption',
      description: 'All sensitive data is encrypted using industry-standard AES-256 encryption both in transit and at rest. We employ TLS 1.3 for secure communication channels.',
      icon: '🔐',
    },
    {
      title: 'Secure Infrastructure',
      description: 'Our infrastructure is built on secure cloud platforms with regular security audits, intrusion detection systems, and automated threat monitoring.',
      icon: '🛡️',
    },
    {
      title: 'Access Controls',
      description: 'Multi-factor authentication, role-based access controls, and regular access reviews ensure that only authorized personnel can access sensitive information.',
      icon: '👤',
    },
    {
      title: 'Regular Audits',
      description: 'We conduct regular security audits, vulnerability assessments, and penetration testing to identify and address potential security issues proactively.',
      icon: '🔍',
    },
    {
      title: 'Data Privacy',
      description: 'We follow privacy-first principles and implement data minimization strategies. Personal data is collected only when necessary and handled with utmost care.',
      icon: '🔒',
    },
    {
      title: 'Incident Response',
      description: 'Our incident response team is ready 24/7 to handle any security incidents. We have comprehensive procedures in place for detection, response, and recovery.',
      icon: '⚡',
    },
  ]

  const compliancePrinciples = [
    {
      title: 'Regulatory Awareness',
      description: 'We maintain awareness of applicable financial regulations and industry standards. Our compliance team continuously monitors regulatory developments to ensure our operations align with current requirements.',
    },
    {
      title: 'Privacy-First Approach',
      description: 'Privacy is at the core of everything we do. We implement data protection measures, privacy policies, and user consent mechanisms to protect personal information.',
    },
    {
      title: 'Secure Transactions',
      description: 'Every transaction is processed through secure channels with multiple layers of verification. We employ fraud detection systems and transaction monitoring to ensure security.',
    },
    {
      title: 'Transparent Operations',
      description: 'We believe in transparency and provide clear information about our security practices, data handling, and compliance measures to our clients and partners.',
    },
  ]

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <section className="section-padding bg-gradient-to-br from-primary-50/30 to-secondary-50/30">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            Compliance & Security
          </h1>
          <p className="text-xl text-gray-700 max-w-3xl mx-auto">
            Your security and compliance are our top priorities
          </p>
        </div>
      </section>

      {/* Security Features */}
      <section className="section-padding">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Security Measures
            </h2>
            <p className="text-lg text-gray-600">
              Multi-layered security to protect your data and transactions
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {securityFeatures.map((feature, index) => (
              <div key={index} className="card">
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance Principles */}
      <section className="section-padding bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Compliance Principles
            </h2>
            <p className="text-lg text-gray-600">
              Our commitment to regulatory compliance and ethical operations
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {compliancePrinciples.map((principle, index) => (
              <div key={index} className="card">
                <h3 className="text-xl font-bold text-gray-900 mb-3">{principle.title}</h3>
                <p className="text-gray-700 leading-relaxed">{principle.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Important Notice */}
      <section className="section-padding bg-gradient-to-br from-primary-100 to-secondary-100">
        <div className="max-w-4xl mx-auto">
          <div className="card bg-white">
            <div className="text-center">
              <div className="text-5xl mb-4">ℹ️</div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Regulatory Notice</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                Same Day Solution Pvt. Ltd. operates with awareness of applicable financial 
                regulations and industry standards. We maintain compliance with relevant 
                data protection and privacy laws. Our operations are designed to align with 
                regulatory requirements while providing innovative fintech solutions.
              </p>
              <p className="text-gray-600 text-sm">
                For specific compliance inquiries, please contact our compliance team through 
                our contact page.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Data Protection */}
      <section className="section-padding">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
                Data Protection
              </h2>
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    Secure Data Handling
                  </h3>
                  <p className="text-gray-700">
                    We implement comprehensive data protection measures including encryption, 
                    secure storage, and controlled access. All data handling follows strict 
                    protocols to ensure confidentiality and integrity.
                  </p>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    Privacy Policies
                  </h3>
                  <p className="text-gray-700">
                    Our privacy policies are designed to be transparent and user-friendly. 
                    We clearly communicate how data is collected, used, and protected.
                  </p>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    User Rights
                  </h3>
                  <p className="text-gray-700">
                    We respect user rights regarding their personal data, including access, 
                    correction, and deletion rights as applicable under relevant regulations.
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
              <div className="text-center">
                <div className="text-6xl mb-6">🔐</div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">Your Data is Protected</h3>
                <p className="text-gray-700">
                  We take data protection seriously. Every measure is taken to ensure your 
                  information remains secure, private, and handled with the utmost care.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

