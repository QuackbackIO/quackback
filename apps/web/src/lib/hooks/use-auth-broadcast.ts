'use client'

import { useEffect, useCallback, useRef } from 'react'

const CHANNEL_NAME = 'quackback-auth'

interface AuthBroadcastMessage {
  type: 'auth-success'
  timestamp: number
}

/**
 * Hook for listening to auth success broadcasts from popup windows.
 *
 * When authentication completes in a popup (OAuth, OTP, SSO), the popup
 * broadcasts a success message via BroadcastChannel. This hook listens
 * for that message and calls the provided callback.
 *
 * Note: The callback is responsible for handling session refresh.
 * Use refetchSession() from useSession for smooth updates without page reloads.
 */
export function useAuthBroadcast(options: { onSuccess?: () => void; enabled?: boolean }) {
  const { onSuccess, enabled = true } = options
  const onSuccessRef = useRef(onSuccess)

  // Keep callback ref updated without re-running effect
  useEffect(() => {
    onSuccessRef.current = onSuccess
  }, [onSuccess])

  useEffect(() => {
    if (!enabled) return

    const channel = new BroadcastChannel(CHANNEL_NAME)

    channel.onmessage = (event: MessageEvent<AuthBroadcastMessage>) => {
      if (event.data.type === 'auth-success') {
        // Call success callback - caller handles session refresh
        onSuccessRef.current?.()
      }
    }

    return () => {
      channel.close()
    }
  }, [enabled])
}

/**
 * Post auth success message to other windows.
 * Called from the auth-complete page after session is established.
 */
export function postAuthSuccess(): void {
  const channel = new BroadcastChannel(CHANNEL_NAME)
  const message: AuthBroadcastMessage = {
    type: 'auth-success',
    timestamp: Date.now(),
  }
  channel.postMessage(message)
  channel.close()
}

/**
 * Open an auth URL in a popup window.
 * Returns the window reference for optional tracking.
 */
export function openAuthPopup(url: string): Window | null {
  const width = 500
  const height = 650
  const left = window.screenX + (window.outerWidth - width) / 2
  const top = window.screenY + (window.outerHeight - height) / 2

  const popup = window.open(
    url,
    'auth-popup',
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
  )

  return popup
}

/**
 * Hook to track popup window state and detect if user closes it early.
 */
export function usePopupTracker(options: { onPopupClosed?: () => void }) {
  const { onPopupClosed } = options
  const popupRef = useRef<Window | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const trackPopup = useCallback(
    (popup: Window | null) => {
      popupRef.current = popup

      // Clear any existing interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }

      if (!popup) return

      // Poll to detect if popup was closed without completing auth
      intervalRef.current = setInterval(() => {
        if (popup.closed) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
          popupRef.current = null
          onPopupClosed?.()
        }
      }, 500)
    },
    [onPopupClosed]
  )

  const clearPopup = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    popupRef.current = null
  }, [])

  const focusPopup = useCallback(() => {
    popupRef.current?.focus()
  }, [])

  const hasPopup = useCallback(() => {
    return popupRef.current !== null && !popupRef.current.closed
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  return {
    trackPopup,
    clearPopup,
    focusPopup,
    hasPopup,
  }
}
