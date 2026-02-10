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
  
  // Use refs for values accessed inside the interval callback
  // This avoids putting them in the useEffect dependency array
  const showWarningRef = useRef(false)
  const isExpiredRef = useRef(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const logoutInProgressRef = useRef(false)

  // Keep refs in sync with state
  useEffect(() => { showWarningRef.current = showWarning }, [showWarning])
  useEffect(() => { isExpiredRef.current = isExpired }, [isExpired])

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(Math.max(0, seconds) / 60)
    const secs = Math.max(0, seconds) % 60
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

  // Handle logout - memoized with useCallback to avoid stale closures
  const handleLogout = useCallback(async () => {
    // Prevent double logout calls
    if (logoutInProgressRef.current) return
    logoutInProgressRef.current = true

    // Stop the timer immediately
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    try {
      // Clear session timer data
      localStorage.removeItem('sessionStartTime')
      localStorage.removeItem('sessionDuration')
      localStorage.removeItem('lastActivityTime')
      localStorage.removeItem('sessionExtended')
      
      // Clear auth cache
      localStorage.removeItem('auth_user')
      localStorage.removeItem('auth_user_timestamp')
      
      // Clear all Supabase related items from storage
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && (key.includes('supabase') || key.includes('sb-'))) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key))
      
      // Clear sessionStorage as well
      const sessionKeysToRemove: string[] = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)
        if (key && (key.includes('supabase') || key.includes('sb-'))) {
          sessionKeysToRemove.push(key)
        }
      }
      sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key))
      
      // Call logout to sign out from Supabase
      await logout()
      
      // Small delay to ensure state is cleared
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      // Force a hard redirect to ensure all state is cleared
      const redirectPath = userRole === 'admin' ? '/admin/login' : loginPath
      window.location.href = redirectPath
    }
  }, [logout, userRole, loginPath])

  // Reset session timer
  const resetSession = useCallback(() => {
    // Clear the old interval
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    setTimeRemaining(totalSessionTime)
    setShowWarning(false)
    setIsExpired(false)
    showWarningRef.current = false
    isExpiredRef.current = false
    logoutInProgressRef.current = false
    
    // Store session start time in localStorage (for SessionBadge sync)
    localStorage.setItem('sessionStartTime', Date.now().toString())
    localStorage.setItem('sessionDuration', totalSessionTime.toString())
  }, [totalSessionTime])

  // Handle stay signed in
  const handleStaySignedIn = useCallback(() => {
    resetSession()
    localStorage.setItem('sessionExtended', Date.now().toString())
  }, [resetSession])

  // Handle user activity (only updates last activity timestamp, doesn't reset timer)
  const handleActivity = useCallback(() => {
    if (!showWarningRef.current && !isExpiredRef.current) {
      localStorage.setItem('lastActivityTime', Date.now().toString())
    }
  }, [])

  // Initialize session from localStorage or start new
  useEffect(() => {
    const storedStartTime = localStorage.getItem('sessionStartTime')
    const storedDuration = localStorage.getItem('sessionDuration')
    
    if (storedStartTime && storedDuration) {
      const elapsed = Math.floor((Date.now() - parseInt(storedStartTime)) / 1000)
      const remaining = parseInt(storedDuration) - elapsed
      
      if (remaining > 0) {
        setTimeRemaining(remaining)
        // Check if we should already be showing the warning
        if (remaining <= warningTime) {
          setShowWarning(true)
          showWarningRef.current = true
        }
      } else {
        // Session already expired - logout immediately
        setTimeRemaining(0)
        setIsExpired(true)
        isExpiredRef.current = true
      }
    } else {
      // Start new session
      resetSession()
    }
  }, [resetSession, warningTime])

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

  // Main countdown timer - NO showWarning/isExpired in deps!
  // Uses refs to read those values inside the callback
  useEffect(() => {
    if (!user) return

    timerRef.current = setInterval(() => {
      // If already expired, stop ticking
      if (isExpiredRef.current) {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        return
      }

      setTimeRemaining(prev => {
        const newTime = prev - 1
        
        // Show warning popup at 30 seconds remaining
        if (newTime <= warningTime && newTime > 0 && !showWarningRef.current) {
          setShowWarning(true)
          showWarningRef.current = true
        }
        
        // Session expired - time reached 0
        if (newTime <= 0) {
          setIsExpired(true)
          isExpiredRef.current = true
          setShowWarning(false)
          showWarningRef.current = false
          
          // Stop the interval - no more ticks needed
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          
          return 0
        }
        
        return newTime
      })
    }, 1000)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [user, warningTime]) // Only depends on user and warningTime - NOT showWarning/isExpired

  // Auto logout when session expires
  // This fires when isExpired transitions from false → true
  useEffect(() => {
    if (isExpired && !logoutInProgressRef.current) {
      console.log('⏰ Session expired - auto logout in 2 seconds...')
      
      // Give 2 seconds to show the "Session Expired" modal, then force logout
      const logoutTimer = setTimeout(() => {
        console.log('⏰ Executing auto logout now!')
        handleLogout()
      }, 2000)
      
      // Safety net: if the timeout somehow doesn't fire, force logout after 5 seconds
      const safetyTimer = setTimeout(() => {
        if (!logoutInProgressRef.current) {
          console.log('⏰ Safety net: forcing logout!')
          const redirectPath = userRole === 'admin' ? '/admin/login' : loginPath
          window.location.href = redirectPath
        }
      }, 5000)
      
      return () => {
        clearTimeout(logoutTimer)
        clearTimeout(safetyTimer)
      }
    }
  }, [isExpired, handleLogout, userRole, loginPath])

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

      {/* Warning Modal - Shows at 30 seconds remaining */}
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

// Session Timer Badge Component (used in headers to display countdown)
// Reads from localStorage to stay in sync with SessionTimer
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
