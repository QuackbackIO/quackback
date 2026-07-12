/**
 * sendVisitorMessage's structured-reply wiring (Phase C, slice C-1): the
 * canonical echo re-derivation from the referenced block message's own
 * stored config, and every degrade-to-plain-text path (invalid, stale,
 * second reply) — never an error either way. block-reply.test.ts covers the
 * pure resolution rules; this covers the DB lookups + the send path around
 * them (metadata.blockReply on the stored row, content override, the
 * already-answered check).
 *
 * A purpose-built DB mock, separate from conversation-send-service.test.ts's
 * shared fixture: `db.select` (used by resolveVisitorBlockReply's two reads,
 * BEFORE the send's own transaction opens) is a controllable queue so each
 * test can script exactly what the block-message lookup and the
 * already-answered check return, independent of the transaction's own
 * conversation-lookup/message-insert chain.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId, ConversationMessageId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const emit = vi.hoisted(() => ({
  emitConversationCreated: vi.fn(),
  emitMessageCreated: vi.fn(),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: vi.fn(),
  emitConversationCsatCommentAdded: vi.fn(),
}))
vi.mock('../conversation.webhooks', () => emit)

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/blocking', () => ({ isBlocked: vi.fn(async () => false) }))

vi.mock('../conversation.notify', () => ({
  notifyVisitorMessage: vi.fn(),
  notifyAgentReply: vi.fn(),
  notifyConversationStarted: vi.fn(),
}))

vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string; status: string }) => ({
    id: c.id,
    status: c.status,
  })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => {
    const metadata = (m.metadata ?? null) as { block?: unknown; blockReply?: unknown } | null
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderType: m.senderType,
      content: m.content,
      contentJson: m.contentJson ?? null,
      block: metadata?.block ?? null,
      blockReply: metadata?.blockReply ?? null,
      createdAt: (m.createdAt as Date).toISOString(),
    }
  }),
  authorFromInput: vi.fn((a: { principalId: string }) => ({
    principalId: a.principalId,
    displayName: null,
    avatarUrl: null,
  })),
  loadAuthors: vi.fn(async () => new Map()),
}))

// The block-message lookup + already-answered check (resolveVisitorBlockReply,
// module-level `db.select`, BEFORE the transaction) — a controllable queue,
// one entry per expected select call, in call order.
let selectQueue: unknown[][] = []
// The most recent .set() payload the conversations table UPDATE received —
// captured so a test can assert what status/resolvedAt the send actually
// wrote (SF3), not just the pre-update snapshot.
let lastConversationSetPayload: Record<string, unknown> | undefined

const conversationRow = {
  id: 'conversation_1' as ConversationId,
  visitorPrincipalId: 'principal_visitor' as PrincipalId,
  status: 'open',
  resolvedAt: null as Date | null,
  source: null,
  visitorEmail: null,
  waitingSince: null,
  customAttributes: {},
  createdAt: new Date(),
  lastMessageAt: new Date(),
}

vi.mock('@/lib/server/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/db')>()

  function selectChain() {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = () => c
    c.limit = async () => selectQueue.shift() ?? []
    return c
  }
  function txChain(label: string, insertedMessage: { current: Record<string, unknown> | null }) {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = () => c
    c.limit = async () => (label === 'conversations' ? [conversationRow] : [])
    c.values = (row: Record<string, unknown>) => {
      if (label === 'conversation_messages') insertedMessage.current = row
      return c
    }
    c.set = (payload: Record<string, unknown>) => {
      if (label === 'conversations') lastConversationSetPayload = payload
      return c
    }
    c.returning = async () => {
      if (label === 'conversation_messages') {
        return [{ id: 'conversation_msg_new', createdAt: new Date(), ...insertedMessage.current }]
      }
      // Reflect the update's .set() payload merged onto the base row (like a
      // real UPDATE ... RETURNING would) so a test can assert on the status/
      // resolvedAt the conversation update actually wrote, not just the
      // pre-update snapshot.
      return [{ ...conversationRow, ...(lastConversationSetPayload ?? {}) }]
    }
    return c
  }

  const insertedMessage = { current: null as Record<string, unknown> | null }
  const tableLabel = (table: unknown): string => {
    if (table === real.conversations) return 'conversations'
    if (table === real.conversationMessages) return 'conversation_messages'
    return 'unknown'
  }

  return {
    ...real,
    db: {
      select: () => selectChain(),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          // sendVisitorMessage's only tx.select() call loads the existing
          // conversation (a plain `.select()`, no column projection).
          select: () => txChain('conversations', insertedMessage),
          insert: (table: unknown) => txChain(tableLabel(table), insertedMessage),
          update: (table: unknown) => txChain(tableLabel(table), insertedMessage),
        }),
    },
  }
})

import { sendVisitorMessage } from '../conversation.service'

const visitor = 'principal_visitor' as PrincipalId
const visitorActor: Actor = {
  principalId: visitor,
  role: 'user',
  principalType: 'anonymous',
  segmentIds: new Set(),
}
const conversationId = 'conversation_1' as ConversationId
const blockMessageId = 'conversation_msg_block1' as ConversationMessageId

function buttonsBlockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: blockMessageId,
    conversationId,
    senderType: 'agent',
    metadata: {
      block: {
        v: 1,
        runId: 'workflow_run_1',
        nodeId: 'n1',
        waiting: true,
        kind: 'buttons',
        options: [
          { key: 'yes', label: 'Yes please' },
          { key: 'no', label: 'No thanks' },
        ],
        allowTyping: false,
      },
    },
    ...overrides,
  }
}

beforeEach(() => {
  selectQueue = []
  lastConversationSetPayload = undefined
  conversationRow.status = 'open'
  conversationRow.resolvedAt = null
  vi.clearAllMocks()
})

describe('sendVisitorMessage — structured block replies (Phase C, slice C-1)', () => {
  it('stores the server-derived canonical echo + metadata.blockReply, ignoring the client display text', async () => {
    selectQueue = [[buttonsBlockRow()], []] // block message found, not yet answered
    const result = await sendVisitorMessage(
      {
        conversationId,
        content: 'a client-supplied label the server must not trust',
        blockReply: { kind: 'buttons', inReplyToMessageId: blockMessageId, buttonKey: 'no' },
      },
      { principalId: visitor },
      visitorActor
    )
    expect(result.message.content).toBe('No thanks') // the block's OWN option label, not the client's text
    expect(result.message.blockReply).toEqual({
      kind: 'buttons',
      inReplyToMessageId: blockMessageId,
      buttonKey: 'no',
    })
  })

  it('degrades to an ordinary free-text message when the buttonKey does not match any declared option (invalid)', async () => {
    selectQueue = [[buttonsBlockRow()], []]
    const result = await sendVisitorMessage(
      {
        conversationId,
        content: 'typed text',
        blockReply: { kind: 'buttons', inReplyToMessageId: blockMessageId, buttonKey: 'bogus' },
      },
      { principalId: visitor },
      visitorActor
    )
    expect(result.message.content).toBe('typed text')
    expect(result.message.blockReply).toBeNull()
  })

  it('degrades when the referenced message does not exist (invalid)', async () => {
    selectQueue = [[]] // block message lookup returns nothing
    const result = await sendVisitorMessage(
      {
        conversationId,
        content: 'typed text',
        blockReply: {
          kind: 'buttons',
          inReplyToMessageId: 'conversation_msg_ghost',
          buttonKey: 'yes',
        },
      },
      { principalId: visitor },
      visitorActor
    )
    expect(result.message.content).toBe('typed text')
    expect(result.message.blockReply).toBeNull()
  })

  it('degrades when the referenced message belongs to a DIFFERENT conversation (invalid)', async () => {
    selectQueue = [[buttonsBlockRow({ conversationId: 'conversation_other' })]]
    const result = await sendVisitorMessage(
      {
        conversationId,
        content: 'typed text',
        blockReply: { kind: 'buttons', inReplyToMessageId: blockMessageId, buttonKey: 'yes' },
      },
      { principalId: visitor },
      visitorActor
    )
    expect(result.message.content).toBe('typed text')
    expect(result.message.blockReply).toBeNull()
  })

  it('degrades a second reply to an already-answered block (stale/second)', async () => {
    // Block message found AND a prior visitor message already answered it.
    selectQueue = [[buttonsBlockRow()], [{ id: 'conversation_msg_prior_reply' }]]
    const result = await sendVisitorMessage(
      {
        conversationId,
        content: 'yes again',
        blockReply: { kind: 'buttons', inReplyToMessageId: blockMessageId, buttonKey: 'yes' },
      },
      { principalId: visitor },
      visitorActor
    )
    expect(result.message.content).toBe('yes again')
    expect(result.message.blockReply).toBeNull()
  })

  it('never throws for an invalid/stale reply — always resolves as an ordinary send', async () => {
    selectQueue = [[]]
    await expect(
      sendVisitorMessage(
        {
          conversationId,
          content: 'still a normal message',
          blockReply: { kind: 'csat', inReplyToMessageId: 'conversation_msg_ghost', rating: 5 },
        },
        { principalId: visitor },
        visitorActor
      )
    ).resolves.toMatchObject({ message: { content: 'still a normal message' } })
  })

  it('an ordinary send with no blockReply never touches the block-reply lookup at all', async () => {
    await sendVisitorMessage(
      { conversationId, content: 'just chatting' },
      { principalId: visitor },
      visitorActor
    )
    expect(selectQueue).toEqual([]) // nothing was queued, nothing was consumed — no extra query ran
  })

  describe('post-close matched blockReply does not reopen (SF3)', () => {
    it('a MATCHED blockReply on an already-closed conversation stays closed, not reopened', async () => {
      conversationRow.status = 'closed'
      const priorResolvedAt = new Date('2026-01-01T00:00:00.000Z')
      conversationRow.resolvedAt = priorResolvedAt
      selectQueue = [[buttonsBlockRow()], []] // block message found, not yet answered
      const result = await sendVisitorMessage(
        {
          conversationId,
          content: 'a client-supplied label',
          blockReply: { kind: 'buttons', inReplyToMessageId: blockMessageId, buttonKey: 'no' },
        },
        { principalId: visitor },
        visitorActor
      )
      // The reply itself still resolves as a genuine match (unaffected by the
      // conversation being closed) — only the reopen side effect changes.
      expect(result.message.content).toBe('No thanks')
      expect(result.message.blockReply).toEqual({
        kind: 'buttons',
        inReplyToMessageId: blockMessageId,
        buttonKey: 'no',
      })
      expect(result.conversation.status).toBe('closed')
      expect(lastConversationSetPayload).toMatchObject({ status: 'closed' })
      // The original resolution stamp survives — a post-close CSAT/button tap
      // must not look like the conversation was JUST resolved.
      expect(lastConversationSetPayload?.resolvedAt).toBe(priorResolvedAt)
    })

    it('an UNMATCHED blockReply (invalid/stale) on an already-closed conversation still reopens it — functionally an ordinary reply', async () => {
      conversationRow.status = 'closed'
      selectQueue = [[]] // block message lookup finds nothing -> degrades to plain text
      const result = await sendVisitorMessage(
        {
          conversationId,
          content: 'typed text',
          blockReply: {
            kind: 'buttons',
            inReplyToMessageId: 'conversation_msg_ghost',
            buttonKey: 'yes',
          },
        },
        { principalId: visitor },
        visitorActor
      )
      expect(result.message.blockReply).toBeNull() // degraded, not a real match
      expect(result.conversation.status).toBe('open')
      expect(lastConversationSetPayload).toMatchObject({ status: 'open' })
    })

    it('an ordinary (non-blockReply) reply to an already-closed conversation still reopens it, unaffected by this fix', async () => {
      conversationRow.status = 'closed'
      const result = await sendVisitorMessage(
        { conversationId, content: 'just following up' },
        { principalId: visitor },
        visitorActor
      )
      expect(result.conversation.status).toBe('open')
      expect(lastConversationSetPayload).toMatchObject({ status: 'open' })
    })

    it('a MATCHED blockReply on an OPEN conversation still surfaces it normally (the carve-out only applies when already closed)', async () => {
      conversationRow.status = 'open'
      selectQueue = [[buttonsBlockRow()], []]
      const result = await sendVisitorMessage(
        {
          conversationId,
          content: 'label',
          blockReply: { kind: 'buttons', inReplyToMessageId: blockMessageId, buttonKey: 'no' },
        },
        { principalId: visitor },
        visitorActor
      )
      expect(result.conversation.status).toBe('open')
      expect(lastConversationSetPayload).toMatchObject({ status: 'open' })
    })
  })
})
