/**
 * Read the app's live stream (/api/chat/stream) from the test process, as a
 * signed-in person or a widget visitor's stream token, and assert on the
 * frames it delivers.
 *
 *   const inbox = await openStream({ person: 'scoped', query: { scope: 'inbox' } })
 *   expect(inbox.status).toBe(200)
 *   await inbox.waitFor((e) => e.data?.conversationId === id)
 *   inbox.close()
 *
 * The server writes `: connected` before it subscribes, and an inbox stream's
 * scope gate starts stale, so an event fired the moment the stream opens can
 * be missed. Pattern: open, cause an in-scope warm-up event and wait for it,
 * then act. To prove a frame did NOT arrive, cause a later in-scope marker
 * event and wait for it, then check `matching(...)` (everything seen so far).
 *
 * `waitFor` only looks at frames after the last frame it returned (or after
 * `mark()`), so an old frame never satisfies a later wait.
 *
 * Note that an inbox or presence stream marks the person present (online):
 * close it when done.
 */
import { pollFor } from './db'
import { supportEnv } from './env'
import { sessionCookieHeader } from './presence'
import type { SupportPersonName } from './people'

/** The fields tests read most; frames carry more (see realtime/*-channels.ts). */
export interface StreamFrameData {
  kind?: string
  conversationId?: string
  ticketId?: string
  message?: { id?: string; content?: string; isInternal?: boolean; [k: string]: unknown }
  [k: string]: unknown
}

export interface StreamEvent {
  id?: string
  event: string
  /** Parsed JSON data ({} when the data is not a JSON object). */
  data: StreamFrameData
  /** The data line as sent: search it to prove a value never leaked. */
  raw: string
}

export interface OpenStream {
  status: number
  /** The refusal body for a non-200 answer. */
  body: string
  events: StreamEvent[]
  /**
   * Wait for the first matching frame after the last one `waitFor` returned
   * (or after `mark()`), and move past it.
   */
  waitFor: (match: (e: StreamEvent) => boolean, timeoutMs?: number) => Promise<StreamEvent>
  /** From now on, `waitFor` ignores every frame already received. */
  mark: () => void
  /** Every frame seen so far (from the start) that matches. */
  matching: (match: (e: StreamEvent) => boolean) => StreamEvent[]
  /** True until the server ends the stream. */
  isOpen: () => boolean
  close: () => void
}

export interface OpenStreamOptions {
  /** Sign in as a support person (session cookie). */
  person?: SupportPersonName
  /** Or a raw Cookie header. */
  cookie?: string
  /** Query: scope, conversationId, ticketId, token. */
  query?: Record<string, string>
  lastEventId?: string
}

function parseFrame(block: string): StreamEvent | null {
  let event = 'message'
  let id: string | undefined
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':') || line === '') continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'id') id = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return null
  const raw = data.join('\n')
  let parsed: StreamFrameData = {}
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object') parsed = value as StreamFrameData
  } catch {
    parsed = {}
  }
  return { id, event, data: parsed, raw }
}

export async function openStream(opts: OpenStreamOptions): Promise<OpenStream> {
  const url = new URL('/api/chat/stream', supportEnv().baseUrl)
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v)
  const headers: Record<string, string> = { accept: 'text/event-stream' }
  const cookie = opts.cookie ?? (opts.person ? sessionCookieHeader(opts.person) : undefined)
  if (cookie) headers.cookie = cookie
  if (opts.lastEventId) headers['last-event-id'] = opts.lastEventId

  const controller = new AbortController()
  const res = await fetch(url, { headers, signal: controller.signal })
  const events: StreamEvent[] = []
  let open = res.ok && !!res.body
  let body = ''

  if (res.ok && res.body) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let cut: number
          while ((cut = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 2)
            const frame = parseFrame(block)
            if (frame) events.push(frame)
          }
        }
      } catch {
        // aborted
      } finally {
        open = false
      }
    })()
  } else {
    body = await res.text().catch(() => '')
    controller.abort()
  }

  let cursor = 0
  return {
    status: res.status,
    body,
    events,
    isOpen: () => open,
    matching: (match) => events.filter(match),
    waitFor: async (match, timeoutMs = 10_000) => {
      const found = await pollFor(
        'a matching stream frame',
        async () => {
          const i = events.findIndex((e, idx) => idx >= cursor && match(e))
          return i === -1 ? null : i + 1
        },
        { timeoutMs, intervalMs: 50 }
      ).catch((err: Error) => {
        const seen = events.map((e) => `${e.event} ${e.raw.slice(0, 160)}`).join('\n  ')
        throw new Error(`${err.message}\nFrames seen (${events.length}):\n  ${seen}`)
      })
      cursor = found
      return events[found - 1]
    },
    mark: () => {
      cursor = events.length
    },
    close: () => {
      open = false
      controller.abort()
    },
  }
}

/** Wait until the server has ended a stream (for example after removal). */
export async function waitForStreamClosed(stream: OpenStream, timeoutMs = 15_000): Promise<void> {
  await pollFor('the stream to close', async () => (stream.isOpen() ? null : true), { timeoutMs })
}
