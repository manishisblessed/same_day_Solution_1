'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const closeMenu = () => {
    setIsMenuOpen(false)
  }

  return (
    <header className="bg-white shadow-md border-b border-gray-200 sticky top-0 z-50">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          {/* Logo */}
          <Link href="/" onClick={closeMenu} className="flex items-center space-x-3">
            <Image
              src="/LOGO_Same_Day.jpeg"
              alt="Same Day Solution Pvt. Ltd."
              width={52}
              height={52}
              className="object-contain w-[52px] h-[52px]"
              unoptimized
              priority
            />
            <div className="hidden sm:block">
              <h1 className="text-base sm:text-lg md:text-lg lg:text-2xl font-bold text-gray-900">Same Day Solution</h1>
              <p className="text-[10px] sm:text-[11px] md:text-xs lg:text-sm text-gray-600">Pvt. Ltd.</p>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-3 md:space-x-4 lg:space-x-8">
            <Link href="/" className="text-sm md:text-sm lg:text-base text-gray-700 hover:text-primary-600 font-medium transition-colors">
              Home
            </Link>
            <Link href="/about" className="text-sm md:text-sm lg:text-base text-gray-700 hover:text-primary-600 font-medium transition-colors">
              About Us
            </Link>
            <Link href="/services" className="text-sm md:text-sm lg:text-base text-gray-700 hover:text-primary-600 font-medium transition-colors">
              Services
            </Link>
            <Link href="/contact" className="text-sm md:text-sm lg:text-base text-gray-700 hover:text-primary-600 font-medium transition-colors">
              Contact Us
            </Link>
            <Link href="/business-login" className="bg-gradient-to-r from-primary-500 via-primary-600 to-primary-700 text-white px-3 md:px-3 lg:px-5 py-1.5 md:py-1.5 lg:py-2.5 rounded-lg text-xs md:text-xs lg:text-base font-semibold hover:from-primary-600 hover:via-primary-700 hover:to-primary-800 transition-all duration-300 shadow-md hover:shadow-lg transform hover:-translate-y-0.5">
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
              <Link href="/" onClick={closeMenu} className="block text-gray-700 hover:text-primary-600 font-medium">
                Home
              </Link>
              <Link href="/about" onClick={closeMenu} className="block text-gray-700 hover:text-primary-600 font-medium">
                About Us
              </Link>
              <Link href="/services" onClick={closeMenu} className="block text-gray-700 hover:text-primary-600 font-medium">
                Services
              </Link>
              <Link href="/contact" onClick={closeMenu} className="block text-gray-700 hover:text-primary-600 font-medium">
                Contact Us
              </Link>
              <Link href="/business-login" onClick={closeMenu} className="block bg-gradient-to-r from-primary-500 to-primary-600 text-white px-5 py-2.5 rounded-lg font-semibold text-center hover:from-primary-600 hover:to-primary-700 transition-all duration-300 shadow-md">
                Business Login
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </header>
  )
}

