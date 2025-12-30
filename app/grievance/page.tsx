import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Grievance Policy - Same Day Solution Pvt. Ltd.',
  description: 'Grievance redressal policy for Same Day Solution. Learn how to file and track your grievances.',
}

export default function Grievance() {
  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 to-secondary-50/30">
          <div className="max-w-7xl mx-auto">
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                Grievance Policy
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
                Same Day Solution Pvt. Ltd. ("Company", "we", "us", or "our") is committed to providing excellent customer service 
                and addressing all grievances in a timely and effective manner. This Grievance Policy ("Policy") outlines our 
                grievance redressal mechanism in compliance with the Information Technology Act, 2000, the Information Technology 
                (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, the Consumer Protection Act, 2019, and other 
                applicable laws in India.
              </p>
              <p className="text-gray-700 leading-relaxed">
                This Policy applies to all users of our fintech services, including merchants, end customers, and any other individuals 
                or entities who interact with our Services.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Grievance Officer</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                In accordance with the IT Rules, 2011, we have appointed a Grievance Officer to address your concerns and grievances. 
                The Grievance Officer is responsible for:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-6">
                <li>Receiving and acknowledging grievances</li>
                <li>Investigating grievances in a fair and timely manner</li>
                <li>Resolving grievances within the prescribed timelines</li>
                <li>Maintaining records of all grievances and their resolutions</li>
                <li>Providing updates on grievance status</li>
              </ul>
              <div className="bg-gray-50 p-6 rounded-lg">
                <p className="text-gray-700 mb-2"><strong>Grievance Officer</strong></p>
                <p className="text-gray-700 mb-2">Same Day Solution Pvt. Ltd.</p>
                <p className="text-gray-700 mb-2">Email: grievance@samedaysolution.in</p>
                <p className="text-gray-700 mb-2">Phone: +91-8130053898</p>
                <p className="text-gray-700">Address: TF-11B, 3rd Floor, Eros Metro Mall, Dwarka Sector-14, New Delhi-110078</p>
                <p className="text-gray-700 mt-4 text-sm">
                  <strong>Response Time:</strong> Within 30 days from the date of receipt of grievance
                </p>
              </div>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">3. Types of Grievances</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                You may file a grievance regarding:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Service-related issues, including transaction failures, delays, or errors</li>
                <li>Billing and payment disputes</li>
                <li>Account access issues</li>
                <li>Privacy and data protection concerns</li>
                <li>Unauthorized transactions</li>
                <li>Refund requests</li>
                <li>Technical issues affecting service delivery</li>
                <li>Violation of Terms and Conditions</li>
                <li>Any other matter related to our Services</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">4. How to File a Grievance</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>4.1 Online:</strong> You can file a grievance through:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>Email: grievance@samedaysolution.in</li>
                <li>Contact form on our website</li>
                <li>Customer support portal (if available)</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>4.2 Required Information:</strong> When filing a grievance, please provide:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>Your full name and contact information</li>
                <li>Account details (if applicable)</li>
                <li>Transaction ID or reference number (if applicable)</li>
                <li>Detailed description of the grievance</li>
                <li>Supporting documents or evidence</li>
                <li>Date and time of the incident (if applicable)</li>
              </ul>
              <p className="text-gray-700 leading-relaxed">
                <strong>4.3 Offline:</strong> You can also file a grievance by sending a written complaint to our registered office 
                address mentioned above.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Grievance Redressal Process</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>Step 1: Receipt and Acknowledgment</strong>
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>We will acknowledge receipt of your grievance within 2 business days</li>
                <li>You will receive a unique grievance reference number for tracking</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>Step 2: Investigation</strong>
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>Our Grievance Officer will investigate your grievance</li>
                <li>We may request additional information or documents from you</li>
                <li>Investigation may involve reviewing transaction logs, system records, and communication history</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>Step 3: Resolution</strong>
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>We will provide a resolution within 30 days from the date of receipt</li>
                <li>For complex grievances, we may require additional time, which will be communicated to you</li>
                <li>Resolution may include refund, correction, explanation, or other appropriate action</li>
              </ul>
              <p className="text-gray-700 leading-relaxed">
                <strong>Step 4: Communication</strong>
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>We will communicate the resolution to you via email or phone</li>
                <li>If you are not satisfied with the resolution, you may escalate as per Section 6</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Escalation Process</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                If you are not satisfied with the resolution provided by our Grievance Officer, you may:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li><strong>Level 1:</strong> Escalate to the Senior Management by emailing management@samedaysolution.in</li>
                <li><strong>Level 2:</strong> File a complaint with the Consumer Disputes Redressal Commission under the Consumer Protection Act, 2019</li>
                <li><strong>Level 3:</strong> Approach the appropriate regulatory authority, such as RBI (if applicable) or other relevant authorities</li>
                <li><strong>Level 4:</strong> Seek legal recourse through courts of competent jurisdiction in Delhi, India</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Timeline for Resolution</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>7.1 Standard Grievances:</strong> 30 days from the date of receipt
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>7.2 Complex Grievances:</strong> Up to 45 days, with prior intimation to you
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>7.3 Urgent Grievances:</strong> We will prioritize urgent grievances, such as unauthorized transactions or 
                security breaches, and aim to resolve them within 7-15 days.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Grievance Tracking</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                You can track the status of your grievance using the unique reference number provided in the acknowledgment. 
                You may also contact our customer support team for updates on your grievance status.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Confidentiality</h2>
              <p className="text-gray-700 leading-relaxed">
                We maintain strict confidentiality regarding all grievances. Information provided in grievances will be used solely 
                for the purpose of resolving the grievance and will not be disclosed to third parties except as required by law or 
                with your consent.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">10. False or Frivolous Grievances</h2>
              <p className="text-gray-700 leading-relaxed">
                Filing false or frivolous grievances is strictly prohibited. We reserve the right to take appropriate action, 
                including legal action, against individuals who file false or malicious grievances.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">11. Consumer Rights</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                Under the Consumer Protection Act, 2019, you have the right to:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>File a complaint with the Consumer Disputes Redressal Commission</li>
                <li>Seek redressal for deficiency in service</li>
                <li>Claim compensation for any loss or damage suffered</li>
                <li>Access our grievance redressal mechanism</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">12. Contact Information</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                For filing grievances or inquiries about this Policy, please contact:
              </p>
              <div className="bg-gray-50 p-6 rounded-lg">
                <p className="text-gray-700 mb-2"><strong>Grievance Officer</strong></p>
                <p className="text-gray-700 mb-2">Same Day Solution Pvt. Ltd.</p>
                <p className="text-gray-700 mb-2">Email: grievance@samedaysolution.in</p>
                <p className="text-gray-700 mb-2">Phone: +91-8130053898</p>
                <p className="text-gray-700 mb-2">Address: TF-11B, 3rd Floor, Eros Metro Mall, Dwarka Sector-14, New Delhi-110078</p>
                <p className="text-gray-700 mt-4">
                  <strong>Business Hours:</strong> Monday to Friday, 9:00 AM to 6:00 PM IST
                </p>
              </div>
            </div>

            <div className="card">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">13. Changes to Grievance Policy</h2>
              <p className="text-gray-700 leading-relaxed">
                We reserve the right to modify this Grievance Policy at any time. Changes will be effective immediately upon 
                posting on this page. We encourage you to review this Policy periodically for any updates.
              </p>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

