'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { 
  Clock, AlertTriangle, LogOut, RefreshCw, 
  Shield, Timer, UserCheck
} from 'lucide-react'

interface SessionTimerProps {
  /** Session duration in minutes (default: 10) */
  sessionDuration?: number
  /** Warning time before expiry in seconds (default: 30) */
  warningTime?: number
  /** Show the timer badge on screen */
  showBadge?: boolean
  /** Login redirect path based on role */
  loginPath?: string
  /** User role for display purposes */
  userRole?: 'admin' | 'retailer' | 'distributor' | 'master_distributor'
}

export default function SessionTimer({
  sessionDuration = 10,
  warningTime = 30,
  showBadge = true,
  loginPath = '/business-login',
  userRole = 'retailer'
}: SessionTimerProps) {
  const router = useRouter()
  const { logout, user } = useAuth()
  
  // Total session time in seconds
  const totalSessionTime = sessionDuration * 60
  
  const [timeRemaining, setTimeRemaining] = useState(totalSessionTime)
  const [showWarning, setShowWarning] = useState(false)
  const [isExpired, setIsExpired] = useState(false)
  const [lastActivity, setLastActivity] = useState(Date.now())
  
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // Get time color based on remaining time
  const getTimeColor = (): string => {
    if (timeRemaining <= 30) return 'text-red-500'
    if (timeRemaining <= 60) return 'text-orange-500'
    if (timeRemaining <= 120) return 'text-yellow-500'
    return 'text-emerald-500'
  }

  // Get background color for badge
  const getBadgeColor = (): string => {
    if (timeRemaining <= 30) return 'from-red-500/20 to-red-600/20 border-red-500/50'
    if (timeRemaining <= 60) return 'from-orange-500/20 to-orange-600/20 border-orange-500/50'
    if (timeRemaining <= 120) return 'from-yellow-500/20 to-yellow-600/20 border-yellow-500/50'
    return 'from-emerald-500/20 to-emerald-600/20 border-emerald-500/50'
  }

  // Reset session timer
  const resetSession = useCallback(() => {
    setTimeRemaining(totalSessionTime)
    setShowWarning(false)
    setIsExpired(false)
    setLastActivity(Date.now())
    
    // Store session start time in localStorage
    localStorage.setItem('sessionStartTime', Date.now().toString())
    localStorage.setItem('sessionDuration', totalSessionTime.toString())
  }, [totalSessionTime])

  // Handle user activity
  const handleActivity = useCallback(() => {
    // Only reset if warning is not showing (don't reset during warning period)
    if (!showWarning && !isExpired) {
      setLastActivity(Date.now())
      // Update localStorage
      localStorage.setItem('lastActivityTime', Date.now().toString())
    }
  }, [showWarning, isExpired])

  // Handle stay signed in
  const handleStaySignedIn = () => {
    resetSession()
    // Store the new session
    localStorage.setItem('sessionExtended', Date.now().toString())
  }

  // Handle logout
  const handleLogout = async () => {
    try {
      // Clear session data
      localStorage.removeItem('sessionStartTime')
      localStorage.removeItem('sessionDuration')
      localStorage.removeItem('lastActivityTime')
      localStorage.removeItem('sessionExtended')
      
      await logout()
      
      // Redirect based on role
      if (userRole === 'admin') {
        router.push('/admin/login')
      } else {
        router.push(loginPath)
      }
    } catch (error) {
      console.error('Logout error:', error)
      // Force redirect anyway
      window.location.href = userRole === 'admin' ? '/admin/login' : loginPath
    }
  }

  // Initialize session from localStorage or start new
  useEffect(() => {
    const storedStartTime = localStorage.getItem('sessionStartTime')
    const storedDuration = localStorage.getItem('sessionDuration')
    
    if (storedStartTime && storedDuration) {
      const elapsed = Math.floor((Date.now() - parseInt(storedStartTime)) / 1000)
      const remaining = parseInt(storedDuration) - elapsed
      
      if (remaining > 0) {
        setTimeRemaining(remaining)
      } else {
        // Session already expired
        setTimeRemaining(0)
        setIsExpired(true)
      }
    } else {
      // Start new session
      resetSession()
    }
  }, [resetSession])

  // Activity listeners
  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']
    
    // Throttle activity handler to prevent too many updates
    let lastUpdate = 0
    const throttledHandler = () => {
      const now = Date.now()
      if (now - lastUpdate > 5000) { // Update at most every 5 seconds
        lastUpdate = now
        handleActivity()
      }
    }

    events.forEach(event => {
      document.addEventListener(event, throttledHandler, { passive: true })
    })

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, throttledHandler)
      })
    }
  }, [handleActivity])

  // Main countdown timer
  useEffect(() => {
    if (!user) return

    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        const newTime = prev - 1
        
        // Show warning at 30 seconds
        if (newTime === warningTime && !showWarning) {
          setShowWarning(true)
        }
        
        // Session expired
        if (newTime <= 0) {
          setIsExpired(true)
          setShowWarning(false)
          return 0
        }
        
        return newTime
      })
    }, 1000)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [user, warningTime, showWarning])

  // Auto logout when session expires
  useEffect(() => {
    if (isExpired) {
      // Wait a moment to show the expired message, then logout
      const logoutTimer = setTimeout(() => {
        handleLogout()
      }, 2000)
      
      return () => clearTimeout(logoutTimer)
    }
  }, [isExpired])

  // Don't render if no user
  if (!user) return null

  return (
    <>
      {/* Session Timer Badge */}
      {showBadge && !showWarning && !isExpired && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`fixed bottom-4 right-4 z-40 bg-gradient-to-r ${getBadgeColor()} backdrop-blur-xl rounded-xl px-4 py-2 border shadow-lg`}
        >
          <div className="flex items-center gap-2">
            <Timer className={`w-4 h-4 ${getTimeColor()}`} />
            <span className={`font-mono font-bold text-sm ${getTimeColor()}`}>
              {formatTime(timeRemaining)}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">
              Session
            </span>
          </div>
        </motion.div>
      )}

      {/* Warning Modal */}
      <AnimatePresence>
        {showWarning && !isExpired && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              {/* Header with gradient */}
              <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-6 text-white">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                    <AlertTriangle className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Session Expiring Soon!</h2>
                    <p className="text-amber-100 text-sm">Your session is about to end</p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6">
                {/* Countdown Display */}
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-red-500/20 to-orange-500/20 border-4 border-red-500 mb-4">
                    <span className="text-3xl font-bold font-mono text-red-500">
                      {formatTime(timeRemaining)}
                    </span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-400">
                    Your session will expire in <span className="font-bold text-red-500">{timeRemaining}</span> seconds.
                  </p>
                </div>

                {/* Security Notice */}
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 mb-6">
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        Security Notice
                      </p>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        For your security, we automatically end inactive sessions after {sessionDuration} minutes 
                        to protect your financial data.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={handleLogout}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
                  >
                    <LogOut className="w-5 h-5" />
                    Log Out
                  </button>
                  <button
                    onClick={handleStaySignedIn}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-emerald-500/30 transition-all"
                  >
                    <RefreshCw className="w-5 h-5" />
                    Stay Signed In
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Session Expired Modal */}
      <AnimatePresence>
        {isExpired && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              {/* Header with gradient */}
              <div className="bg-gradient-to-r from-red-500 to-rose-600 p-6 text-white">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                    <Clock className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Session Expired</h2>
                    <p className="text-red-100 text-sm">Please log in again to continue</p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 text-center">
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <LogOut className="w-10 h-10 text-red-500" />
                </div>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  Your session has expired due to inactivity. You will be redirected to the login page.
                </p>
                <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                  Redirecting...
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// Session Timer Badge Component (can be used separately in headers)
export function SessionBadge() {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)

  useEffect(() => {
    const checkSession = () => {
      const startTime = localStorage.getItem('sessionStartTime')
      const duration = localStorage.getItem('sessionDuration')
      
      if (startTime && duration) {
        const elapsed = Math.floor((Date.now() - parseInt(startTime)) / 1000)
        const remaining = parseInt(duration) - elapsed
        setTimeRemaining(remaining > 0 ? remaining : 0)
      }
    }

    checkSession()
    const interval = setInterval(checkSession, 1000)
    return () => clearInterval(interval)
  }, [])

  if (timeRemaining === null) return null

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const getColor = () => {
    if (timeRemaining <= 30) return 'text-red-500 bg-red-500/10'
    if (timeRemaining <= 60) return 'text-orange-500 bg-orange-500/10'
    return 'text-emerald-500 bg-emerald-500/10'
  }

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${getColor()}`}>
      <Timer className="w-3.5 h-3.5" />
      <span className="font-mono text-xs font-semibold">{formatTime(timeRemaining)}</span>
    </div>
  )
}

