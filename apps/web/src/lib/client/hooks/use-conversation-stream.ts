import { useEffect, useRef } from 'react'
import type { ChatStreamEvent } from '@/lib/shared/conversation/types'

interface UseChatStreamOptions {
  /**
   * Build the full SSE URL, including any auth token. Return null to skip
   * connecting (e.g. no conversation yet, or token mint failed). Re-invoked on
   * every (re)connect so a fresh, short-lived stream token can be minted.
   */
  buildUrl: () => Promise<string | null>
  enabled: boolean
  onEvent: (event: ChatStreamEvent) => void
  /**
   * Called after a reconnect (not the first connect). Use it to refetch state
   * so any events missed while disconnected are caught up — we recreate the
   * EventSource on error (to re-mint the token), which forgoes the built-in
   * Last-Event-ID replay.
   */
  onReconnect?: () => void
  /** Key that, when changed, tears down and rebuilds the connection. */
  resetKey?: string | number
}

const NAMED_EVENTS = [
  'message',
  'conversation',
  'read',
  'typing',
  'message_deleted',
  // Agent-only: a reaction/flag changed on an existing message. The server only
  // ever publishes this on the inbox channel, so the visitor stream never
  // receives it even though the event name is registered here.
  'message_updated',
] as const

/**
 * Subscribe to the chat SSE stream with automatic, token-refreshing reconnect.
 * Browser-only; a no-op during SSR.
 */
export function useConversationStream({
  buildUrl,
  enabled,
  onEvent,
  onReconnect,
  resetKey,
}: UseChatStreamOptions): void {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const onReconnectRef = useRef(onReconnect)
  onReconnectRef.current = onReconnect
  const buildUrlRef = useRef(buildUrl)
  buildUrlRef.current = buildUrl

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof EventSource === 'undefined') return

    let es: EventSource | null = null
    let stopped = false
    let retry = 0
    let openedOnce = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const handle = (e: MessageEvent) => {
      try {
        onEventRef.current(JSON.parse(e.data) as ChatStreamEvent)
      } catch {
        /* ignore malformed payloads */
      }
    }

    const scheduleReconnect = () => {
      if (stopped) return
      retry = Math.min(retry + 1, 6)
      const delay = Math.min(1000 * 2 ** retry, 30_000)
      reconnectTimer = setTimeout(() => void connect(), delay)
    }

    const connect = async () => {
      if (stopped) return
      let url: string | null
      try {
        url = await buildUrlRef.current()
      } catch {
        url = null
      }
      if (stopped) return
      if (!url) {
        scheduleReconnect()
        return
      }

      es = new EventSource(url)
      for (const name of NAMED_EVENTS) {
        es.addEventListener(name, handle as EventListener)
      }
      es.onopen = () => {
        retry = 0
        if (openedOnce) onReconnectRef.current?.()
        openedOnce = true
      }
      es.onerror = () => {
        // The token may have expired; recreate with a fresh one + backoff.
        es?.close()
        es = null
        scheduleReconnect()
      }
    }

    void connect()

    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      es?.close()
      es = null
    }
    // buildUrl/onEvent/onReconnect are captured via refs above, so the
    // connection only rebuilds on enabled/resetKey changes — by design.
  }, [enabled, resetKey])
}
