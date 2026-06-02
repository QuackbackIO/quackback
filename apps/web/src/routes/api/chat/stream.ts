import { createFileRoute } from '@tanstack/react-router'
import {
  db,
  eq,
  and,
  or,
  gt,
  isNull,
  conversations,
  chatMessages,
  principal,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { auth } from '@/lib/server/auth'
import { verifyStreamToken } from '@/lib/server/realtime/stream-token'
import {
  conversationChannel,
  CHAT_INBOX_CHANNEL,
  shouldSuppressOwnAgentTyping,
} from '@/lib/server/realtime/chat-channels'
import { subscribe } from '@/lib/server/realtime/pubsub'
import { markPresent, refreshPresence, clearPresence } from '@/lib/server/realtime/presence'
import { canViewConversation } from '@/lib/server/policy/chat'
import { isTeamMember } from '@/lib/shared/roles'
import { loadAuthors, toMessageDTO, fallbackAuthor } from '@/lib/server/domains/chat/chat.query'
import { normalizePrincipalType } from '@/lib/server/functions/auth-helpers'
import type { Actor } from '@/lib/server/policy/types'

const HEARTBEAT_MS = 20_000

// Backstop against file-descriptor exhaustion on the single Bun process. The
// polling fallback in the client keeps low-priority surfaces working if a
// stream is refused here.
const MAX_CONCURRENT_STREAMS = 500
let openStreams = 0

interface StreamPrincipal {
  principalId: PrincipalId
  role: string
  type: string
  /** How the principal was authenticated: a minted token (portal access already
   *  enforced at mint) vs a raw session cookie (must be re-gated here). */
  via: 'token' | 'session'
}

/** Resolve the principal for a stream from a signed token (widget) or the
 * session cookie / Bearer header (admin + identified portal). */
async function resolveStreamPrincipal(request: Request): Promise<StreamPrincipal | null> {
  const url = new URL(request.url)
  const tokenPrincipalId = verifyStreamToken(url.searchParams.get('token'))
  if (tokenPrincipalId) {
    const row = await db.query.principal.findFirst({ where: eq(principal.id, tokenPrincipalId) })
    if (row) return { principalId: row.id, role: row.role, type: row.type, via: 'token' }
    return null
  }

  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return null
  const row = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id as never),
  })
  if (!row) return null
  return { principalId: row.id, role: row.role, type: row.type, via: 'session' }
}

function sse(event: string, data: unknown, id?: string): string {
  const lines: string[] = []
  if (id) lines.push(`id: ${id}`)
  lines.push(`event: ${event}`)
  lines.push(`data: ${JSON.stringify(data)}`)
  return lines.join('\n') + '\n\n'
}

export const Route = createFileRoute('/api/chat/stream')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const scope = url.searchParams.get('scope') // 'inbox' for agents
        const conversationIdParam = url.searchParams.get('conversationId')

        const me = await resolveStreamPrincipal(request)
        if (!me) {
          return new Response('Unauthorized', { status: 401 })
        }

        // Feature-flag gate: stop streams when chat is turned off (a token may
        // have been minted before the flag flipped). Portal access for visitors
        // was enforced when the stream token was minted.
        const { isLiveChatEnabled } = await import('@/lib/server/domains/settings/settings.widget')
        if (!(await isLiveChatEnabled())) {
          return new Response('Not found', { status: 404 })
        }

        const actor: Actor = {
          principalId: me.principalId,
          role: (me.role as Actor['role']) ?? null,
          principalType: normalizePrincipalType(me.type),
          segmentIds: new Set(),
        }

        // Resolve which channel(s) to subscribe to, authorizing FIRST.
        const channels: string[] = []
        let backfillConversationId: ConversationId | null = null

        if (scope === 'inbox') {
          if (!isTeamMember(me.role)) {
            return new Response('Forbidden', { status: 403 })
          }
          channels.push(CHAT_INBOX_CHANNEL)
        } else if (conversationIdParam) {
          const conversationId = conversationIdParam as ConversationId
          // A cookie-authed (non-token) visitor bypassed the mint-time portal
          // gate, so re-check portal access here. Token streams were already
          // gated at mint; team members reach chat from the admin inbox.
          if (me.via === 'session' && !isTeamMember(me.role)) {
            const { resolvePortalAccessForRequest } =
              await import('@/lib/server/functions/portal-access')
            const access = await resolvePortalAccessForRequest()
            if (!access.granted) {
              return new Response('Not found', { status: 404 })
            }
          }
          const conversation = await db.query.conversations.findFirst({
            where: eq(conversations.id, conversationId),
          })
          if (!conversation || !canViewConversation(actor, conversation).allowed) {
            // Never leak existence to a non-owner.
            return new Response('Not found', { status: 404 })
          }
          channels.push(conversationChannel(conversationId))
          backfillConversationId = conversationId
        } else {
          return new Response('Bad request', { status: 400 })
        }

        if (openStreams >= MAX_CONCURRENT_STREAMS) {
          return new Response('Too many streams', { status: 503 })
        }

        const isAgentStream = scope === 'inbox'
        const encoder = new TextEncoder()
        const lastEventId = request.headers.get('last-event-id')

        let cleanup: () => Promise<void> = async () => {}

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            // Resources are torn down by a single idempotent cleanup. They're
            // declared up front and assigned as acquired so cleanup is correct
            // even if start() throws partway, and so an abort that races the
            // awaits below still releases everything.
            let closed = false
            let counted = false
            let presenceMarked = false
            let heartbeat: ReturnType<typeof setInterval> | null = null
            let unsubscribe: (() => Promise<void>) | null = null

            const send = (chunk: string) => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(chunk))
              } catch {
                closed = true
              }
            }

            cleanup = async () => {
              if (closed) return
              closed = true
              if (heartbeat) clearInterval(heartbeat)
              if (unsubscribe) {
                try {
                  await unsubscribe()
                } catch {
                  /* ignore */
                }
              }
              if (presenceMarked) await clearPresence(me.principalId, isAgentStream)
              if (counted) openStreams = Math.max(0, openStreams - 1)
              try {
                controller.close()
              } catch {
                /* already closed */
              }
            }

            // The runtime aborts the request signal on client disconnect.
            // addEventListener does NOT fire for an already-aborted signal, so
            // also check it up front (the client may drop during the awaits).
            request.signal.addEventListener('abort', () => void cleanup())
            if (request.signal.aborted) {
              await cleanup()
              return
            }

            openStreams++
            counted = true

            try {
              // Open comment + initial retry hint.
              send(`retry: 3000\n\n`)
              send(`: connected\n\n`)

              await markPresent(me.principalId, isAgentStream)
              presenceMarked = true

              // Subscribe BEFORE backfilling so a message committed in the
              // window between the backfill query and the subscribe can't be
              // dropped. Live events are buffered until backfill finishes, then
              // flushed in order (deduped against what backfill already sent).
              const sentMessageIds = new Set<string>()
              let backfilling = Boolean(backfillConversationId && lastEventId)
              const liveBuffer: Array<{ id?: string; frame: string }> = []

              const formatFrame = (message: string): { id?: string; frame: string } => {
                let id: string | undefined
                let eventName = 'message'
                try {
                  const parsed = JSON.parse(message) as {
                    kind?: string
                    message?: { id?: string }
                  }
                  eventName = parsed.kind ?? 'message'
                  if (parsed.kind === 'message') id = parsed.message?.id
                } catch {
                  // pass through as-is if unparseable
                }
                return {
                  id,
                  frame: `${id ? `id: ${id}\n` : ''}event: ${eventName}\ndata: ${message}\n\n`,
                }
              }

              const unsub = await subscribe(channels, (_channel, message) => {
                // Don't echo an agent's own typing back to them — so the client
                // can treat any agent-typing it receives as "another agent".
                if (isAgentStream && shouldSuppressOwnAgentTyping(message, me.principalId)) {
                  return
                }
                const { id, frame } = formatFrame(message)
                if (backfilling) {
                  liveBuffer.push({ id, frame })
                  return
                }
                if (id) sentMessageIds.add(id)
                send(frame)
              })
              // If the client aborted while subscribe() was in flight, cleanup
              // already ran (with unsubscribe still null) — release this orphan
              // subscription immediately instead of leaking it.
              if (closed) {
                await unsub()
                return
              }
              unsubscribe = unsub

              // Backfill messages the client missed while disconnected. Mirror
              // the canonical read path: skip soft-deleted rows and use the
              // composite (created_at, id) keyset so same-microsecond siblings
              // are not dropped. A backfill failure must not tear down the live
              // stream, so it's isolated in its own try/catch.
              if (backfillConversationId && lastEventId) {
                try {
                  const cursor = await db.query.chatMessages.findFirst({
                    where: eq(chatMessages.id, lastEventId as never),
                  })
                  if (cursor) {
                    const missed = await db
                      .select()
                      .from(chatMessages)
                      .where(
                        and(
                          eq(chatMessages.conversationId, backfillConversationId),
                          isNull(chatMessages.deletedAt),
                          // Mirror listMessages: internal notes are agent-only.
                          // Visitor (non-team) reconnect backfill must exclude
                          // them — publish-time channel separation doesn't cover
                          // this DB read path.
                          isTeamMember(me.role) ? undefined : eq(chatMessages.isInternal, false),
                          or(
                            gt(chatMessages.createdAt, cursor.createdAt),
                            and(
                              eq(chatMessages.createdAt, cursor.createdAt),
                              gt(chatMessages.id, cursor.id)
                            )
                          )
                        )
                      )
                      .orderBy(chatMessages.createdAt, chatMessages.id)
                    const authors = await loadAuthors(missed.map((m) => m.principalId))
                    for (const m of missed) {
                      const dto = toMessageDTO(
                        m,
                        m.principalId
                          ? (authors.get(m.principalId) ?? fallbackAuthor(m.principalId))
                          : null
                      )
                      sentMessageIds.add(dto.id)
                      send(
                        sse(
                          'message',
                          { kind: 'message', conversationId: dto.conversationId, message: dto },
                          dto.id
                        )
                      )
                    }
                  }
                } catch (err) {
                  console.warn('[chat:stream] backfill failed:', (err as Error).message)
                }
              }

              // Flush live events buffered during backfill, skipping any message
              // already delivered by the backfill.
              backfilling = false
              for (const { id, frame } of liveBuffer) {
                if (id && sentMessageIds.has(id)) continue
                if (id) sentMessageIds.add(id)
                send(frame)
              }

              heartbeat = setInterval(() => {
                send(`: ping\n\n`)
                void refreshPresence(me.principalId, isAgentStream)
              }, HEARTBEAT_MS)

              // A late abort (during the awaits above) must still tear down.
              if (request.signal.aborted) await cleanup()
            } catch (err) {
              console.warn('[chat:stream] start failed:', (err as Error).message)
              await cleanup()
            }
          },
          async cancel() {
            await cleanup()
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            // Disable proxy buffering so events flush immediately.
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
