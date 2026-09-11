import { useEffect, useState } from 'react'

import { matchesMediaQuery } from '../services/prefersReducedMotion'
import type { ThemeMode } from '../types'

const DARK_THEME_COLOR = '#0f1117'
const LIGHT_THEME_COLOR = '#fafbfc'

interface OnlineStatusEventTarget {
  addEventListener: (type: 'online' | 'offline', listener: () => void) => void
  removeEventListener: (type: 'online' | 'offline', listener: () => void) => void
}

interface MediaQueryEventTarget {
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
  addListener?: (listener: () => void) => void
  removeListener?: (listener: () => void) => void
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode
  return matchesMediaQuery('(prefers-color-scheme: dark)') ? 'dark' : 'light'
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  const theme = resolveTheme(mode)
  document.documentElement.dataset.theme = theme
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
}

export function useTheme(mode: ThemeMode): void {
  useEffect(() => {
    if (mode !== 'system' || typeof globalThis.matchMedia !== 'function') {
      applyTheme(mode)
      return
    }
    try {
      const mq = globalThis.matchMedia('(prefers-color-scheme: dark)')
      return installMediaQueryChangeSubscription(mq, () => applyTheme('system'))
    } catch {
      applyTheme(mode)
      return
    }
  }, [mode])
}

export function installMediaQueryChangeSubscription(
  target: MediaQueryEventTarget,
  onChange: () => void,
): () => void {
  let registration: 'modern' | 'legacy' | null = null
  let registering = false
  let callbackDispatchedDuringRegistration = false
  let callbackFailedDuringRegistration = false
  const handleChange = () => {
    if (registering) callbackDispatchedDuringRegistration = true
    try {
      onChange()
    } catch {
      if (registering) callbackFailedDuringRegistration = true
      // Browser event callbacks must not escape the media-query boundary.
    }
  }
  const cleanup = () => {
    const current = registration
    if (!current) return
    registration = null
    try {
      if (current === 'modern') {
        target.removeEventListener?.('change', handleChange)
      } else {
        target.removeListener?.(handleChange)
      }
    } catch {
      // Browser teardown may make listener removal unavailable.
    }
  }

  try {
    if (
      typeof target.addEventListener === 'function' &&
      typeof target.removeEventListener === 'function'
    ) {
      registration = 'modern'
      registering = true
      try {
        target.addEventListener('change', handleChange)
      } finally {
        registering = false
      }
    } else if (
      typeof target.addListener === 'function' &&
      typeof target.removeListener === 'function'
    ) {
      registration = 'legacy'
      registering = true
      try {
        target.addListener(handleChange)
      } finally {
        registering = false
      }
    } else {
      return cleanup
    }
    if (callbackFailedDuringRegistration) {
      cleanup()
    } else if (!callbackDispatchedDuringRegistration) {
      onChange()
    }
  } catch {
    cleanup()
  }

  return cleanup
}

export function installOnlineStatusSubscription(
  target: OnlineStatusEventTarget,
  readOnline: () => boolean,
  onStatusChange: (online: boolean) => void,
): () => void {
  const on = () => onStatusChange(true)
  const off = () => onStatusChange(false)
  let onlineRegistered = false
  let offlineRegistered = false

  const cleanup = () => {
    if (onlineRegistered) {
      onlineRegistered = false
      try {
        target.removeEventListener('online', on)
      } catch {
        // Browser teardown may make listener removal unavailable.
      }
    }
    if (offlineRegistered) {
      offlineRegistered = false
      try {
        target.removeEventListener('offline', off)
      } catch {
        // Browser teardown may make listener removal unavailable.
      }
    }
  }

  try {
    target.addEventListener('online', on)
    onlineRegistered = true
    target.addEventListener('offline', off)
    offlineRegistered = true
    onStatusChange(readOnline())
  } catch {
    cleanup()
  }

  return cleanup
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    return installOnlineStatusSubscription(
      window,
      () => (typeof navigator === 'undefined' ? true : navigator.onLine),
      setOnline,
    )
  }, [])

  return online
}
