import { useEffect, useRef } from 'react'
import type { ConversationStreamEvent } from '@/lib/shared/conversation/types'

interface UseConversationStreamOptions {
  /**
   * Build the full SSE URL, including any auth token. Return null to skip
   * connecting (e.g. no conversation yet, or token mint failed). Re-invoked on
   * every (re)connect so a fresh, short-lived stream token can be minted.
   */
  buildUrl: () => Promise<string | null>
  enabled: boolean
  onEvent: (event: ConversationStreamEvent) => void
  /**
   * Called after a reconnect (not the first connect). Use it to refetch state
   * so any events missed while disconnected are caught up — we recreate the
   * EventSource on error (to re-mint the token), which forgoes the built-in
   * Last-Event-ID replay.
   */
  onReconnect?: () => void
  /** Key that, when changed, tears down and rebuilds the connection. */
  resetKey?: string | number
  /**
   * Transport from the capability handshake. `'poll'` skips SSE entirely (a
   * host behind an SSE-hostile proxy); `'live'` (default) uses SSE and only
   * degrades to polling after repeated connect failures. Both need `poll` set
   * for the fallback to do anything.
   */
  mode?: 'live' | 'poll'
  /**
   * Poll callback — typically a full thread refetch. Enables the polling
   * fallback: the hook invokes it on an interval in poll mode, or once SSE has
   * failed enough times that reconnecting is clearly futile (the connection
   * cap, a proxy that buffers event streams, or a browser with no EventSource).
   * Without it the hook only ever retries SSE, matching the original behavior.
   */
  poll?: () => Promise<void> | void
  /** Poll cadence in poll mode / after degrading. */
  pollIntervalMs?: number
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
  // Ephemeral AI-assistant turn signals (conversation channel only). EventSource
  // drops any named frame with no matching listener, so these MUST be registered.
  'assistant_activity',
  'assistant_delta',
] as const

// After this many consecutive SSE failures with no successful open in between,
// stop retrying and fall back to polling (only when a poll callback exists).
// Four attempts span ~30s of exponential backoff — long enough to ride out a
// transient blip, short enough that a genuinely SSE-hostile host degrades fast.
const MAX_SSE_FAILURES = 4
const DEFAULT_POLL_INTERVAL_MS = 10_000

/**
 * Subscribe to the conversation SSE stream with automatic, token-refreshing
 * reconnect, degrading to a polling fallback when live streaming is unavailable.
 * Browser-only; a no-op during SSR.
 */
export function useConversationStream({
  buildUrl,
  enabled,
  onEvent,
  onReconnect,
  resetKey,
  mode = 'live',
  poll,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseConversationStreamOptions): void {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const onReconnectRef = useRef(onReconnect)
  onReconnectRef.current = onReconnect
  const buildUrlRef = useRef(buildUrl)
  buildUrlRef.current = buildUrl
  const pollRef = useRef(poll)
  pollRef.current = poll

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    let es: EventSource | null = null
    let stopped = false
    let retry = 0
    let openedOnce = false
    let sseFailures = 0
    let polling = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    const handle = (e: MessageEvent) => {
      try {
        onEventRef.current(JSON.parse(e.data) as ConversationStreamEvent)
      } catch {
        /* ignore malformed payloads */
      }
    }

    // Polling fallback: refetch the thread on an interval, catching up
    // immediately on the first tick. Idempotent — once running it stays running
    // until teardown, so a late SSE error can't spin up a second loop.
    const startPolling = () => {
      if (stopped || polling || !pollRef.current) return
      polling = true
      const tick = async () => {
        if (stopped) return
        try {
          await pollRef.current?.()
        } catch {
          /* keep polling despite a transient fetch error */
        }
        if (!stopped) pollTimer = setTimeout(() => void tick(), pollIntervalMs)
      }
      void tick()
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
        sseFailures = 0
        if (openedOnce) onReconnectRef.current?.()
        openedOnce = true
      }
      es.onerror = () => {
        // The token may have expired; recreate with a fresh one + backoff.
        es?.close()
        es = null
        sseFailures++
        // Once reconnecting is clearly futile and a poll fallback exists, stop
        // hammering SSE and switch to polling for the rest of this connection.
        if (sseFailures >= MAX_SSE_FAILURES && pollRef.current) {
          startPolling()
          return
        }
        scheduleReconnect()
      }
    }

    // A poll-only host (capability handshake) or a browser with no EventSource
    // never attempts SSE; everything else streams and degrades on repeated
    // failure. startPolling is a no-op without a poll callback, so a poll-less
    // consumer on such a host simply does nothing (the prior behavior).
    if (mode === 'poll' || typeof EventSource === 'undefined') {
      startPolling()
    } else {
      void connect()
    }

    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (pollTimer) clearTimeout(pollTimer)
      es?.close()
      es = null
    }
    // buildUrl/onEvent/onReconnect/poll are captured via refs above, so the
    // connection only rebuilds on enabled/resetKey/mode/interval changes.
  }, [enabled, resetKey, mode, pollIntervalMs])
}
