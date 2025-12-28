'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [servicesOpen, setServicesOpen] = useState(false)

  return (
    <header className="bg-white shadow-md border-b border-gray-200 sticky top-0 z-50">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-3">
            <Image
              src="/LOGO_Same_Day.jpeg"
              alt="Same Day Solution Pvt. Ltd."
              width={60}
              height={60}
              className="object-contain"
            />
            <div className="hidden sm:block">
              <h1 className="text-xl font-bold text-gray-900">Same Day Solution</h1>
              <p className="text-xs text-gray-600">Pvt. Ltd.</p>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <Link href="/" className="text-gray-700 hover:text-primary-600 font-medium transition-colors">
              Home
            </Link>
            <Link href="/about" className="text-gray-700 hover:text-primary-600 font-medium transition-colors">
              About Us
            </Link>
            <div 
              className="relative"
              onMouseEnter={() => setServicesOpen(true)}
              onMouseLeave={() => setServicesOpen(false)}
            >
              <button className="text-gray-700 hover:text-primary-600 font-medium transition-colors flex items-center">
                Services
                <svg className="ml-1 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <AnimatePresence>
                {servicesOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.2 }}
                    className="absolute top-full left-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50"
                  >
                    <Link href="/services" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      All Services
                    </Link>
                    <Link href="/services/banking-payments" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      Banking & Payments
                    </Link>
                    <Link href="/services/mini-atm" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      Mini-ATM Services
                    </Link>
                    <Link href="/services/aeps" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      AEPS Services
                    </Link>
                    <Link href="/services/merchant-payments" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      Merchant Payments (Aadhaar Pay)
                    </Link>
                    <Link href="/services/dmt" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      DMT (Money Transfer)
                    </Link>
                    <Link href="/services/doorstep-banking" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      Doorstep Banking (BC-Sakhi)
                    </Link>
                    <Link href="/services/bill-payments" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      Bill Payments
                    </Link>
                    <Link href="/services/recharge" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      Mobile Recharge
                    </Link>
                    <Link href="/services/travel" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      Travel Services
                    </Link>
                    <Link href="/services/cash-management" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      Cash Management
                    </Link>
                    <Link href="/services/government" className="block px-4 py-2 text-gray-700 hover:bg-primary-50 hover:text-primary-600 transition-colors">
                      Government Services
                    </Link>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <Link href="/contact" className="text-gray-700 hover:text-primary-600 font-medium transition-colors">
              Contact Us
            </Link>
            <Link href="/business-login" className="bg-gradient-to-r from-primary-500 via-primary-600 to-primary-700 text-white px-5 py-2.5 rounded-lg font-semibold hover:from-primary-600 hover:via-primary-700 hover:to-primary-800 transition-all duration-300 shadow-md hover:shadow-lg transform hover:-translate-y-0.5">
              Business Login
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 rounded-md text-gray-700 hover:bg-gray-100"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {isMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden py-4 space-y-4 overflow-hidden"
            >
              <Link href="/" className="block text-gray-700 hover:text-primary-600 font-medium">
                Home
              </Link>
              <Link href="/about" className="block text-gray-700 hover:text-primary-600 font-medium">
                About Us
              </Link>
              <div>
                <button 
                  onClick={() => setServicesOpen(!servicesOpen)}
                  className="flex items-center justify-between w-full text-gray-700 hover:text-primary-600 font-medium"
                >
                  Services
                  <svg className={`w-4 h-4 transition-transform ${servicesOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {servicesOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="pl-4 mt-2 space-y-2"
                  >
                    <Link href="/services" className="block text-gray-600 hover:text-primary-600 text-sm">All Services</Link>
                    <Link href="/services/banking-payments" className="block text-gray-600 hover:text-primary-600 text-sm">Banking & Payments</Link>
                    <Link href="/services/mini-atm" className="block text-gray-600 hover:text-primary-600 text-sm">Mini-ATM</Link>
                    <Link href="/services/aeps" className="block text-gray-600 hover:text-primary-600 text-sm">AEPS</Link>
                    <Link href="/services/merchant-payments" className="block text-gray-600 hover:text-primary-600 text-sm">Aadhaar Pay</Link>
                    <Link href="/services/dmt" className="block text-gray-600 hover:text-primary-600 text-sm">DMT</Link>
                    <Link href="/services/doorstep-banking" className="block text-gray-600 hover:text-primary-600 text-sm">Doorstep Banking</Link>
                    <Link href="/services/bill-payments" className="block text-gray-600 hover:text-primary-600 text-sm">Bill Payments</Link>
                    <Link href="/services/recharge" className="block text-gray-600 hover:text-primary-600 text-sm">Recharge</Link>
                    <Link href="/services/travel" className="block text-gray-600 hover:text-primary-600 text-sm">Travel</Link>
                    <Link href="/services/cash-management" className="block text-gray-600 hover:text-primary-600 text-sm">Cash Management</Link>
                    <Link href="/services/government" className="block text-gray-600 hover:text-primary-600 text-sm">Government</Link>
                  </motion.div>
                )}
              </div>
              <Link href="/contact" className="block text-gray-700 hover:text-primary-600 font-medium">
                Contact Us
              </Link>
              <Link href="/business-login" className="block bg-gradient-to-r from-primary-500 to-primary-600 text-white px-5 py-2.5 rounded-lg font-semibold text-center hover:from-primary-600 hover:to-primary-700 transition-all duration-300 shadow-md">
                Business Login
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </header>
  )
}

