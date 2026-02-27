'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface GeoLocation {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
  source: 'gps' | 'network' | 'unknown'
}

export interface GeoLocationError {
  code: number
  message: string
}

const GEO_CACHE_KEY = 'geo_location_cache'
const GEO_CACHE_MAX_AGE = 60_000 // 1 minute

function classifySource(accuracy: number): 'gps' | 'network' | 'unknown' {
  if (accuracy < 100) return 'gps'
  if (accuracy < 5000) return 'network'
  return 'unknown'
}

function getCachedGeo(): GeoLocation | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(GEO_CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw) as GeoLocation
    if (Date.now() - cached.timestamp > GEO_CACHE_MAX_AGE) return null
    return cached
  } catch {
    return null
  }
}

function setCachedGeo(geo: GeoLocation): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geo))
  } catch {
    // storage full or unavailable
  }
}

/**
 * React hook for continuous geolocation tracking.
 * Use in components that need to display/react to location changes.
 */
export function useGeolocation(options: {
  enableHighAccuracy?: boolean
  timeout?: number
  maximumAge?: number
  watchPosition?: boolean
} = {}) {
  const {
    enableHighAccuracy = true,
    timeout = 10_000,
    maximumAge = 60_000,
    watchPosition = false,
  } = options

  const [location, setLocation] = useState<GeoLocation | null>(getCachedGeo)
  const [error, setError] = useState<GeoLocationError | null>(null)
  const [loading, setLoading] = useState(false)
  const [permissionStatus, setPermissionStatus] = useState<PermissionState | null>(null)
  const watchIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions) return
    navigator.permissions.query({ name: 'geolocation' }).then((result) => {
      setPermissionStatus(result.state)
      result.onchange = () => setPermissionStatus(result.state)
    }).catch(() => {})
  }, [])

  const handleSuccess = useCallback((position: GeolocationPosition) => {
    const geo: GeoLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
      source: classifySource(position.coords.accuracy),
    }
    setLocation(geo)
    setCachedGeo(geo)
    setError(null)
    setLoading(false)
  }, [])

  const handleError = useCallback((err: GeolocationPositionError) => {
    const msgs: Record<number, string> = {
      1: 'Location permission denied by user',
      2: 'Location information unavailable',
      3: 'Location request timed out',
    }
    setError({ code: err.code, message: msgs[err.code] || 'Unknown geolocation error' })
    setLoading(false)
  }, [])

  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError({ code: 0, message: 'Geolocation not supported by browser' })
      return
    }
    setLoading(true)
    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy, timeout, maximumAge,
    })
  }, [enableHighAccuracy, timeout, maximumAge, handleSuccess, handleError])

  useEffect(() => {
    if (!watchPosition || typeof navigator === 'undefined' || !navigator.geolocation) return
    watchIdRef.current = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy, timeout, maximumAge,
    })
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    }
  }, [watchPosition, enableHighAccuracy, timeout, maximumAge, handleSuccess, handleError])

  return { location, error, loading, permissionStatus, requestLocation,
    isSupported: typeof navigator !== 'undefined' && !!navigator.geolocation }
}

/**
 * One-shot Promise-based location fetch.
 * Returns cached location if fresh, otherwise fetches new.
 * Resolves to null on failure — NEVER blocks the caller.
 */
export function getGeoLocation(timeoutMs = 8000): Promise<GeoLocation | null> {
  const cached = getCachedGeo()
  if (cached) return Promise.resolve(cached)

  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null)
      return
    }

    const timer = setTimeout(() => resolve(null), timeoutMs)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer)
        const geo: GeoLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
          source: classifySource(position.coords.accuracy),
        }
        setCachedGeo(geo)
        resolve(geo)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 }
    )
  })
}

/**
 * Build the X-Geo-Location header value from current location.
 * Returns null if location is unavailable.
 */
export async function getGeoHeader(): Promise<string | null> {
  const geo = await getGeoLocation(5000)
  if (!geo) return null
  return JSON.stringify({
    lat: geo.latitude,
    lng: geo.longitude,
    acc: geo.accuracy,
    src: geo.source,
    ts: geo.timestamp,
  })
}
