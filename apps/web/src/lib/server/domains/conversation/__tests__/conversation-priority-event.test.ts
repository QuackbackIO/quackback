/**
 * A genuine priority change posts an internal, author-less thread event
 * ("<name> changed the priority to <priority>") so the team sees the triage
 * in the conversation timeline; re-selecting the current priority posts
 * nothing. The event is internal-only: the visitor channel never sees it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const publishConversationUpdate = vi.fn()
const publishConversationEvent = vi.fn()
const publishAgentConversationEvent = vi.fn()

// The row loadConversationOr404 resolves to, queued .limit() results for the
// follow-up selects, and captured .set()/.values() payloads.
let existingRow: Record<string, unknown>
let selectQueue: Record<string, unknown>[][]
const setPayloads: Record<string, unknown>[] = []
const insertPayloads: Record<string, unknown>[] = []

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationUpdate: (...a: unknown[]) => publishConversationUpdate(...a),
  publishConversationEvent: (...a: unknown[]) => publishConversationEvent(...a),
  publishAgentConversationEvent: (...a: unknown[]) => publishAgentConversationEvent(...a),
  publishTyping: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('../conversation.notify', () => ({
  notifyVisitorMessage: vi.fn(),
  notifyAgentReply: vi.fn(),
  notifyConversationStarted: vi.fn(),
}))

vi.mock('../conversation.webhooks', () => ({
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

vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string }) => ({ id: c.id })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => m),
  authorFromInput: vi.fn((a: { principalId: string }) => ({ principalId: a.principalId })),
  resolveAuthor: vi.fn(async (a: { principalId: string }) => ({ principalId: a.principalId })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.set = (payload: Record<string, unknown>) => {
      setPayloads.push(payload)
      return c
    }
    c.values = (payload: Record<string, unknown>) => {
      insertPayloads.push(payload)
      return c
    }
    c.where = () => c
    c.limit = async () => selectQueue.shift() ?? []
    c.returning = async () => [{ ...existingRow, ...(setPayloads.at(-1) ?? {}) }]
    return c
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      select: () => chain(),
      update: () => chain(),
      insert: () => chain(),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
  }
})

import { setConversationPriority, snoozeConversation } from '../conversation.service'

const agent: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

const convId = 'conversation_1' as ConversationId

beforeEach(() => {
  vi.clearAllMocks()
  setPayloads.length = 0
  insertPayloads.length = 0
  existingRow = {
    id: convId,
    status: 'open',
    priority: 'medium',
    assignedAgentPrincipalId: null,
    assignedTeamId: null,
    snoozedUntil: null,
  }
  selectQueue = [[existingRow]]
})

describe('setConversationPriority thread event', () => {
  it('posts an internal priority_changed system event on a genuine change', async () => {
    // Queued selects: load conversation, actor display name.
    selectQueue = [[existingRow], [{ displayName: 'James' }]]
    await setConversationPriority(convId, 'urgent', agent)
    expect(insertPayloads).toHaveLength(1)
    expect(insertPayloads[0]).toMatchObject({
      senderType: 'system',
      isInternal: true,
      metadata: { systemEvent: { kind: 'priority_changed', priority: 'urgent' } },
    })
    expect(insertPayloads[0].content).toContain('urgent')
    // Team-only: the visitor channel never receives the event.
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })

  it('posts nothing when the priority is unchanged', async () => {
    await setConversationPriority(convId, 'medium', agent)
    expect(insertPayloads).toHaveLength(0)
  })
})

describe('snoozeConversation thread event', () => {
  it('posts an internal snoozed system event', async () => {
    // Queued selects: load conversation, actor display name.
    selectQueue = [[existingRow], [{ displayName: 'James' }]]
    const until = new Date('2026-08-01T09:00:00Z')
    await snoozeConversation(convId, until, agent)
    expect(insertPayloads).toHaveLength(1)
    expect(insertPayloads[0]).toMatchObject({
      senderType: 'system',
      isInternal: true,
      metadata: { systemEvent: { kind: 'snoozed' } },
    })
    expect(insertPayloads[0].content).toContain('snoozed')
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })
})
