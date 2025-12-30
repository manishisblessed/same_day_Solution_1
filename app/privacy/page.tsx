import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'

export const metadata: Metadata = {
  title: 'Privacy Policy - Same Day Solution Pvt. Ltd.',
  description: 'Privacy Policy explaining how Same Day Solution collects, uses, and protects your personal information in compliance with Indian laws.',
}

export default function Privacy() {
  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 to-secondary-50/30">
          <div className="max-w-7xl mx-auto">
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                Privacy Policy
              </h1>
              <p className="text-lg text-gray-700">
                Last Updated: {new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.2}>
        <section className="section-padding">
          <div className="max-w-4xl mx-auto prose prose-lg max-w-none">
            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Introduction</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Same Day Solution Pvt. Ltd. ("we", "us", "our", or "Company") is committed to protecting your privacy and personal information. 
                This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our fintech services 
                and platform.
              </p>
              <p className="text-gray-700 leading-relaxed">
                This Privacy Policy is compliant with the Information Technology Act, 2000, the Information Technology (Reasonable Security 
                Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011, and other applicable data protection laws 
                in India. By using our Services, you consent to the collection and use of information in accordance with this Privacy Policy.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Information We Collect</h2>
              
              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">2.1 Personal Information</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                We may collect the following types of personal information:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li><strong>Identity Information:</strong> Name, date of birth, gender, Aadhaar number, PAN number, and other government-issued identification documents</li>
                <li><strong>Contact Information:</strong> Email address, phone number, postal address, and billing address</li>
                <li><strong>Financial Information:</strong> Bank account details, payment card information, transaction history, and financial statements</li>
                <li><strong>Biometric Information:</strong> Fingerprint data, iris scans, and other biometric identifiers for authentication purposes</li>
                <li><strong>KYC Documents:</strong> Copies of identity proof, address proof, and other documents submitted for KYC verification</li>
                <li><strong>Business Information:</strong> Company name, registration number, GST number, business address, and other business-related details (for merchants)</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">2.2 Sensitive Personal Data or Information (SPDI)</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                As defined under the IT Rules, 2011, we may collect the following sensitive personal data:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>Password and authentication credentials</li>
                <li>Financial information such as bank account or credit card details</li>
                <li>Biometric information</li>
                <li>Physical, physiological, and mental health condition</li>
                <li>Sexual orientation</li>
                <li>Medical records and history</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">2.3 Technical Information</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                We automatically collect certain technical information when you use our Services:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>IP address, browser type, and device information</li>
                <li>Operating system and platform information</li>
                <li>Usage data, including pages visited, time spent, and features used</li>
                <li>Cookies and similar tracking technologies</li>
                <li>Location data (with your consent)</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">3. How We Collect Information</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                We collect information through various means:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li><strong>Directly from You:</strong> When you register, create an account, complete KYC, make transactions, or communicate with us</li>
                <li><strong>Automatically:</strong> Through cookies, log files, and other tracking technologies when you use our Services</li>
                <li><strong>From Third Parties:</strong> From banks, payment processors, credit bureaus, and other service providers</li>
                <li><strong>From Government Databases:</strong> For KYC verification through UIDAI, income tax department, and other authorized sources</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Purpose of Collection and Use</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                We use your information for the following purposes:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>To provide, maintain, and improve our Services</li>
                <li>To process transactions and facilitate payments</li>
                <li>To verify your identity and complete KYC requirements</li>
                <li>To comply with legal and regulatory obligations, including anti-money laundering and fraud prevention</li>
                <li>To communicate with you about your account, transactions, and Services</li>
                <li>To send you marketing communications (with your consent)</li>
                <li>To detect, prevent, and address fraud, security, or technical issues</li>
                <li>To analyze usage patterns and improve user experience</li>
                <li>To enforce our Terms and Conditions and other policies</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Disclosure of Information</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                We may disclose your information to:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li><strong>Service Providers:</strong> Banks, payment processors, technology providers, and other third-party service providers who assist us in operating our Services</li>
                <li><strong>Regulatory Authorities:</strong> As required by law, including RBI, SEBI, income tax department, and other government agencies</li>
                <li><strong>Business Partners:</strong> With your consent, we may share information with our business partners for joint services</li>
                <li><strong>Legal Requirements:</strong> When required by law, court orders, or legal processes</li>
                <li><strong>Business Transfers:</strong> In connection with any merger, acquisition, or sale of assets</li>
              </ul>
              <p className="text-gray-700 leading-relaxed">
                We do not sell your personal information to third parties for their marketing purposes.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Data Security</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                We implement reasonable security practices and procedures to protect your information from unauthorized access, alteration, 
                disclosure, or destruction, in accordance with the IT Rules, 2011. Our security measures include:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Encryption of data in transit and at rest using industry-standard encryption protocols</li>
                <li>Secure servers and databases with restricted access</li>
                <li>Regular security audits and vulnerability assessments</li>
                <li>Multi-factor authentication for account access</li>
                <li>Employee training on data protection and privacy</li>
                <li>Incident response procedures for security breaches</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mt-4">
                However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to use 
                commercially acceptable means to protect your information, we cannot guarantee absolute security.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Data Retention</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                We retain your personal information for as long as necessary to fulfill the purposes outlined in this Privacy Policy, 
                unless a longer retention period is required or permitted by law. Specifically:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>KYC documents and records are retained as per regulatory requirements (typically 5-7 years after account closure)</li>
                <li>Transaction records are retained for audit and compliance purposes</li>
                <li>Account information is retained until account closure and for a reasonable period thereafter</li>
                <li>We may retain anonymized or aggregated data for analytical purposes</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Your Rights</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Under the IT Act, 2000 and IT Rules, 2011, you have the following rights regarding your personal information:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li><strong>Right to Access:</strong> You can request access to your personal information that we hold</li>
                <li><strong>Right to Correction:</strong> You can request correction of inaccurate or incomplete information</li>
                <li><strong>Right to Withdraw Consent:</strong> You can withdraw your consent for processing of personal information (subject to legal and contractual obligations)</li>
                <li><strong>Right to Grievance:</strong> You can file a grievance regarding our data handling practices</li>
                <li><strong>Right to Opt-Out:</strong> You can opt-out of marketing communications at any time</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mt-4">
                To exercise these rights, please contact us at privacy@samedaysolution.in or through our Grievance Policy.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Cookies and Tracking Technologies</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                We use cookies and similar tracking technologies to collect and store information about your preferences and usage patterns. 
                You can control cookies through your browser settings. However, disabling cookies may limit your ability to use certain 
                features of our Services.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">10. Third-Party Links</h2>
              <p className="text-gray-700 leading-relaxed">
                Our Services may contain links to third-party websites or services. We are not responsible for the privacy practices of 
                these third parties. We encourage you to read the privacy policies of any third-party websites you visit.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">11. Children's Privacy</h2>
              <p className="text-gray-700 leading-relaxed">
                Our Services are not intended for individuals under the age of 18. We do not knowingly collect personal information from 
                children. If you believe we have collected information from a child, please contact us immediately.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">12. Changes to Privacy Policy</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new 
                Privacy Policy on this page and updating the "Last Updated" date.
              </p>
              <p className="text-gray-700 leading-relaxed">
                Your continued use of our Services after any such changes constitutes your acceptance of the new Privacy Policy.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">13. Grievance Officer</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                In accordance with the IT Rules, 2011, we have appointed a Grievance Officer to address your privacy concerns. 
                You can contact our Grievance Officer at:
              </p>
              <div className="bg-gray-50 p-6 rounded-lg">
                <p className="text-gray-700 mb-2"><strong>Grievance Officer</strong></p>
                <p className="text-gray-700 mb-2">Same Day Solution Pvt. Ltd.</p>
                <p className="text-gray-700 mb-2">Email: grievance@samedaysolution.in</p>
                <p className="text-gray-700 mb-2">Phone: +91-8130053898</p>
                <p className="text-gray-700">Address: TF-11B, 3rd Floor, Eros Metro Mall, Dwarka Sector-14, New Delhi-110078</p>
                <p className="text-gray-700 mt-4 text-sm">
                  <strong>Response Time:</strong> We will respond to your grievance within 30 days from the date of receipt.
                </p>
              </div>
            </div>

            <div className="card">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">14. Contact Us</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us at:
              </p>
              <div className="bg-gray-50 p-6 rounded-lg">
                <p className="text-gray-700 mb-2"><strong>Same Day Solution Pvt. Ltd.</strong></p>
                <p className="text-gray-700 mb-2">Email: privacy@samedaysolution.in</p>
                <p className="text-gray-700 mb-2">Phone: +91-8130053898</p>
                <p className="text-gray-700">Address: TF-11B, 3rd Floor, Eros Metro Mall, Dwarka Sector-14, New Delhi-110078</p>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

