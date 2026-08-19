/**
 * Assigning a conversation to its current assignee (or re-selecting its current
 * team) is a no-op: no row update, no "Conversation assigned to …" system
 * message, no realtime publish, no webhook. A genuine change still performs all
 * of those.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId, TeamId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const publishConversationUpdate = vi.fn()
const publishConversationEvent = vi.fn()
const emitConversationAssigned = vi.fn()

// The row loadConversationOr404 resolves to, queued .limit() results for the
// follow-up selects, and captured .set()/.values() payloads.
let existingRow: Record<string, unknown>
let selectQueue: Record<string, unknown>[][]
const setPayloads: Record<string, unknown>[] = []
const insertPayloads: Record<string, unknown>[] = []

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationUpdate: (...a: unknown[]) => publishConversationUpdate(...a),
  publishConversationEvent: (...a: unknown[]) => publishConversationEvent(...a),
  publishAgentConversationEvent: vi.fn(),
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
  emitConversationAssigned: (...a: unknown[]) => emitConversationAssigned(...a),
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

import { assignConversation, assignTeam } from '../conversation.service'

const agent: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

const convId = 'conversation_1' as ConversationId
const alice = 'principal_alice' as PrincipalId
const bob = 'principal_bob' as PrincipalId
const teamA = 'team_a' as TeamId

beforeEach(() => {
  vi.clearAllMocks()
  setPayloads.length = 0
  insertPayloads.length = 0
  existingRow = {
    id: convId,
    status: 'open',
    assignedAgentPrincipalId: alice,
    assignedTeamId: teamA,
    snoozedUntil: null,
  }
  selectQueue = [[existingRow]]
})

describe('assignConversation no-op guard', () => {
  it('does nothing when the target is already the assignee', async () => {
    const result = await assignConversation(convId, alice, agent)
    expect(result).toBe(existingRow)
    expect(setPayloads).toHaveLength(0)
    expect(insertPayloads).toHaveLength(0)
    expect(publishConversationUpdate).not.toHaveBeenCalled()
    expect(emitConversationAssigned).not.toHaveBeenCalled()
  })

  it('does nothing when unassigning an unassigned conversation', async () => {
    existingRow.assignedAgentPrincipalId = null
    const result = await assignConversation(convId, null, agent)
    expect(result).toBe(existingRow)
    expect(setPayloads).toHaveLength(0)
    expect(publishConversationUpdate).not.toHaveBeenCalled()
  })

  it('still updates and announces on a genuine change', async () => {
    // Queued selects: load conversation, target-role check, assignee name.
    selectQueue = [[existingRow], [{ role: 'member' }], [{ displayName: 'Bob' }]]
    await assignConversation(convId, bob, agent)
    expect(setPayloads[0]).toMatchObject({ assignedAgentPrincipalId: bob })
    expect(insertPayloads[0]).toMatchObject({ senderType: 'system' })
    expect(publishConversationUpdate).toHaveBeenCalledTimes(1)
    expect(emitConversationAssigned).toHaveBeenCalledTimes(1)
  })
})

describe('assignTeam no-op guard', () => {
  it('does nothing when the target is already the assigned team', async () => {
    const result = await assignTeam(convId, teamA, agent)
    expect(result).toBe(existingRow)
    expect(setPayloads).toHaveLength(0)
    expect(insertPayloads).toHaveLength(0)
    expect(publishConversationUpdate).not.toHaveBeenCalled()
    expect(emitConversationAssigned).not.toHaveBeenCalled()
  })

  it('does nothing when clearing an already-clear team', async () => {
    existingRow.assignedTeamId = null
    const result = await assignTeam(convId, null, agent)
    expect(result).toBe(existingRow)
    expect(setPayloads).toHaveLength(0)
    expect(publishConversationUpdate).not.toHaveBeenCalled()
  })
})
