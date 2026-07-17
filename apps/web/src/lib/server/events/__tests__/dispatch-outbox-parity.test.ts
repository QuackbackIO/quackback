import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Adjacent-systems follow-up: the WO-18 cutover made the outbox the SOLE delivery
 * path, so `emit()`'s catalogue zod validation is now a HARD gate on every
 * dispatched event. The 33 legacy `dispatch*` functions build `EventData.data`
 * and cast it `as unknown` into `emit` — that cast bypasses the compile-time
 * payload check, so a drift between what a dispatcher builds and what its
 * catalogue schema requires would throw at emit time and be swallowed
 * best-effort (the event silently dropped).
 *
 * Domain tests mock `@/lib/server/events/dispatch`, so that path is otherwise
 * unexercised. This test closes the gap: it captures the REAL output of every
 * dispatcher (via a `../process` mock) and pushes it through the REAL
 * `writeEventToOutbox` → `emit` → `def.payload.parse` against the test DB. A
 * payload/schema mismatch fails here loudly instead of dropping events in prod.
 *
 * The ~19 native-`emit()` catalogue types (status.* / board.* / tag.* /
 * article.* / company.* / apikey.* / settings.updated) are NOT covered here on
 * purpose: their services call the generic `emit<P>()` whose payload is
 * type-checked against the def at the call site, so a mismatch is a typecheck
 * error, not a runtime drop.
 */

// Real, non-transactional pool that bypasses config.ts's full env validation —
// same pattern emit.test.ts / outbox-dispatch.test.ts use for DB-backed tests.
vi.mock('@/lib/server/db', async (importOriginal) => {
  const { createDb } = await import('@quackback/db/client')
  const url =
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: createDb(url, { max: 5, prepare: false }),
  }
})

// Capture the EventData each dispatcher hands to processEvent, WITHOUT running
// processEvent's real inline branches — we drive writeEventToOutbox ourselves.
const captured: EventData[] = []
vi.mock('../process', () => ({
  processEvent: (event: EventData) => {
    captured.push(event)
    return Promise.resolve()
  },
}))

import { db, events, sql } from '@/lib/server/db'
import { createId } from '@quackback/ids'
import { writeEventToOutbox } from '../outbox-dispatch'
import * as d from '../dispatch'
import type {
  EventActor,
  EventConversationData,
  EventConversationRef,
  EventData,
  EventMessageData,
  EventTicketData,
  EventTicketRef,
} from '../types'

// --- shared fixtures --------------------------------------------------------

const actor = (): EventActor => ({
  type: 'user',
  principalId: createId('principal'),
  userId: createId('user'),
  email: 'agent@example.com',
  displayName: 'Agent Smith',
})

// No return annotation: let the branded TypeIDs (PostId/BoardId) flow through so
// the object satisfies both EventPostRef and the branded dispatch input types.
const postRef = () => ({
  id: createId('post'),
  title: 'A post',
  boardId: createId('board'),
  boardSlug: 'bugs',
})

const convRef = (): EventConversationRef => ({
  id: createId('conversation'),
  status: 'open',
  channel: 'messenger',
  priority: 'medium',
  assignedTeamId: null,
})

const convData = (): EventConversationData => ({
  ...convRef(),
  subject: 'Help',
  visitorPrincipalId: createId('principal'),
  visitorEmail: 'visitor@example.com',
  assignedAgentPrincipalId: null,
  createdAt: new Date('2026-01-01').toISOString(),
  lastMessageAt: new Date('2026-01-01').toISOString(),
  resolvedAt: null,
})

const msgData = (conversationId: string): EventMessageData => ({
  id: createId('conversation_message'),
  conversationId,
  senderType: 'agent',
  authorPrincipalId: createId('principal'),
  authorName: 'Agent Smith',
  authorEmail: 'agent@example.com',
  content: 'Hello',
  createdAt: new Date('2026-01-01').toISOString(),
})

const ticketRef = (): EventTicketRef => ({
  id: createId('ticket'),
  number: 42,
  type: 'customer',
  priority: 'high',
  assignedPrincipalId: null,
  assignedTeamId: null,
})

const ticketData = (): EventTicketData => ({
  ...ticketRef(),
  title: 'A ticket',
  status: 'open',
  stage: null,
  requesterPrincipalId: createId('principal'),
  companyId: null,
  createdAt: new Date('2026-01-01').toISOString(),
  updatedAt: new Date('2026-01-01').toISOString(),
  resolvedAt: null,
})

const attachments = () => [
  { name: 'log.txt', url: 'https://x/y', contentType: 'text/plain', size: 12 },
]

// Each entry invokes ONE real dispatcher with valid inputs. The dispatcher's
// EventData is captured and replayed through the real outbox path below.
const cases: Array<{ type: string; run: () => Promise<void> }> = [
  {
    type: 'post.created',
    run: () => d.dispatchPostCreated(actor(), { ...postRef(), content: 'c', voteCount: 3 }),
  },
  {
    type: 'post.status_changed',
    run: () => d.dispatchPostStatusChanged(actor(), postRef(), 'open', 'planned'),
  },
  {
    type: 'comment.created',
    run: () =>
      d.dispatchCommentCreated(actor(), { id: createId('post_comment'), content: 'hi' }, postRef()),
  },
  {
    type: 'post.mentioned',
    run: () =>
      d.dispatchPostMentioned(actor(), {
        postId: createId('post'),
        postTitle: 't',
        postUrl: 'https://x',
        mentionedPrincipalId: createId('principal'),
        mentioningPrincipalId: createId('principal'),
        excerpt: 'e',
      }),
  },
  { type: 'post.updated', run: () => d.dispatchPostUpdated(actor(), postRef(), ['title']) },
  { type: 'post.deleted', run: () => d.dispatchPostDeleted(actor(), postRef()) },
  { type: 'post.restored', run: () => d.dispatchPostRestored(actor(), postRef()) },
  { type: 'post.merged', run: () => d.dispatchPostMerged(actor(), postRef(), postRef()) },
  { type: 'post.unmerged', run: () => d.dispatchPostUnmerged(actor(), postRef(), postRef()) },
  {
    type: 'comment.updated',
    run: () =>
      d.dispatchCommentUpdated(actor(), { id: createId('post_comment'), content: 'hi' }, postRef()),
  },
  {
    type: 'comment.deleted',
    run: () => d.dispatchCommentDeleted(actor(), { id: createId('post_comment') }, postRef()),
  },
  {
    type: 'changelog.published',
    run: () =>
      d.dispatchChangelogPublished(actor(), {
        id: createId('changelog'),
        title: 't',
        contentPreview: 'p',
        publishedAt: new Date('2026-01-01'),
        linkedPostCount: 2,
      }),
  },
  { type: 'conversation.created', run: () => d.dispatchConversationCreated(actor(), convData()) },
  {
    type: 'conversation.status_changed',
    run: () => d.dispatchConversationStatusChanged(actor(), convRef(), 'open', 'closed'),
  },
  {
    type: 'conversation.assigned',
    run: () =>
      d.dispatchConversationAssigned(actor(), convRef(), createId('principal'), null, null, null),
  },
  {
    type: 'conversation.priority_changed',
    run: () => d.dispatchConversationPriorityChanged(actor(), convRef(), 'low', 'high'),
  },
  {
    type: 'conversation.attribute_changed',
    run: () =>
      d.dispatchConversationAttributeChanged(actor(), convRef(), 'plan', 'pro', 'teammate'),
  },
  {
    type: 'conversation.csat_submitted',
    run: () =>
      d.dispatchConversationCsatSubmitted(
        actor(),
        convRef(),
        5,
        'great',
        new Date('2026-01-01').toISOString()
      ),
  },
  {
    type: 'conversation.csat_comment_added',
    run: () =>
      d.dispatchConversationCsatCommentAdded(
        actor(),
        convRef(),
        5,
        'more',
        new Date('2026-01-01').toISOString()
      ),
  },
  {
    type: 'conversation.note_mentioned',
    run: () =>
      d.dispatchConversationNoteMentioned(actor(), {
        conversationId: createId('conversation'),
        conversationMessageId: createId('conversation_message'),
        mentionedPrincipalIds: [createId('principal')],
        authorName: 'A',
        preview: 'p',
      }),
  },
  {
    type: 'message.created',
    run: () => {
      const c = convRef()
      return d.dispatchMessageCreated(actor(), msgData(c.id), c, true)
    },
  },
  {
    type: 'message.note_created',
    run: () => {
      const c = convRef()
      return d.dispatchMessageNoteCreated(actor(), msgData(c.id), c)
    },
  },
  {
    type: 'message.deleted',
    run: () => {
      const c = convRef()
      return d.dispatchMessageDeleted(
        actor(),
        { id: createId('conversation_message'), conversationId: c.id },
        c
      )
    },
  },
  { type: 'ticket.created', run: () => d.dispatchTicketCreated(actor(), ticketData()) },
  {
    type: 'ticket.status_changed',
    run: () =>
      d.dispatchTicketStatusChanged(
        actor(),
        ticketRef(),
        'open',
        'closed',
        null,
        null,
        createId('principal'),
        'A ticket'
      ),
  },
  {
    type: 'ticket.assigned',
    run: () =>
      d.dispatchTicketAssigned(actor(), ticketRef(), createId('principal'), null, null, null),
  },
  {
    type: 'ticket.replied',
    run: () =>
      d.dispatchTicketReplied(
        actor(),
        ticketRef(),
        createId('conversation_message'),
        'reply',
        attachments(),
        'agent',
        'Cannot log in',
        'Sarah',
        createId('principal')
      ),
  },
  {
    type: 'ticket.note_added',
    run: () =>
      d.dispatchTicketNoteAdded(
        actor(),
        ticketRef(),
        createId('conversation_message'),
        'note',
        null,
        'agent',
        'Cannot log in',
        'Marco'
      ),
  },
  {
    type: 'assistant.handed_off',
    run: () => d.dispatchAssistantHandedOff(actor(), createId('conversation'), 'stuck'),
  },
  {
    type: 'conversation.customer_unresponsive',
    run: () => {
      const c = convRef()
      return d.dispatchConversationCustomerUnresponsive(`cu:${createId('conversation')}`, {
        conversationId: c.id,
        conversation: c,
        workflowId: createId('workflow'),
        silenceMinutes: 30,
        sinceAt: new Date('2026-01-01').toISOString(),
      })
    },
  },
  {
    type: 'conversation.teammate_unresponsive',
    run: () => {
      const c = convRef()
      return d.dispatchConversationTeammateUnresponsive(`tu:${createId('conversation')}`, {
        conversationId: c.id,
        conversation: c,
        workflowId: createId('workflow'),
        silenceMinutes: 30,
        sinceAt: new Date('2026-01-01').toISOString(),
      })
    },
  },
  {
    type: 'sla.approaching_breach',
    run: () => {
      const c = convRef()
      return d.dispatchSlaApproachingBreach(`sa:${createId('conversation')}`, {
        conversationId: c.id,
        conversation: c,
        clock: 'first_response',
        dueAt: new Date('2026-01-01').toISOString(),
      })
    },
  },
  {
    type: 'sla.breached',
    run: () => {
      const c = convRef()
      return d.dispatchSlaBreached(`sb:${createId('conversation')}`, {
        conversationId: c.id,
        conversation: c,
        clock: 'resolution',
        dueAt: new Date('2026-01-01').toISOString(),
      })
    },
  },
]

describe('dispatch → outbox payload parity', () => {
  beforeEach(() => {
    captured.length = 0
  })

  it.each(cases)(
    '$type survives the catalogue schema and lands in the outbox',
    async ({ type, run }) => {
      await run()
      expect(captured, `${type} dispatcher did not call processEvent`).toHaveLength(1)
      const event = captured[0]
      expect(event.type).toBe(type)

      // The real validation gate: a schema mismatch throws a ZodError here.
      const written = await writeEventToOutbox(event)
      expect(written, `${type} was not written to the outbox`).toBe(true)

      const rows = await db
        .select()
        .from(events)
        .where(sql`${events.context} ->> 'correlationId' = ${event.id}`)
      expect(rows, `${type} produced no outbox row`).toHaveLength(1)
      expect(rows[0].type).toBe(type)
    }
  )
})
