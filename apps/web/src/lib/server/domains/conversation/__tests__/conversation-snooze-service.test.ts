/**
 * Snooze lifecycle service behavior: snoozeConversation defers a thread (with an
 * explicit wake time or "until reply"), and sweepDueSnoozedConversations wakes
 * elapsed timers back to open — both publishing the same inbox update + status
 * webhook a manual status change does. The agent gate is covered too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const publishConversationUpdate = vi.fn()
const emitConversationStatusChanged = vi.fn()

// The row loadConversationOr404 resolves to, the rows the UPDATE returns, and
// the captured .set() payloads.
let existingRow: Record<string, unknown>
let updateReturns: Record<string, unknown>[]
const setPayloads: Record<string, unknown>[] = []

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationUpdate: (...a: unknown[]) => publishConversationUpdate(...a),
  publishConversationEvent: vi.fn(),
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
  emitConversationStatusChanged: (...a: unknown[]) => emitConversationStatusChanged(...a),
  emitConversationAssigned: vi.fn(),
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: vi.fn(),
  emitConversationCsatCommentAdded: vi.fn(),
}))

vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string; status: string }) => ({
    id: c.id,
    status: c.status,
  })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => m),
  authorFromInput: vi.fn((a: { principalId: string }) => ({ principalId: a.principalId })),
  resolveAuthor: vi.fn(async (a: { principalId: string }) => ({ principalId: a.principalId })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(label: string): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = (t: { __name?: string }) => chain(t?.__name ?? label)
    c.set = (payload: Record<string, unknown>) => {
      setPayloads.push(payload)
      return c
    }
    c.where = () => c
    c.limit = async () => [existingRow]
    c.returning = async () => updateReturns
    return c
  }
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      select: () => chain('select'),
      update: (t: { __name?: string }) => chain(t?.__name ?? 'unknown'),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    isNotNull: vi.fn(),
    lte: vi.fn(),
    inArray: vi.fn(),
  }
})

import { snoozeConversation, sweepDueSnoozedConversations } from '../conversation.service'

const agent: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}
const visitor: Actor = {
  principalId: 'principal_v' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}
const convId = 'conversation_1' as ConversationId

beforeEach(() => {
  existingRow = {
    id: 'conversation_1',
    status: 'open',
    assignedAgentPrincipalId: null,
    snoozedUntil: null,
  }
  updateReturns = [{ id: 'conversation_1', status: 'snoozed', assignedAgentPrincipalId: null }]
  setPayloads.length = 0
  vi.clearAllMocks()
})

describe('snoozeConversation', () => {
  it('sets status=snoozed with the wake time and clears resolvedAt', async () => {
    const until = new Date('2026-07-03T09:00:00.000Z')
    await snoozeConversation(convId, until, agent)
    expect(setPayloads[0]).toMatchObject({
      status: 'snoozed',
      snoozedUntil: until,
      resolvedAt: null,
    })
    expect(publishConversationUpdate).toHaveBeenCalledTimes(1)
    // A real status change (open -> snoozed) fires the webhook with the prior status.
    expect(emitConversationStatusChanged).toHaveBeenCalledTimes(1)
    expect(emitConversationStatusChanged.mock.calls[0][2]).toBe('open')
  })

  it('snooze-until-reply passes a null wake time', async () => {
    await snoozeConversation(convId, null, agent)
    expect(setPayloads[0]).toMatchObject({ status: 'snoozed', snoozedUntil: null })
  })

  it('refuses a non-agent', async () => {
    await expect(snoozeConversation(convId, null, visitor)).rejects.toThrow()
    expect(publishConversationUpdate).not.toHaveBeenCalled()
  })
})

describe('sweepDueSnoozedConversations', () => {
  it('wakes each due thread to open, clears the timer, and reports the count', async () => {
    updateReturns = [
      { id: 'conversation_a', status: 'open', assignedAgentPrincipalId: null },
      { id: 'conversation_b', status: 'open', assignedAgentPrincipalId: null },
    ]
    const result = await sweepDueSnoozedConversations()
    expect(result).toEqual({ woken: 2 })
    expect(setPayloads[0]).toMatchObject({ status: 'open', snoozedUntil: null })
    expect(publishConversationUpdate).toHaveBeenCalledTimes(2)
    // Each wake is published as a snoozed -> open status change (system-driven).
    expect(emitConversationStatusChanged).toHaveBeenCalledTimes(2)
    expect(emitConversationStatusChanged.mock.calls[0][2]).toBe('snoozed')
  })

  it('is a no-op when nothing is due', async () => {
    updateReturns = []
    const result = await sweepDueSnoozedConversations()
    expect(result).toEqual({ woken: 0 })
    expect(publishConversationUpdate).not.toHaveBeenCalled()
  })
})
