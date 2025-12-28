import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'

export const metadata: Metadata = {
  title: 'FAQs - Frequently Asked Questions | Same Day Solution',
  description: 'Frequently asked questions about Same Day Solution fintech services, including AEPS, DMT, Bill Payments, and more.',
}

export default function FAQ() {
  const faqCategories = [
    {
      category: 'General',
      questions: [
        {
          q: 'What is Same Day Solution Pvt. Ltd.?',
          a: 'Same Day Solution Pvt. Ltd. is a leading fintech company providing comprehensive financial technology services including AEPS, DMT, Bill Payments, Mobile Recharge, and other digital payment solutions. We enable businesses to offer these services to their customers through our secure and reliable platform.',
        },
        {
          q: 'How do I get started with your services?',
          a: 'Getting started is easy! Simply register on our platform, complete the KYC verification process, and integrate our APIs. Our team will guide you through the entire onboarding process. Visit our "How It Works" page or contact our sales team for more information.',
        },
        {
          q: 'What services do you offer?',
          a: 'We offer a comprehensive range of fintech services including AEPS (Aadhaar Enabled Payment System), DMT (Domestic Money Transfer), Bill Payments, Mobile Recharge, KYC & Onboarding, and API integration services. Visit our Services page to learn more about each service.',
        },
        {
          q: 'Is your platform secure?',
          a: 'Yes, security is our top priority. We implement bank-level encryption, secure infrastructure, regular security audits, and comply with all applicable data protection laws in India. Please visit our Compliance & Security page for detailed information.',
        },
      ],
    },
    {
      category: 'AEPS Services',
      questions: [
        {
          q: 'What is AEPS?',
          a: 'AEPS (Aadhaar Enabled Payment System) is a bank-led model that allows online interoperable financial transactions at Point of Sale (PoS) and Micro ATMs through Aadhaar authentication. Customers can withdraw cash, check balance, and transfer money using just their Aadhaar number and biometric authentication.',
        },
        {
          q: 'What transactions can be performed through AEPS?',
          a: 'AEPS supports cash withdrawal, balance inquiry, Aadhaar to Aadhaar transfer, and mini statement generation. All transactions are authenticated using Aadhaar biometric verification.',
        },
        {
          q: 'Do customers need a debit card for AEPS?',
          a: 'No, customers do not need a debit card for AEPS transactions. They only need their Aadhaar number and biometric authentication (fingerprint or iris scan).',
        },
        {
          q: 'What are the transaction limits for AEPS?',
          a: 'Transaction limits vary based on the bank and account type. Generally, cash withdrawal limits range from ₹10,000 to ₹50,000 per transaction, subject to bank policies and regulatory guidelines.',
        },
      ],
    },
    {
      category: 'DMT Services',
      questions: [
        {
          q: 'What is DMT?',
          a: 'DMT (Domestic Money Transfer) is a service that allows you to transfer money from one bank account to another within India. We support multiple transfer methods including IMPS, NEFT, RTGS, and UPI.',
        },
        {
          q: 'How long does a money transfer take?',
          a: 'Transfer time depends on the method chosen: IMPS transfers are instant (within seconds), NEFT transfers are processed in batches (usually within 2 hours), RTGS is real-time for high-value transfers, and UPI transfers are instant.',
        },
        {
          q: 'What are the transaction fees for DMT?',
          a: 'Transaction fees vary based on the transfer method and amount. Please contact our sales team for detailed fee structure.',
        },
        {
          q: 'Can I transfer money to any bank in India?',
          a: 'Yes, our DMT services support transfers to all major banks in India. We have partnerships with multiple banks and payment networks to ensure wide coverage.',
        },
      ],
    },
    {
      category: 'Bill Payments',
      questions: [
        {
          q: 'Which bills can I pay through your platform?',
          a: 'You can pay various utility bills including electricity, water, gas, internet, DTH, insurance premiums, credit card bills, loan EMIs, and more. We support all major billers across India.',
        },
        {
          q: 'How do I pay bills?',
          a: 'Simply select the bill type, enter your customer ID or account number, verify the bill details, and make the payment. You can pay using various payment methods including UPI, cards, net banking, or wallets.',
        },
        {
          q: 'When will my bill payment be credited?',
          a: 'Most bill payments are credited instantly or within a few minutes. However, processing time may vary depending on the biller. You will receive a confirmation once the payment is processed.',
        },
        {
          q: 'Can I set up automatic bill payments?',
          a: 'Yes, we offer auto-pay functionality that allows you to set up automatic bill payments. You can schedule payments for recurring bills and never miss a due date.',
        },
      ],
    },
    {
      category: 'Mobile Recharge',
      questions: [
        {
          q: 'Which operators do you support for mobile recharge?',
          a: 'We support all major telecom operators in India including Airtel, Jio, Vodafone Idea, BSNL, and others. You can recharge prepaid, postpaid, DTH, and data cards.',
        },
        {
          q: 'How quickly is the recharge activated?',
          a: 'Prepaid recharges are typically activated instantly or within a few minutes. Postpaid bill payments are processed immediately and credited to your account.',
        },
        {
          q: 'What if my recharge fails?',
          a: 'If a recharge fails due to a technical error on our part, the amount will be refunded to your account within 5-7 business days. Please contact our support team with the transaction ID for assistance.',
        },
      ],
    },
    {
      category: 'Account & Billing',
      questions: [
        {
          q: 'How do I create an account?',
          a: 'You can create an account by registering on our website or through our merchant portal. You will need to provide business details, complete KYC verification, and submit required documents.',
        },
        {
          q: 'What documents are required for KYC?',
          a: 'KYC requirements vary based on your account type. Generally, you need identity proof (Aadhaar, PAN, or Passport), address proof, business registration documents (for merchants), and bank account details.',
        },
        {
          q: 'How are settlements processed?',
          a: 'Settlements are processed according to your merchant agreement. Standard settlement is T+1 (next business day), while premium plans may offer same-day or instant settlement. Settlement is made directly to your registered bank account.',
        },
        {
          q: 'What are the pricing plans?',
          a: 'We offer flexible pricing plans based on transaction volume and features required. Please contact our sales team for detailed pricing information tailored to your business needs.',
        },
      ],
    },
    {
      category: 'Technical Support',
      questions: [
        {
          q: 'How do I integrate your APIs?',
          a: 'Integration is straightforward. We provide comprehensive API documentation, SDKs for popular programming languages, and a sandbox environment for testing. Our technical support team is available to assist you throughout the integration process.',
        },
        {
          q: 'What is the API response time?',
          a: 'Our APIs are optimized for performance with average response times of less than 500ms. Response times may vary based on the type of transaction and network conditions.',
        },
        {
          q: 'Do you provide technical support?',
          a: 'Yes, we provide 24/7 technical support through email, phone, and our support portal. Premium and Enterprise plan customers get dedicated account managers and priority support.',
        },
        {
          q: 'Is there a sandbox environment for testing?',
          a: 'Yes, we provide a comprehensive sandbox environment where you can test all API functionalities before going live. This helps ensure smooth integration and reduces errors in production.',
        },
      ],
    },
  ]

  return (
    <div className="bg-white">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 to-secondary-50/30">
          <div className="max-w-7xl mx-auto">
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                Frequently Asked Questions
              </h1>
              <p className="text-lg text-gray-700 max-w-3xl mx-auto">
                Find answers to common questions about our fintech services
              </p>
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.2}>
        <section className="section-padding">
          <div className="max-w-5xl mx-auto">
            {faqCategories.map((category, catIndex) => (
              <AnimatedSection key={catIndex} delay={catIndex * 0.1}>
                <div className="mb-12">
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">{category.category}</h2>
                  <div className="space-y-4">
                    {category.questions.map((faq, faqIndex) => (
                      <AnimatedCard key={faqIndex} delay={faqIndex * 0.05}>
                        <div className="card">
                          <h3 className="text-xl font-bold text-gray-900 mb-3">{faq.q}</h3>
                          <p className="text-gray-700 leading-relaxed">{faq.a}</p>
                        </div>
                      </AnimatedCard>
                    ))}
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.3}>
        <section className="section-padding bg-gray-50">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Still Have Questions?
            </h2>
            <p className="text-lg text-gray-700 mb-8">
              Can't find the answer you're looking for? Our support team is here to help.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a href="/contact" className="btn-primary">
                Contact Support
              </a>
              <a href="/grievance" className="btn-secondary">
                File a Grievance
              </a>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

