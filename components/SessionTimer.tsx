'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { 
  Clock, AlertTriangle, LogOut, RefreshCw, 
  Shield, Timer, UserCheck, Activity
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
  userRole?: 'admin' | 'finance_executive' | 'retailer' | 'distributor' | 'master_distributor' | 'partner'
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
  
  const totalSessionTime = sessionDuration * 60
  
  const [timeRemaining, setTimeRemaining] = useState(totalSessionTime)
  const [showWarning, setShowWarning] = useState(false)
  const [isExpired, setIsExpired] = useState(false)
  
  const timeRemainingRef = useRef(totalSessionTime)
  const showWarningRef = useRef(false)
  const isExpiredRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logoutInProgressRef = useRef(false)
  const warningTimeRef = useRef(warningTime)
  const totalSessionTimeRef = useRef(totalSessionTime)
  
  useEffect(() => { warningTimeRef.current = warningTime }, [warningTime])
  useEffect(() => { totalSessionTimeRef.current = totalSessionTime }, [totalSessionTime])

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(Math.max(0, seconds) / 60)
    const secs = Math.max(0, seconds) % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const getTimeColor = (): string => {
    const ratio = timeRemaining / totalSessionTime
    if (ratio <= 0.05) return 'text-red-500'
    if (ratio <= 0.1) return 'text-orange-500'
    if (ratio <= 0.2) return 'text-yellow-500'
    return 'text-emerald-500'
  }

  const getBadgeColor = (): string => {
    const ratio = timeRemaining / totalSessionTime
    if (ratio <= 0.05) return 'from-red-500/20 to-red-600/20 border-red-500/50'
    if (ratio <= 0.1) return 'from-orange-500/20 to-orange-600/20 border-orange-500/50'
    if (ratio <= 0.2) return 'from-yellow-500/20 to-yellow-600/20 border-yellow-500/50'
    return 'from-emerald-500/20 to-emerald-600/20 border-emerald-500/50'
  }

  const handleLogout = useCallback(async () => {
    if (logoutInProgressRef.current) return
    logoutInProgressRef.current = true

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    try {
      localStorage.removeItem('sessionStartTime')
      localStorage.removeItem('sessionDuration')
      localStorage.removeItem('lastActivityTime')
      localStorage.removeItem('sessionExtended')
      localStorage.removeItem('auth_user')
      localStorage.removeItem('auth_user_timestamp')
      
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && (key.includes('supabase') || key.includes('sb-'))) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key))
      
      const sessionKeysToRemove: string[] = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)
        if (key && (key.includes('supabase') || key.includes('sb-'))) {
          sessionKeysToRemove.push(key)
        }
      }
      sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key))
      
      await logout()
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      const basePath =
        userRole === 'admin'
          ? '/admin/login'
          : userRole === 'finance_executive'
            ? '/finance-same/login'
            : loginPath
      window.location.href = `${basePath}?session=expired`
    }
  }, [logout, userRole, loginPath])

  const handleLogoutRef = useRef(handleLogout)
  useEffect(() => { handleLogoutRef.current = handleLogout }, [handleLogout])

  const resetSession = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    timeRemainingRef.current = totalSessionTime
    showWarningRef.current = false
    isExpiredRef.current = false
    logoutInProgressRef.current = false
    
    setTimeRemaining(totalSessionTime)
    setShowWarning(false)
    setIsExpired(false)
    
    localStorage.setItem('sessionStartTime', Date.now().toString())
    localStorage.setItem('sessionDuration', totalSessionTime.toString())
  }, [totalSessionTime])

  const handleStaySignedIn = useCallback(() => {
    resetSession()
    localStorage.setItem('sessionExtended', Date.now().toString())
    localStorage.setItem('lastActivityTime', Date.now().toString())
  }, [resetSession])

  // Inactivity-based: reset timer on user activity (unless warning is showing)
  const handleActivity = useCallback(() => {
    if (!showWarningRef.current && !isExpiredRef.current) {
      timeRemainingRef.current = totalSessionTimeRef.current
      setTimeRemaining(totalSessionTimeRef.current)
      localStorage.setItem('sessionStartTime', Date.now().toString())
      localStorage.setItem('lastActivityTime', Date.now().toString())
    }
  }, [])

  // Initialize session: always use the prop-based duration (not stored value)
  // to prevent cross-role leakage when admin/retailer share the same browser
  useEffect(() => {
    const storedStartTime = localStorage.getItem('sessionStartTime')
    const storedDuration = localStorage.getItem('sessionDuration')
    
    const durationMismatch = storedDuration && parseInt(storedDuration) !== totalSessionTime

    if (storedStartTime && !durationMismatch) {
      const elapsed = Math.floor((Date.now() - parseInt(storedStartTime)) / 1000)
      const remaining = Math.max(0, totalSessionTime - elapsed)
      
      if (remaining > 0) {
        timeRemainingRef.current = remaining
        setTimeRemaining(remaining)
        
        if (remaining <= warningTime) {
          showWarningRef.current = true
          setShowWarning(true)
        }
      } else {
        timeRemainingRef.current = 0
        isExpiredRef.current = true
        setTimeRemaining(0)
        setIsExpired(true)
      }
    } else {
      resetSession()
    }
  }, [resetSession, warningTime, totalSessionTime])

  // Activity listeners - throttled to every 5 seconds
  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']
    
    let lastUpdate = 0
    const throttledHandler = () => {
      const now = Date.now()
      if (now - lastUpdate > 5000) {
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
      if (isExpiredRef.current) {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        return
      }

      timeRemainingRef.current = Math.max(0, timeRemainingRef.current - 1)
      const currentTime = timeRemainingRef.current

      setTimeRemaining(currentTime)

      if (currentTime <= warningTimeRef.current && currentTime > 0 && !showWarningRef.current) {
        showWarningRef.current = true
        setShowWarning(true)
      }

      if (currentTime <= 0) {
        isExpiredRef.current = true
        showWarningRef.current = false
        setIsExpired(true)
        setShowWarning(false)

        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }

        if (!logoutInProgressRef.current) {
          handleLogoutRef.current()
        }
      }
    }, 1000)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [user])

  // Safety net for auto-logout
  useEffect(() => {
    if (isExpired && !logoutInProgressRef.current) {
      handleLogoutRef.current()
      
      const safetyTimer = setTimeout(() => {
        if (!logoutInProgressRef.current) {
          localStorage.removeItem('auth_user')
          localStorage.removeItem('auth_user_timestamp')
          localStorage.removeItem('sessionStartTime')
          localStorage.removeItem('sessionDuration')
          const basePath =
            userRole === 'admin'
              ? '/admin/login'
              : userRole === 'finance_executive'
                ? '/finance-same/login'
                : loginPath
          window.location.href = `${basePath}?session=expired`
        }
      }, 3000)
      
      return () => clearTimeout(safetyTimer)
    }
  }, [isExpired, userRole, loginPath])

  if (!user) return null

  const warningProgress = showWarning ? (timeRemaining / warningTime) * 100 : 100

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
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-6 text-white relative overflow-hidden">
                {/* Progress bar showing time left */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                  <motion.div
                    className="h-full bg-white/80"
                    initial={{ width: '100%' }}
                    animate={{ width: `${warningProgress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                    <AlertTriangle className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Are you still there?</h2>
                    <p className="text-amber-100 text-sm">Your session is about to end</p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6">
                {/* Countdown */}
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-red-500/20 to-orange-500/20 border-4 border-red-500 mb-4 relative">
                    {/* Circular progress */}
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="4" className="text-gray-200 dark:text-gray-700" />
                      <circle
                        cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="4"
                        className="text-red-500"
                        strokeDasharray={`${2 * Math.PI * 44}`}
                        strokeDashoffset={`${2 * Math.PI * 44 * (1 - timeRemaining / warningTime)}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="text-3xl font-bold font-mono text-red-500 relative z-10">
                      {timeRemaining}
                    </span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-400">
                    You&apos;ll be logged out in <span className="font-bold text-red-500">{timeRemaining} seconds</span>
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    due to {sessionDuration} minutes of inactivity
                  </p>
                </div>

                {/* Security Notice */}
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 mb-6">
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      For your security, inactive sessions are ended automatically to protect your data.
                    </p>
                  </div>
                </div>

                {/* Actions */}
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
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-emerald-500/30 transition-all active:scale-[0.98]"
                  >
                    <RefreshCw className="w-5 h-5" />
                    Continue Session
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
              <div className="bg-gradient-to-r from-red-500 to-rose-600 p-6 text-white">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                    <Clock className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Session Ended</h2>
                    <p className="text-red-100 text-sm">Redirecting to login...</p>
                  </div>
                </div>
              </div>

              <div className="p-6 text-center">
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <LogOut className="w-10 h-10 text-red-500" />
                </div>
                <p className="text-gray-600 dark:text-gray-400 mb-2">
                  Your session ended due to inactivity.
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
                  Please log in again to continue using the platform.
                </p>
                <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
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
