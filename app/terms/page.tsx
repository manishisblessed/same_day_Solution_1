import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'

export const metadata: Metadata = {
  title: 'Terms & Conditions - Same Day Solution Pvt. Ltd.',
  description: 'Terms and Conditions for using Same Day Solution fintech services. Please read carefully before using our services.',
}

export default function Terms() {
  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 to-secondary-50/30">
          <div className="max-w-7xl mx-auto">
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                Terms & Conditions
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
                Welcome to Same Day Solution Pvt. Ltd. ("Company", "we", "us", or "our"). These Terms and Conditions 
                ("Terms") govern your use of our fintech services, including but not limited to AEPS, DMT, Bill Payments, 
                Mobile Recharge, and other financial technology services (collectively, the "Services").
              </p>
              <p className="text-gray-700 leading-relaxed">
                By accessing or using our Services, you agree to be bound by these Terms. If you do not agree to these Terms, 
                please do not use our Services. These Terms constitute a legally binding agreement between you and Same Day 
                Solution Pvt. Ltd., governed by the laws of India and subject to the jurisdiction of courts in Delhi, India.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Definitions</h2>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li><strong>"User"</strong> or <strong>"You"</strong> means any individual or entity that accesses or uses our Services.</li>
                <li><strong>"Merchant"</strong> means any business entity that has entered into an agreement with us to offer our Services to end customers.</li>
                <li><strong>"Services"</strong> means all fintech services provided by Same Day Solution Pvt. Ltd., including AEPS, DMT, Bill Payments, Recharge, and related services.</li>
                <li><strong>"Platform"</strong> means our website, mobile applications, APIs, and any other digital interfaces through which we provide Services.</li>
                <li><strong>"Transaction"</strong> means any financial transaction processed through our Services.</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">3. Eligibility and Registration</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>3.1 Age Requirement:</strong> You must be at least 18 years old and have the legal capacity to enter into contracts under Indian law to use our Services.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>3.2 Registration:</strong> To use certain Services, you may be required to register and create an account. You agree to:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>Provide accurate, current, and complete information during registration</li>
                <li>Maintain and update your information to keep it accurate, current, and complete</li>
                <li>Maintain the security of your account credentials</li>
                <li>Accept responsibility for all activities that occur under your account</li>
                <li>Notify us immediately of any unauthorized use of your account</li>
              </ul>
              <p className="text-gray-700 leading-relaxed">
                <strong>3.3 KYC Compliance:</strong> You agree to comply with all Know Your Customer (KYC) requirements as mandated by applicable laws and regulations, including but not limited to the Prevention of Money Laundering Act, 2002, and rules issued by the Reserve Bank of India.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Use of Services</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>4.1 Permitted Use:</strong> You may use our Services only for lawful purposes and in accordance with these Terms. You agree not to:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>Use the Services for any illegal or unauthorized purpose</li>
                <li>Violate any applicable laws, rules, or regulations</li>
                <li>Infringe upon the rights of others</li>
                <li>Transmit any viruses, malware, or harmful code</li>
                <li>Attempt to gain unauthorized access to our systems or networks</li>
                <li>Interfere with or disrupt the Services or servers</li>
                <li>Use automated systems to access the Services without our prior written consent</li>
              </ul>
              <p className="text-gray-700 leading-relaxed">
                <strong>4.2 Service Availability:</strong> We strive to ensure 24/7 availability of our Services, but we do not guarantee uninterrupted or error-free service. We reserve the right to suspend, modify, or discontinue any Service at any time with or without notice.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Transactions and Payments</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>5.1 Transaction Processing:</strong> All transactions are subject to verification and approval. We reserve the right to decline any transaction at our sole discretion, including but not limited to transactions that appear fraudulent, suspicious, or violate these Terms.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>5.2 Transaction Fees:</strong> You agree to pay all applicable fees and charges associated with the Services as disclosed in our pricing plans. All fees are non-refundable unless otherwise stated in our Refund Policy.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>5.3 Settlement:</strong> Settlement of transactions will be made in accordance with the terms agreed upon in your merchant agreement. Settlement timelines may vary based on the type of Service and transaction.
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>5.4 Chargebacks and Disputes:</strong> You are responsible for handling chargebacks and disputes in accordance with applicable payment network rules and regulations. We may assist in dispute resolution, but the final responsibility lies with you.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Intellectual Property</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                All content, features, and functionality of our Services, including but not limited to text, graphics, logos, icons, images, software, and the compilation thereof, are the exclusive property of Same Day Solution Pvt. Ltd. and are protected by Indian copyright, trademark, and other intellectual property laws.
              </p>
              <p className="text-gray-700 leading-relaxed">
                You may not reproduce, distribute, modify, create derivative works of, publicly display, publicly perform, republish, download, store, or transmit any of the material on our Platform without our prior written consent.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Privacy and Data Protection</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Your use of our Services is also governed by our Privacy Policy, which is incorporated into these Terms by reference. We collect, use, and protect your personal information in accordance with the Information Technology Act, 2000, the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011, and other applicable data protection laws in India.
              </p>
              <p className="text-gray-700 leading-relaxed">
                By using our Services, you consent to the collection, use, and disclosure of your information as described in our Privacy Policy.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Limitation of Liability</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>8.1 Disclaimer:</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, OUR SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>8.2 Limitation:</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, SAME DAY SOLUTION PVT. LTD. SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, USE, OR OTHER INTANGIBLE LOSSES, RESULTING FROM YOUR USE OF OR INABILITY TO USE THE SERVICES.
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>8.3 Maximum Liability:</strong> Our total liability to you for any claims arising out of or relating to these Terms or the Services shall not exceed the total amount of fees paid by you to us in the twelve (12) months preceding the claim.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Indemnification</h2>
              <p className="text-gray-700 leading-relaxed">
                You agree to indemnify, defend, and hold harmless Same Day Solution Pvt. Ltd., its officers, directors, employees, agents, and affiliates from and against any and all claims, damages, obligations, losses, liabilities, costs, or debt, and expenses (including but not limited to attorney's fees) arising from: (a) your use of or access to the Services; (b) your violation of these Terms; (c) your violation of any third-party right, including without limitation any copyright, property, or privacy right; or (d) any claim that your use of the Services caused damage to a third party.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">10. Termination</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>10.1 Termination by You:</strong> You may terminate your account and stop using the Services at any time by providing written notice to us.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>10.2 Termination by Us:</strong> We may terminate or suspend your account and access to the Services immediately, without prior notice or liability, for any reason, including but not limited to breach of these Terms, fraudulent activity, or violation of applicable laws.
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>10.3 Effect of Termination:</strong> Upon termination, your right to use the Services will immediately cease. All provisions of these Terms that by their nature should survive termination shall survive, including ownership provisions, warranty disclaimers, indemnity, and limitations of liability.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">11. Governing Law and Dispute Resolution</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>11.1 Governing Law:</strong> These Terms shall be governed by and construed in accordance with the laws of India, without regard to its conflict of law provisions.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>11.2 Jurisdiction:</strong> Any disputes arising out of or in connection with these Terms or the Services shall be subject to the exclusive jurisdiction of the courts in Delhi, India.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>11.3 Dispute Resolution:</strong> In the event of any dispute, the parties shall first attempt to resolve the dispute through good faith negotiations. If the dispute cannot be resolved through negotiations within thirty (30) days, either party may refer the dispute to arbitration in accordance with the Arbitration and Conciliation Act, 1996. The arbitration shall be conducted by a single arbitrator appointed by mutual consent, and the seat of arbitration shall be Delhi, India.
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>11.4 Consumer Protection:</strong> Nothing in these Terms shall affect your rights as a consumer under the Consumer Protection Act, 2019, or any other applicable consumer protection laws in India.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">12. Changes to Terms</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                We reserve the right to modify these Terms at any time. We will notify you of any material changes by posting the new Terms on this page and updating the "Last Updated" date.
              </p>
              <p className="text-gray-700 leading-relaxed">
                Your continued use of the Services after any such changes constitutes your acceptance of the new Terms. If you do not agree to the modified Terms, you must stop using the Services.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">13. Contact Information</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                If you have any questions about these Terms, please contact us at:
              </p>
              <div className="bg-gray-50 p-6 rounded-lg">
                <p className="text-gray-700 mb-2"><strong>Same Day Solution Pvt. Ltd.</strong></p>
                <p className="text-gray-700 mb-2">Email: legal@samedaysolution.com</p>
                <p className="text-gray-700 mb-2">Phone: [Contact Number]</p>
                <p className="text-gray-700">Address: [Registered Office Address], Delhi, India</p>
              </div>
            </div>

            <div className="card">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">14. Severability</h2>
              <p className="text-gray-700 leading-relaxed">
                If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary so that these Terms shall otherwise remain in full force and effect and enforceable.
              </p>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

