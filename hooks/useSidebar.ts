'use client'

import { useCallback, useEffect, useState } from 'react'

const COLLAPSE_KEY = 'sidebarCollapsed'
const COLLAPSE_CLASS = 'sidebar-collapsed'
const COLLAPSE_EVENT = 'app:sidebar-collapse'
const MOBILE_EVENT = 'app:sidebar-mobile'

// Module-level state for the mobile drawer so the header toggle (rendered in the
// layout) and the sidebar (rendered per-page) stay in sync without prop drilling.
let mobileOpenState = false

function isCollapsed() {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains(COLLAPSE_CLASS)
}

function setCollapsedClass(next: boolean) {
  document.documentElement.classList.toggle(COLLAPSE_CLASS, next)
  try {
    localStorage.setItem(COLLAPSE_KEY, String(next))
  } catch {}
  window.dispatchEvent(new Event(COLLAPSE_EVENT))
}

/** Desktop collapse state (persisted, reflected as `html.sidebar-collapsed`). */
export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setCollapsed(isCollapsed())
    const handler = () => setCollapsed(isCollapsed())
    window.addEventListener(COLLAPSE_EVENT, handler)
    return () => window.removeEventListener(COLLAPSE_EVENT, handler)
  }, [])

  const toggleCollapse = useCallback(() => setCollapsedClass(!isCollapsed()), [])

  return { collapsed, toggleCollapse }
}

/** Mobile drawer open/close state, shared across components. */
export function useSidebarMobile() {
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(mobileOpenState)
    const handler = () => setMobileOpen(mobileOpenState)
    window.addEventListener(MOBILE_EVENT, handler)
    return () => window.removeEventListener(MOBILE_EVENT, handler)
  }, [])

  const setOpen = useCallback((value: boolean) => {
    mobileOpenState = value
    window.dispatchEvent(new Event(MOBILE_EVENT))
  }, [])

  return {
    mobileOpen,
    openMobile: () => setOpen(true),
    closeMobile: () => setOpen(false),
  }
}

/**
 * Single responsive toggle used by the header button:
 * collapses/expands the sidebar on desktop, opens the drawer on mobile.
 */
export function toggleSidebarResponsive() {
  if (typeof window === 'undefined') return
  if (window.matchMedia('(min-width: 1024px)').matches) {
    setCollapsedClass(!isCollapsed())
  } else {
    mobileOpenState = true
    window.dispatchEvent(new Event(MOBILE_EVENT))
  }
}
