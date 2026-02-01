import { useEffect, useRef } from 'react'

const CHANNEL_NAME = 'quackback-auth'

// ============================================================================
// Types
// ============================================================================

interface AuthBroadcastMessage {
  type: 'auth-success'
  timestamp: number
}

interface UseAuthBroadcastOptions {
  onSuccess?: () => void
  enabled?: boolean
}

interface UsePopupTrackerOptions {
  onPopupClosed?: () => void
}

// ============================================================================
// Broadcast Hooks
// ============================================================================

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
export function useAuthBroadcast({ onSuccess, enabled = true }: UseAuthBroadcastOptions): void {
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
        onSuccessRef.current?.()
      }
    }

    return () => {
      channel.close()
    }
  }, [enabled])
}

// ============================================================================
// Utility Functions
// ============================================================================

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

// ============================================================================
// Popup Tracker Hook
// ============================================================================

/**
 * Hook to track popup window state and detect if user closes it early.
 */
export function usePopupTracker({ onPopupClosed }: UsePopupTrackerOptions) {
  const popupRef = useRef<Window | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onPopupClosedRef = useRef(onPopupClosed)

  // Keep callback ref updated
  useEffect(() => {
    onPopupClosedRef.current = onPopupClosed
  }, [onPopupClosed])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  function trackPopup(popup: Window | null): void {
    popupRef.current = popup

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
        onPopupClosedRef.current?.()
      }
    }, 500)
  }

  function clearPopup(): void {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    popupRef.current = null
  }

  function focusPopup(): void {
    popupRef.current?.focus()
  }

  function hasPopup(): boolean {
    return popupRef.current !== null && !popupRef.current.closed
  }

  return { trackPopup, clearPopup, focusPopup, hasPopup }
}
