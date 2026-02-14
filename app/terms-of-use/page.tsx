import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'

export const metadata: Metadata = {
  title: 'Terms Of Use - Same Day Solution Pvt. Ltd.',
  description: 'Terms of Use for Same Day Solution platform and services. Please read carefully before using our services.',
}

export default function TermsOfUse() {
  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 to-secondary-50/30">
          <div className="max-w-7xl mx-auto">
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                Terms Of Use
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
              <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Acceptance of Terms</h2>
              <p className="text-gray-700 leading-relaxed">
                By accessing and using the Same Day Solution platform, website, mobile applications, and services 
                (collectively, the "Platform"), you accept and agree to be bound by these Terms of Use. If you do 
                not agree to these Terms of Use, please do not use our Platform.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Platform Usage</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>2.1 Authorized Use:</strong> You may use the Platform only for lawful purposes and in 
                accordance with these Terms of Use. You agree to use the Platform only for legitimate business 
                purposes related to fintech services.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>2.2 Prohibited Activities:</strong> You agree not to:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Use the Platform for any illegal or unauthorized purpose</li>
                <li>Violate any applicable laws, rules, or regulations</li>
                <li>Interfere with or disrupt the Platform or servers</li>
                <li>Attempt to gain unauthorized access to any part of the Platform</li>
                <li>Transmit any viruses, malware, or harmful code</li>
                <li>Use automated systems to access the Platform without authorization</li>
                <li>Copy, modify, or create derivative works of the Platform</li>
                <li>Reverse engineer or attempt to extract source code</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">3. Account Registration</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>3.1 Account Creation:</strong> To use certain features of the Platform, you must register 
                and create an account. You agree to provide accurate, current, and complete information during 
                registration.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>3.2 Account Security:</strong> You are responsible for maintaining the confidentiality 
                of your account credentials and for all activities that occur under your account. You must 
                immediately notify us of any unauthorized use of your account.
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>3.3 Account Termination:</strong> We reserve the right to suspend or terminate your account 
                at any time, with or without notice, for violation of these Terms of Use or for any other reason 
                we deem necessary.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Services and Transactions</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>4.1 Service Availability:</strong> We strive to ensure 24/7 availability of our services, 
                but we do not guarantee uninterrupted or error-free service. Services may be temporarily unavailable 
                due to maintenance, updates, or technical issues.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>4.2 Transaction Processing:</strong> All transactions are subject to verification and 
                approval. We reserve the right to decline any transaction at our sole discretion.
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>4.3 Service Modifications:</strong> We reserve the right to modify, suspend, or discontinue 
                any service at any time with or without notice.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Intellectual Property</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                All content, features, and functionality of the Platform, including but not limited to text, 
                graphics, logos, icons, images, software, and the compilation thereof, are the exclusive property 
                of Same Day Solution Pvt. Ltd. and are protected by Indian copyright, trademark, and other 
                intellectual property laws.
              </p>
              <p className="text-gray-700 leading-relaxed">
                You may not reproduce, distribute, modify, create derivative works of, publicly display, publicly 
                perform, republish, download, store, or transmit any of the material on our Platform without our 
                prior written consent.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">6. User Content</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>6.1 Content Submission:</strong> You may submit content to the Platform, including 
                feedback, reviews, and other materials. By submitting content, you grant us a non-exclusive, 
                royalty-free, perpetual, and worldwide license to use, modify, and distribute such content.
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>6.2 Content Responsibility:</strong> You are solely responsible for any content you submit. 
                You represent and warrant that you have all necessary rights to submit such content and that it 
                does not violate any third-party rights or applicable laws.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Limitation of Liability</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, SAME DAY SOLUTION PVT. LTD. SHALL NOT BE LIABLE 
                FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED 
                TO LOSS OF PROFITS, DATA, USE, OR OTHER INTANGIBLE LOSSES, RESULTING FROM YOUR USE OF OR INABILITY 
                TO USE THE PLATFORM.
              </p>
              <p className="text-gray-700 leading-relaxed">
                Our total liability to you for any claims arising out of or relating to these Terms of Use or the 
                Platform shall not exceed the total amount of fees paid by you to us in the twelve (12) months 
                preceding the claim.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Indemnification</h2>
              <p className="text-gray-700 leading-relaxed">
                You agree to indemnify, defend, and hold harmless Same Day Solution Pvt. Ltd., its officers, 
                directors, employees, agents, and affiliates from and against any and all claims, damages, 
                obligations, losses, liabilities, costs, or debt, and expenses (including but not limited to 
                attorney's fees) arising from your use of the Platform, violation of these Terms of Use, or 
                violation of any third-party right.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Governing Law</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                These Terms of Use shall be governed by and construed in accordance with the laws of India, without 
                regard to its conflict of law provisions. Any disputes arising out of or in connection with these 
                Terms of Use shall be subject to the exclusive jurisdiction of the courts in Delhi, India.
              </p>
              <p className="text-gray-700 leading-relaxed">
                Nothing in these Terms of Use shall affect your rights as a consumer under the Consumer Protection 
                Act, 2019, or any other applicable consumer protection laws in India.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">10. Changes to Terms</h2>
              <p className="text-gray-700 leading-relaxed">
                We reserve the right to modify these Terms of Use at any time. We will notify you of any material 
                changes by posting the new Terms of Use on this page and updating the "Last Updated" date. Your 
                continued use of the Platform after any such changes constitutes your acceptance of the new Terms 
                of Use.
              </p>
            </div>

            <div className="card">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">11. Contact Information</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                If you have any questions about these Terms of Use, please contact us at:
              </p>
              <div className="bg-gray-50 p-6 rounded-lg">
                <p className="text-gray-700 mb-2"><strong>Same Day Solution Pvt. Ltd.</strong></p>
                <p className="text-gray-700 mb-2">Email: legal@samedaysolution.in</p>
                <p className="text-gray-700 mb-2">Phone: +91-7090601025</p>
                <p className="text-gray-700">Address: TF-11B, 3rd Floor, Eros Metro Mall, Dwarka Sector-14, New Delhi-110078</p>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

