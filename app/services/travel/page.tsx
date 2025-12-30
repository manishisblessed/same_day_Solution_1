import type { Metadata } from 'next'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Travel Services - Ticket Booking & Travel Solutions | Same Day Solution',
  description: 'Make your shop the travel hub of your area. Offer bus tickets, flight bookings, and hotel reservations.',
}

export default function TravelServices() {
  const services = [
    {
      title: 'Bus Tickets',
      description: 'Book bus tickets for intercity and interstate travel through various bus operators.',
      icon: '🚌',
    },
    {
      title: 'Flight Bookings',
      description: 'Help customers book domestic and international flight tickets with multiple airlines.',
      icon: '✈️',
    },
    {
      title: 'Hotel Reservations',
      description: 'Book hotel rooms and accommodations for customers traveling to different cities.',
      icon: '🏨',
    },
  ]

  const benefits = [
    {
      title: 'Increased Footfall',
      description: 'Attract more customers to your shop by offering convenient travel booking services.',
    },
    {
      title: 'Commission Earnings',
      description: 'Earn commissions on every booking, creating an additional revenue stream.',
    },
    {
      title: 'Customer Convenience',
      description: 'Save customers time and effort by providing travel services at their doorstep.',
    },
    {
      title: 'Comprehensive Service',
      description: 'Offer complete travel solutions including tickets, hotels, and travel packages.',
    },
  ]

  return (
    <div className="bg-white">
      {/* Breadcrumb Navigation */}
      <AnimatedSection>
        <section className="section-padding bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto">
            <nav className="flex items-center space-x-2 text-sm">
              <Link href="/" className="text-gray-600 hover:text-primary-600 transition-colors">Home</Link>
              <span className="text-gray-400">/</span>
              <Link href="/services" className="text-gray-600 hover:text-primary-600 transition-colors">Services</Link>
              <span className="text-gray-400">/</span>
              <span className="text-gray-900 font-medium">Travel Services</span>
            </nav>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Travel Services
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Your Area's Travel Hub
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Make your shop the travel hub of your area. Now customers do not need to travel to a travel agency 
                for ticket bookings. You can offer bus tickets, flight bookings, and hotel reservations right from your shop.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-primary">
                  Start Travel Services
                </Link>
                <Link href="/partner" className="btn-secondary">
                  Become a Partner
                </Link>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.2}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
                  Transform Your Shop into a Travel Hub
                </h2>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  With our travel services, you can offer comprehensive travel booking solutions to your customers. 
                  From bus tickets to flight bookings and hotel reservations - everything is available 
                  at your shop.
                </p>
                <p className="text-lg text-gray-700 mb-4 leading-relaxed">
                  Your customers no longer need to visit bus terminals or travel agencies. 
                  They can book all their travel needs from your convenient location, saving time and effort.
                </p>
                <p className="text-lg text-gray-700 leading-relaxed">
                  This service not only increases footfall to your shop but also provides you with additional 
                  revenue through booking commissions.
                </p>
              </div>
              <div className="bg-gradient-to-br from-primary-100 to-secondary-100 rounded-2xl p-8 lg:p-12">
                <div className="text-center">
                  <div className="text-7xl mb-6">✈️</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">Complete Travel Solutions</h3>
                  <p className="text-gray-700 mb-6">
                    Offer bus tickets, flight bookings, and hotel reservations - all from your shop. 
                    Become the go-to travel booking center in your area.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-bold text-primary-600">All</div>
                      <div className="text-sm text-gray-600">Travel Needs</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-secondary-600">Easy</div>
                      <div className="text-sm text-gray-600">Booking</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.3}>
        <section className="section-padding bg-gray-50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Travel Services Available
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {services.map((service, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card text-center h-full">
                    <div className="text-5xl mb-4">{service.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{service.title}</h3>
                    <p className="text-gray-600">{service.description}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.4}>
        <section className="section-padding bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Benefits for Your Business
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {benefits.map((benefit, index) => (
                <AnimatedCard key={index} delay={index * 0.1}>
                  <div className="card">
                    <h3 className="text-2xl font-bold text-gray-900 mb-3">{benefit.title}</h3>
                    <p className="text-gray-700 leading-relaxed">{benefit.description}</p>
                  </div>
                </AnimatedCard>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.5}>
        <section className="section-padding bg-gradient-to-r from-primary-600 to-secondary-600">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
              Start Offering Travel Services
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Transform your shop into a travel hub and start earning from travel bookings.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/contact" className="bg-white text-primary-600 px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-all duration-300 shadow-lg">
                Contact Us
              </Link>
              <Link href="/partner" className="bg-transparent border-2 border-white text-white px-8 py-3 rounded-lg font-semibold hover:bg-white/10 transition-all duration-300">
                Become a Partner
              </Link>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

