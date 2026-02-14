import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'

export const metadata: Metadata = {
  title: 'Refund Policy - Same Day Solution Pvt. Ltd.',
  description: 'Refund Policy for Same Day Solution fintech services. Learn about our refund procedures and timelines.',
}

export default function Refund() {
  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 to-secondary-50/30">
          <div className="max-w-7xl mx-auto">
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                Refund Policy
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
              <p className="text-gray-700 leading-relaxed">
                This Refund Policy ("Policy") governs the refund procedures for Same Day Solution Pvt. Ltd. ("Company", "we", "us", or "our") 
                fintech services. This Policy is in compliance with the Consumer Protection Act, 2019, and other applicable laws in India. 
                By using our Services, you agree to this Refund Policy.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">2. General Refund Principles</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>2.1 Non-Refundable Services:</strong> Most of our fintech services, including transaction processing fees, 
                service charges, and subscription fees, are generally non-refundable once the service has been rendered or the transaction 
                has been processed.
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>2.2 Refund Eligibility:</strong> Refunds may be considered only in the following circumstances:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Technical failure on our part that prevents service delivery</li>
                <li>Duplicate transactions due to system error</li>
                <li>Unauthorized transactions from your account</li>
                <li>Service not delivered as per agreed terms</li>
                <li>As required by applicable law or regulatory authority</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">3. Service-Specific Refund Policies</h2>
              
              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">3.1 AEPS Services</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                AEPS transaction fees are non-refundable once the transaction is processed. However, refunds may be considered if:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-6">
                <li>The transaction failed due to our technical error, but the amount was debited</li>
                <li>Duplicate transaction occurred due to system malfunction</li>
                <li>The transaction was unauthorized</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">3.2 Aadhaar Pay Services</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                Aadhaar Pay transaction fees are non-refundable once the payment is processed. Refunds may be considered if:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-6">
                <li>The payment failed due to technical error but amount was debited</li>
                <li>Duplicate payment occurred due to system malfunction</li>
                <li>The payment was unauthorized or fraudulent</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">3.3 Mini-ATM, POS & WPOS Services</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                Cash withdrawal and card payment transaction fees are non-refundable. However, refunds may be considered if:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-6">
                <li>Cash withdrawal failed but amount was debited from customer account</li>
                <li>Duplicate transaction occurred due to device or system error</li>
                <li>Transaction was processed but cash was not dispensed due to technical fault</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">3.4 Domestic Money Transfer Services</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                Money transfer transaction fees are non-refundable. However, if a transfer fails after deduction of fees, we will:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-6">
                <li>Refund the transfer amount (excluding fees) if the transfer could not be completed</li>
                <li>Process the refund within 5-7 business days</li>
                <li>Investigate and resolve disputes within 15 business days</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">3.5 Utility Bill Payments</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                Bill payment transaction fees are non-refundable. Refunds for bill payments may be considered only if:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-6">
                <li>The payment was made but not credited to the biller due to our error</li>
                <li>Duplicate payment occurred due to technical error</li>
                <li>The payment was made to an incorrect account due to system error</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">3.6 LIC Bill Payment</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                LIC premium payment fees are non-refundable. Refunds may be considered if:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-6">
                <li>The premium payment was made but not credited to LIC due to our error</li>
                <li>Duplicate payment occurred due to technical error</li>
                <li>Payment was made to incorrect policy number due to system error</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">3.7 Mobile Recharge Services</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                Recharge transaction fees are non-refundable. Recharge amounts may be refunded only if:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-6">
                <li>The recharge failed but the amount was debited</li>
                <li>Duplicate recharge occurred due to technical error</li>
                <li>The recharge was not activated within 24 hours due to our error</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">3.8 Travel Services</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                Travel booking fees and commissions are generally non-refundable. However, refunds may be considered if:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-6">
                <li>Booking failed but payment was processed due to our error</li>
                <li>Duplicate booking occurred due to system error</li>
                <li>Booking was cancelled by the service provider and refund is applicable as per their policy</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">3.9 Insurance Services</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                Insurance premium payment fees are non-refundable. Premium refunds are subject to insurance company policies. However, we may consider refunding our service fees if:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-6">
                <li>Premium payment failed but amount was debited due to our error</li>
                <li>Duplicate payment occurred due to technical error</li>
                <li>Payment was made to incorrect policy due to system error</li>
              </ul>

              <h3 className="text-xl font-semibold text-gray-900 mb-3 mt-6">3.10 Cash Management Services</h3>
              <p className="text-gray-700 leading-relaxed mb-4">
                Loan installment collection fees are non-refundable once the collection is processed. Refunds may be considered if:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Collection was processed but not credited to the lender due to our error</li>
                <li>Duplicate collection occurred due to system error</li>
                <li>Collection was made for incorrect loan account due to technical error</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Refund Process</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>4.1 Refund Request:</strong> To request a refund, you must:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>Contact our customer support within 7 days of the transaction</li>
                <li>Provide transaction details, including transaction ID, date, and amount</li>
                <li>Submit supporting documents, if required</li>
                <li>Explain the reason for the refund request</li>
              </ul>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>4.2 Refund Investigation:</strong> We will investigate your refund request and may:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>Review transaction logs and system records</li>
                <li>Verify the transaction with relevant banks or service providers</li>
                <li>Request additional information or documents from you</li>
                <li>Complete the investigation within 15 business days</li>
              </ul>
              <p className="text-gray-700 leading-relaxed">
                <strong>4.3 Refund Processing:</strong> If your refund request is approved:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Refunds will be processed to the original payment method or bank account</li>
                <li>Processing time: 5-10 business days after approval</li>
                <li>You will receive a confirmation email once the refund is processed</li>
                <li>Refund amount will exclude any non-refundable fees or charges</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Subscription and Service Fees</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>5.1 Monthly/Annual Subscriptions:</strong> Subscription fees are non-refundable. However, if you cancel your 
                subscription:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
                <li>You will continue to have access until the end of the current billing period</li>
                <li>No refund will be provided for the unused portion of the subscription</li>
                <li>You will not be charged for the next billing cycle</li>
              </ul>
              <p className="text-gray-700 leading-relaxed">
                <strong>5.2 Setup Fees:</strong> One-time setup fees are non-refundable once the setup process has been initiated.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Chargebacks and Disputes</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                If you initiate a chargeback or dispute with your bank or payment provider:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>We will investigate the chargeback in accordance with payment network rules</li>
                <li>We may provide evidence to support the transaction</li>
                <li>If the chargeback is resolved in your favor, the refund will be processed accordingly</li>
                <li>Chargeback fees, if applicable, may be deducted from the refund amount</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Non-Refundable Items</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                The following are non-refundable:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Transaction processing fees and service charges</li>
                <li>Subscription fees for services already rendered</li>
                <li>Setup fees and onboarding charges</li>
                <li>Fees for services that have been successfully completed</li>
                <li>Any charges imposed by third-party service providers</li>
                <li>Fees for transactions that were completed as per your instructions</li>
              </ul>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Refund Timeline</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>8.1 Investigation Period:</strong> 15 business days from the date of refund request
              </p>
              <p className="text-gray-700 leading-relaxed mb-4">
                <strong>8.2 Processing Period:</strong> 5-10 business days after refund approval
              </p>
              <p className="text-gray-700 leading-relaxed">
                <strong>8.3 Total Timeline:</strong> Refunds are typically completed within 20-25 business days from the date of request, 
                subject to bank processing times.
              </p>
            </div>

            <div className="card mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Consumer Rights</h2>
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
              <h2 className="text-2xl font-bold text-gray-900 mb-4">10. Contact for Refunds</h2>
              <p className="text-gray-700 leading-relaxed mb-4">
                To request a refund or inquire about refund status, please contact:
              </p>
              <div className="bg-gray-50 p-6 rounded-lg">
                <p className="text-gray-700 mb-2"><strong>Refund Department</strong></p>
                <p className="text-gray-700 mb-2">Same Day Solution Pvt. Ltd.</p>
                <p className="text-gray-700 mb-2">Email: refunds@samedaysolution.in</p>
                <p className="text-gray-700 mb-2">Phone: +91-7090601025</p>
                <p className="text-gray-700">Address: TF-11B, 3rd Floor, Eros Metro Mall, Dwarka Sector-14, New Delhi-110078</p>
                <p className="text-gray-700 mt-4 text-sm">
                  <strong>Business Hours:</strong> Monday to Friday, 9:00 AM to 6:00 PM IST
                </p>
              </div>
            </div>

            <div className="card">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">11. Changes to Refund Policy</h2>
              <p className="text-gray-700 leading-relaxed">
                We reserve the right to modify this Refund Policy at any time. Changes will be effective immediately upon posting on this 
                page. Your continued use of our Services after any changes constitutes acceptance of the modified Policy.
              </p>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

