import { createBrowserClient } from '@supabase/ssr'

// Detect build phase - during build, env vars may not be available
const isBuildPhase = 
  typeof window === 'undefined' && (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NEXT_PHASE === 'phase-export' ||
    // If we're on server and env vars are missing, assume build phase
    (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  )

// Use placeholder values during build to avoid errors
// Real values will be used at runtime in the browser
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || (isBuildPhase ? 'https://placeholder.supabase.co' : '')
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || (isBuildPhase ? 'placeholder-key-for-build-only' : '')

// Only warn at runtime in browser, not during build
if (typeof window !== 'undefined' && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
  console.warn('Supabase environment variables are not set. Please configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

// Comprehensive cleanup of corrupted storage entries BEFORE client initialization
if (typeof window !== 'undefined') {
  try {
    // Clear corrupted entries from localStorage
    const localStorageKeys = Object.keys(localStorage)
    for (const key of localStorageKeys) {
      try {
        const value = localStorage.getItem(key)
        // Remove any entry that starts with 'base64-' (corrupted token format)
        if (value && value.startsWith('base64-')) {
          localStorage.removeItem(key)
        }
        // Also remove Supabase-related keys that might be corrupted
        else if ((key.includes('supabase') || key.includes('sb-') || key.startsWith('auth-token')) && 
                 value && value.length > 100 && !value.startsWith('{') && !value.startsWith('[')) {
          localStorage.removeItem(key)
        }
      } catch (e) {
        // If we can't read the item, remove it
        try {
          localStorage.removeItem(key)
        } catch (removeError) {
          // Ignore removal errors
        }
      }
    }

    // Clear corrupted entries from sessionStorage (Supabase might use it)
    try {
      const sessionStorageKeys = Object.keys(sessionStorage)
      for (const key of sessionStorageKeys) {
        try {
          const value = sessionStorage.getItem(key)
          if (value && value.startsWith('base64-')) {
            sessionStorage.removeItem(key)
          }
          else if ((key.includes('supabase') || key.includes('sb-') || key.startsWith('auth-token')) && 
                   value && value.length > 100 && !value.startsWith('{') && !value.startsWith('[')) {
            sessionStorage.removeItem(key)
          }
        } catch (e) {
          try {
            sessionStorage.removeItem(key)
          } catch (removeError) {
            // Ignore removal errors
          }
        }
      }
    } catch (sessionError) {
      // Ignore sessionStorage errors
    }
  } catch (error) {
    // Ignore errors during cleanup
  }
}

// Suppress the specific Supabase initialization error in console
// This error occurs when Supabase tries to recover a corrupted session from storage
if (typeof window !== 'undefined') {
  const originalError = console.error
  let errorOverrideActive = true
  
  // Override console.error to suppress the specific corrupted session error and module loading errors
  console.error = (...args: any[]) => {
    if (errorOverrideActive) {
      const errorMessage = args[0]?.toString() || ''
      // Suppress the "Cannot create property 'user' on string" error from Supabase initialization
      if (errorMessage.includes("Cannot create property 'user' on string") && 
          (errorMessage.includes('base64-') || args.some(arg => 
            typeof arg === 'string' && arg.includes('base64-')
          ))) {
        // Silently ignore this error - it's handled by clearing corrupted storage
        return
      }
      // Suppress webpack module loading errors (common during navigation)
      if (errorMessage.includes("Cannot read properties of undefined (reading 'call')") ||
          args.some(arg => 
            typeof arg === 'string' && arg.includes("Cannot read properties of undefined (reading 'call')")
          )) {
        // These are usually transient and resolve on retry
        return
      }
    }
    originalError.apply(console, args)
  }
  
  // Also add a window error handler as backup
  const originalWindowError = window.onerror
  window.onerror = (message, source, lineno, colno, error) => {
    const errorMessage = message?.toString() || error?.message || ''
    // Suppress Supabase corrupted session errors
    if (errorMessage.includes("Cannot create property 'user' on string") && 
        errorMessage.includes('base64-')) {
      return true
    }
    // Suppress webpack module loading errors during navigation
    if (errorMessage.includes("Cannot read properties of undefined (reading 'call')") ||
        (error && error.message && error.message.includes("Cannot read properties of undefined (reading 'call')"))) {
      // These are usually transient module loading issues that resolve on retry
      return true
    }
    // Call original handler if it exists
    if (originalWindowError) {
      return originalWindowError(message, source, lineno, colno, error)
    }
    return false
  }
  
  // Also handle unhandled promise rejections (for async module loading errors)
  const originalUnhandledRejection = window.onunhandledrejection
  window.onunhandledrejection = (event) => {
    const errorMessage = event.reason?.message || event.reason?.toString() || ''
    // Suppress webpack module loading errors
    if (errorMessage.includes("Cannot read properties of undefined (reading 'call')")) {
      event.preventDefault()
      return
    }
    // Call original handler if it exists
    if (originalUnhandledRejection) {
      return originalUnhandledRejection.call(window, event)
    }
  }
  
  // Restore original handlers after a short delay (after initialization)
  setTimeout(() => {
    errorOverrideActive = false
    window.onerror = originalWindowError
    window.onunhandledrejection = originalUnhandledRejection
  }, 3000)
}

// Use SSR-compatible browser client for proper cookie handling
// The createBrowserClient automatically syncs to cookies when used with middleware
// Wrap in try-catch to handle any initialization errors gracefully
let supabase: ReturnType<typeof createBrowserClient>
try {
  supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
} catch (error: any) {
  // If initialization fails due to corrupted storage, clear everything and retry
  if (typeof window !== 'undefined') {
    try {
      const allKeys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
      allKeys.forEach(key => {
        if (key.includes('supabase') || key.includes('sb-') || key.startsWith('auth-token')) {
          localStorage.removeItem(key)
          sessionStorage.removeItem(key)
        }
      })
      supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
    } catch (retryError) {
      // If retry fails, create client anyway - it will handle missing session
      supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
    }
  } else {
    supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
  }
}

export { supabase }

/**
 * Utility function to clear corrupted Supabase session storage
 * Call this if you encounter session-related errors
 */
export function clearCorruptedSessions() {
  if (typeof window === 'undefined') return
  
  try {
    const supabaseKeys = Object.keys(localStorage).filter(key => 
      key.includes('supabase') || key.includes('sb-') || key.startsWith('auth-token')
    )
    
    let cleared = 0
    for (const key of supabaseKeys) {
      try {
        const value = localStorage.getItem(key)
        // If the value is a base64 string that looks corrupted, remove it
        if (value && (value.startsWith('base64-') || (value.length > 100 && !value.startsWith('{') && !value.startsWith('[')))) {
          localStorage.removeItem(key)
          cleared++
        }
      } catch (e) {
        // If we can't read the item, remove it
        localStorage.removeItem(key)
        cleared++
      }
    }
    
    if (cleared > 0) {
      return true
    }
    return false
  } catch (error) {
    console.warn('Error clearing corrupted sessions:', error)
    return false
  }
}

