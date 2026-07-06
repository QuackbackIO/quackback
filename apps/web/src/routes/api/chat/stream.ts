import { createFileRoute } from '@tanstack/react-router'
import {
  db,
  eq,
  and,
  or,
  gt,
  isNull,
  conversations,
  conversationMessages,
  principal,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { auth } from '@/lib/server/auth'
import { verifyStreamToken } from '@/lib/server/realtime/stream-token'
import {
  conversationChannel,
  CONVERSATION_INBOX_CHANNEL,
  parseConversationFrame,
  isOwnTyping,
  type ParsedConversationFrame,
} from '@/lib/server/realtime/conversation-channels'
import { subscribe } from '@/lib/server/realtime/pubsub'
import { markPresent, refreshPresence, clearPresence } from '@/lib/server/realtime/presence'
import { readActivitySnapshot } from '@/lib/server/domains/assistant/assistant-activity-snapshot'
import { canViewConversation } from '@/lib/server/policy/conversation'
import { isTeamMember } from '@/lib/shared/roles'
import {
  loadAuthors,
  toMessageDTO,
  fallbackAuthor,
  findBackfillCursor,
} from '@/lib/server/domains/conversation/conversation.query'
import { normalizePrincipalType } from '@/lib/server/functions/auth-helpers'
import type { Actor } from '@/lib/server/policy/types'
import { createSseStream, SSE_RESPONSE_HEADERS } from '@/lib/server/utils/sse'
import { streamLimiter } from '@/lib/server/realtime/stream-connection-limit'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'chat-stream' })

const HEARTBEAT_MS = 20_000

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

/** Frame a raw pub/sub payload as a named SSE event (id carried for message
 *  events so reconnect backfill can resume). Takes the already-parsed frame so
 *  the subscribe callback parses each payload once; an unparseable (null)
 *  frame passes through as a generic message. Pure — hoisted so it isn't
 *  re-created per connection. */
function formatFrame(
  message: string,
  parsed: ParsedConversationFrame
): { id?: string; frame: string } {
  const eventName = parsed?.kind ?? 'message'
  const id = parsed?.kind === 'message' ? parsed.message?.id : undefined
  return {
    id,
    frame: `${id ? `id: ${id}\n` : ''}event: ${eventName}\ndata: ${message}\n\n`,
  }
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

        // Feature-flag gate: stop streams when every conversation surface is
        // off (a token may have been minted before the flag flipped). Portal
        // access for visitors was enforced when the stream token was minted.
        const { isConversationsEnabled } =
          await import('@/lib/server/domains/settings/settings.support')
        if (!(await isConversationsEnabled())) {
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
          channels.push(CONVERSATION_INBOX_CHANNEL)
        } else if (scope === 'presence') {
          // App-wide agent presence: any admin page keeps a team member marked
          // online for routing. Heartbeat only — no channel subscription.
          if (!isTeamMember(me.role)) {
            return new Response('Forbidden', { status: 403 })
          }
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

        // Last gate: reserve a concurrency slot (global + per-IP). Atomic
        // check-and-hold, released by cleanup on every teardown path. An
        // 'unknown' IP (unproxied host) is passed as undefined so a shared
        // bucket can't false-positive real visitors — the global cap still
        // bounds them.
        const clientIp = getClientIp(request.headers)
        const slot = streamLimiter.acquire(clientIp === 'unknown' ? undefined : clientIp)
        if (!slot.ok) {
          return new Response('Too many streams', { status: 503 })
        }

        const isAgentStream = scope === 'inbox' || scope === 'presence'
        // Unique per stream so presence is tracked per-connection in Redis
        // (cross-replica), not by a per-process count.
        const streamId = crypto.randomUUID()
        const lastEventId = request.headers.get('last-event-id')

        // Resources are torn down by a single idempotent cleanup. They're
        // declared up front and assigned as acquired so cleanup is correct
        // even if the setup below throws partway, and so an abort that races
        // its awaits still releases everything. The SSE writer owns the
        // closed guard (a failed enqueue silences further sends); teardown
        // keys off its own flag (else a dropped client would leak the
        // heartbeat + presence).
        let cleanup: () => Promise<void> = async () => {}
        const sse = createSseStream({ onCancel: () => cleanup() })
        let cleanedUp = false
        let presenceMarked = false
        let heartbeat: ReturnType<typeof setInterval> | null = null
        let unsubscribe: (() => Promise<void>) | null = null

        cleanup = async () => {
          if (cleanedUp) return
          cleanedUp = true
          sse.close()
          if (heartbeat) clearInterval(heartbeat)
          if (unsubscribe) {
            try {
              await unsubscribe()
            } catch {
              /* ignore */
            }
          }
          if (presenceMarked) {
            const wentOffline = await clearPresence(me.principalId, streamId, isAgentStream)
            // When an inbox agent's last stream closes cluster-wide, return
            // their unanswered conversations to the queue so they aren't
            // stranded. wentOffline is now Redis-backed, so an agent still
            // live on another replica is not treated as offline here.
            if (wentOffline && isAgentStream) {
              const { requeueUnansweredOnAgentOffline } =
                await import('@/lib/server/domains/conversation/conversation.service')
              await requeueUnansweredOnAgentOffline(me.principalId)
            }
          }
          slot.release()
        }

        const run = async () => {
          try {
            // Open comment + initial retry hint.
            sse.sendRaw(`retry: 3000\n\n`)
            sse.sendRaw(`: connected\n\n`)

            await markPresent(me.principalId, streamId, isAgentStream)
            presenceMarked = true

            // Subscribe BEFORE backfilling so a message committed in the
            // window between the backfill query and the subscribe can't be
            // dropped. Live events are buffered until backfill finishes, then
            // flushed in order (deduped against what backfill already sent).
            const sentMessageIds = new Set<string>()
            let backfilling = Boolean(backfillConversationId && lastEventId)
            const liveBuffer: Array<{ id?: string; frame: string }> = []

            const unsub = await subscribe(channels, (_channel, message) => {
              const event = parseConversationFrame(message)
              // Never echo a subscriber's own typing back to them, on any
              // surface — clients can treat every typing event they receive
              // as someone else's.
              if (isOwnTyping(event, me.principalId)) {
                return
              }
              const { id, frame } = formatFrame(message, event)
              if (backfilling) {
                liveBuffer.push({ id, frame })
                return
              }
              if (id) sentMessageIds.add(id)
              sse.sendRaw(frame)
            })
            // If the client aborted while subscribe() was in flight, cleanup
            // already ran (with unsubscribe still null) — release this orphan
            // subscription immediately instead of leaking it.
            if (sse.isClosed()) {
              await unsub()
              return
            }
            unsubscribe = unsub

            // Replay Quinn's in-flight activity trace, if any: a subscriber
            // connecting mid-turn (most visibly a brand-new conversation,
            // where the stream opens after the turn already started) would
            // otherwise miss every "thinking" / "searching" frame published
            // before it subscribed. Kicked off AFTER subscribing (no gap) but
            // awaited past the backfill below so the Redis read overlaps the
            // DB round trips; sent before the live-buffer flush so an activity
            // frame that arrived during backfill is flushed after it and wins.
            // Only for a conversation-scoped stream — the trace is never
            // inbox-wide.
            const activitySnapshot = backfillConversationId
              ? readActivitySnapshot(backfillConversationId)
              : null

            // Backfill messages the client missed while disconnected. Mirror
            // the canonical read path: skip soft-deleted rows and use the
            // composite (created_at, id) keyset so same-microsecond siblings
            // are not dropped. A backfill failure must not tear down the live
            // stream, so it's isolated in its own try/catch.
            if (backfillConversationId && lastEventId) {
              try {
                // Scoped to the authorized conversation — a Last-Event-ID
                // from elsewhere must not shift the backfill window.
                const cursor = await findBackfillCursor(backfillConversationId, lastEventId)
                if (cursor) {
                  const missed = await db
                    .select()
                    .from(conversationMessages)
                    .where(
                      and(
                        eq(conversationMessages.conversationId, backfillConversationId),
                        isNull(conversationMessages.deletedAt),
                        // Mirror listMessages: internal notes are agent-only.
                        // Visitor (non-team) reconnect backfill must exclude
                        // them — publish-time channel separation doesn't cover
                        // this DB read path.
                        isTeamMember(me.role)
                          ? undefined
                          : eq(conversationMessages.isInternal, false),
                        or(
                          gt(conversationMessages.createdAt, cursor.createdAt),
                          and(
                            eq(conversationMessages.createdAt, cursor.createdAt),
                            gt(conversationMessages.id, cursor.id)
                          )
                        )
                      )
                    )
                    .orderBy(conversationMessages.createdAt, conversationMessages.id)
                  const authors = await loadAuthors(missed.map((m) => m.principalId))
                  for (const m of missed) {
                    const dto = toMessageDTO(
                      m,
                      m.principalId
                        ? (authors.get(m.principalId) ?? fallbackAuthor(m.principalId))
                        : null
                    )
                    sentMessageIds.add(dto.id)
                    sse.send(
                      'message',
                      { kind: 'message', conversationId: dto.conversationId, message: dto },
                      dto.id
                    )
                  }
                }
              } catch (err) {
                log.warn({ err }, 'chat stream backfill failed')
              }
            }

            const snapshot = activitySnapshot ? await activitySnapshot : null
            if (snapshot) {
              const json = JSON.stringify(snapshot)
              const { frame } = formatFrame(json, parseConversationFrame(json))
              sse.sendRaw(frame)
            }

            // Flush live events buffered during backfill, skipping any message
            // already delivered by the backfill.
            backfilling = false
            for (const { id, frame } of liveBuffer) {
              if (id && sentMessageIds.has(id)) continue
              if (id) sentMessageIds.add(id)
              sse.sendRaw(frame)
            }

            heartbeat = setInterval(() => {
              sse.sendRaw(`: ping\n\n`)
              void refreshPresence(me.principalId, streamId, isAgentStream)
            }, HEARTBEAT_MS)

            // A late abort (during the awaits above) must still tear down.
            if (request.signal.aborted) await cleanup()
          } catch (err) {
            log.warn({ err }, 'chat stream start failed')
            await cleanup()
          }
        }

        // The runtime aborts the request signal on client disconnect.
        // addEventListener does NOT fire for an already-aborted signal, so
        // also check it up front (the client may drop during run()'s awaits).
        request.signal.addEventListener('abort', () => void cleanup())
        if (request.signal.aborted) {
          await cleanup()
        } else {
          void run()
        }

        return new Response(sse.stream, {
          headers: { ...SSE_RESPONSE_HEADERS, Connection: 'keep-alive' },
        })
      },
    },
  },
})
