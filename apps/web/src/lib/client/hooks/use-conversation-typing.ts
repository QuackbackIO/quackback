import { useCallback, useEffect, useRef, useState } from 'react'

const TYPING_THROTTLE_MS = 2500
const REMOTE_TYPING_TTL_MS = 4000

/**
 * Chat typing state. Throttles outbound "I'm typing" signals so we send at most
 * one per window while the user types, and tracks whether the remote side is
 * currently typing (auto-clearing after a TTL so a dropped stop-signal can't
 * leave the indicator stuck on).
 */
export function useConversationTyping(sendTyping: () => void) {
  const [remoteTyping, setRemoteTyping] = useState(false)
  const lastSentRef = useRef(0)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendRef = useRef(sendTyping)
  sendRef.current = sendTyping

  /** Call on every local input change; throttled internally. */
  const onLocalInput = useCallback(() => {
    const now = Date.now()
    if (now - lastSentRef.current < TYPING_THROTTLE_MS) return
    lastSentRef.current = now
    sendRef.current()
  }, [])

  /** Call when a remote typing event arrives. */
  const onRemoteTyping = useCallback(() => {
    setRemoteTyping(true)
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    clearTimerRef.current = setTimeout(() => setRemoteTyping(false), REMOTE_TYPING_TTL_MS)
  }, [])

  /** Clear the indicator immediately (e.g. when the remote message lands). */
  const clearRemoteTyping = useCallback(() => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    setRemoteTyping(false)
  }, [])

  useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    },
    []
  )

  return { remoteTyping, onLocalInput, onRemoteTyping, clearRemoteTyping }
}
