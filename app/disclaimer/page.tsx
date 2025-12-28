import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'

export const metadata: Metadata = {
  title: 'Disclaimer - Same Day Solution Pvt. Ltd.',
  description: 'Disclaimer for Same Day Solution fintech services. Important information about service limitations and liabilities.',
}

export default function Disclaimer() {
  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 to-secondary-50/30">
          <div className="max-w-7xl mx-auto">
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                Disclaimer
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
              <h2 className="text-2xl font-bold text-gray-900 mb-4">1. General Disclaimer</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                The information, services, and materials provided by Same Day Solution Pvt. Ltd. ("Company", "we", "us", or "our") 
                on our website and through our fintech services are provided on an "as is" and "as available" basis. We make no 
                representations or warranties of any kind, express or implied, about the completeness, accuracy, reliability, 
                suitability, or availability of the information, products, services, or related graphics contained on our platform 
                for any purpose.
              </p>
              <p className="text-gray-700 leading-relaxed">
                Any reliance you place on such information is therefore strictly at your own risk. We disclaim all liability and 
                responsibility arising from any reliance placed on such materials by you or any other visitor to our platform, 
                or by anyone who may be informed of any of its contents.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Service Availability</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                While we strive to ensure 24/7 availability of our Services, we do not guarantee that:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Our Services will be available at all times without interruption</li>
                <li>Our Services will be free from errors, defects, or viruses</li>
                <li>Our Services will meet your specific requirements or expectations</li>
                <li>Any defects or errors will be corrected</li>
                <li>Our platform or servers are free from viruses or other harmful components</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mt-4">
                We reserve the right to suspend, modify, or discontinue any Service at any time with or without notice. We shall not 
                be liable to you or any third party for any modification, suspension, or discontinuance of the Services.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">3. Financial Services Disclaimer</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>3.1 Not a Financial Institution:</strong> Same Day Solution Pvt. Ltd. is a technology service provider and 
                not a bank, financial institution, or licensed money service business. We facilitate transactions between you and 
                third-party service providers, including banks and payment processors.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>3.2 No Financial Advice:</strong> We do not provide financial, investment, or legal advice. Any information 
                provided on our platform is for general informational purposes only and should not be construed as financial advice.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>3.3 Regulatory Compliance:</strong> While we strive to comply with all applicable laws and regulations, 
                including those issued by the Reserve Bank of India (RBI), we do not claim to be directly regulated by RBI or 
                any other financial regulatory authority unless explicitly stated.
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>3.4 Third-Party Services:</strong> Our Services may involve third-party service providers, including banks, 
                payment processors, and other financial institutions. We are not responsible for the services, policies, or 
                practices of these third parties.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Transaction Disclaimer</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>4.1 Transaction Processing:</strong> We facilitate the processing of transactions but do not guarantee:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>That all transactions will be successful</li>
                <li>The speed or timing of transaction processing</li>
                <li>That transactions will be processed without errors</li>
                <li>The availability of funds in your account</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>4.2 Transaction Limits:</strong> Transaction limits may apply based on your account type, regulatory 
                requirements, and our risk management policies. We reserve the right to impose, modify, or remove transaction 
                limits at any time.
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>4.3 Transaction Reversals:</strong> We do not guarantee that transactions can be reversed. Reversal of 
                transactions is subject to the policies of the relevant banks, payment processors, and service providers.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Limitation of Liability</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, SAME DAY SOLUTION PVT. LTD. SHALL NOT BE LIABLE FOR:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>Any indirect, incidental, special, consequential, or punitive damages</li>
                <li>Loss of profits, revenue, data, or business opportunities</li>
                <li>Damages resulting from unauthorized access to or use of your account</li>
                <li>Damages resulting from the actions or omissions of third-party service providers</li>
                <li>Damages resulting from force majeure events, including natural disasters, war, terrorism, or government actions</li>
                <li>Any damages exceeding the total amount of fees paid by you to us in the twelve (12) months preceding the claim</li>
              </ul>
              <p className="text-gray-700 leading-relaxed">
                This limitation of liability applies regardless of the legal theory on which the claim is based, including contract, 
                tort, negligence, or strict liability.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">6. No Warranties</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT 
                NOT LIMITED TO:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Warranties of merchantability</li>
                <li>Warranties of fitness for a particular purpose</li>
                <li>Warranties of non-infringement</li>
                <li>Warranties regarding the accuracy, reliability, or completeness of information</li>
                <li>Warranties regarding uninterrupted or error-free service</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Third-Party Content and Links</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Our platform may contain links to third-party websites, services, or content. We do not endorse, control, or assume 
                responsibility for:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>The content, policies, or practices of third-party websites</li>
                <li>The accuracy or reliability of third-party information</li>
                <li>The security of third-party websites</li>
                <li>Any transactions or interactions between you and third parties</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mt-4">
                Your use of third-party websites and services is at your own risk and subject to the terms and conditions of those 
                third parties.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Security Disclaimer</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                While we implement reasonable security measures to protect your information, we cannot guarantee:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Absolute security of your data or transactions</li>
                <li>Protection against all possible security threats</li>
                <li>That unauthorized third parties will not gain access to your information</li>
                <li>That your information will not be intercepted during transmission</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mt-4">
                You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur 
                under your account.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Regulatory and Legal Disclaimer</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>9.1 Regulatory Changes:</strong> Financial regulations and laws may change from time to time. We are not 
                responsible for any impact of regulatory changes on your use of our Services.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>9.2 Compliance:</strong> While we strive to comply with all applicable laws and regulations, we do not 
                guarantee that our Services comply with all laws in all jurisdictions.
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>9.3 Legal Advice:</strong> Nothing on our platform constitutes legal, financial, or professional advice. 
                You should consult with appropriate professionals for advice specific to your situation.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">10. Force Majeure</h2>
              <p className="text-gray-700 leading-relaxed">
                We shall not be liable for any failure or delay in performance under these Terms which is due to force majeure events, 
                including but not limited to natural disasters, war, terrorism, riots, embargoes, acts of civil or military authorities, 
                fire, floods, accidents, network or infrastructure failures, strikes, or shortages of transportation facilities, fuel, 
                energy, labor, or materials.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">11. Jurisdiction and Governing Law</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                This Disclaimer shall be governed by and construed in accordance with the laws of India. Any disputes arising out of 
                or in connection with this Disclaimer shall be subject to the exclusive jurisdiction of the courts in Delhi, India.
              </p>
              <p className="text-gray-700 leading-relaxed">
                Nothing in this Disclaimer shall affect your rights as a consumer under the Consumer Protection Act, 2019, or any 
                other applicable consumer protection laws in India.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">12. Changes to Disclaimer</h2>
              <p className="text-gray-700 leading-relaxed">
                We reserve the right to modify this Disclaimer at any time. Changes will be effective immediately upon posting on 
                this page. Your continued use of our Services after any changes constitutes acceptance of the modified Disclaimer.
              </p>
            </div>

            <div className="card">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">13. Contact Us</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                If you have any questions about this Disclaimer, please contact us at:
              </p>
              <div className="bg-gray-50 p-6 rounded-lg">
                <p className="text-gray-700 mb-2"><strong>Same Day Solution Pvt. Ltd.</strong></p>
                <p className="text-gray-700 mb-2">Email: legal@samedaysolution.com</p>
                <p className="text-gray-700 mb-2">Phone: [Contact Number]</p>
                <p className="text-gray-700">Address: [Registered Office Address], Delhi, India</p>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

