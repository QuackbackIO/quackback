import { useState, useRef, useCallback, useEffect } from 'react'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'

// Turns can run several seconds (search + compose). This only backstops a
// dropped "done" signal — the persisted reply is what normally clears the turn.
const ASSISTANT_TURN_TTL_MS = 20_000

/**
 * Transient state for Quinn's in-flight turn in the widget: the current working
 * status and the answer as it streams. Both are ephemeral (never cached) and
 * cleared when the persisted reply lands; a TTL backstops a lost final signal.
 * Mirrors {@link useConversationTyping}.
 */
export function useAssistantTurn() {
  const [assistantActivity, setActivity] = useState<AssistantActivityStatus | null>(null)
  const [assistantStream, setStream] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const bump = useCallback(() => {
    clearTimer()
    timer.current = setTimeout(() => {
      setActivity(null)
      setStream('')
    }, ASSISTANT_TURN_TTL_MS)
  }, [clearTimer])

  const clearAssistantTurn = useCallback(() => {
    clearTimer()
    setActivity(null)
    setStream('')
  }, [clearTimer])

  const onAssistantActivity = useCallback(
    (status: AssistantActivityStatus) => {
      // A fresh working phase (incl. a retry) restarts the streamed answer.
      setStream('')
      setActivity(status)
      bump()
    },
    [bump]
  )

  const onAssistantDelta = useCallback(
    (text: string) => {
      // `text` is the full answer so far — replace, so drops/retries self-heal.
      setStream(text)
      bump()
    },
    [bump]
  )

  useEffect(() => clearTimer, [clearTimer])

  return {
    assistantActivity,
    assistantStream,
    onAssistantActivity,
    onAssistantDelta,
    clearAssistantTurn,
  }
}
