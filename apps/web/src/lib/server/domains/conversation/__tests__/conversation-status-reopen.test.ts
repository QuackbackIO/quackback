/**
 * setConversationStatus's own idempotency on a same-status write (SF4's "no-op
 * if already open" guarantee for the new workflow `reopen` action rides
 * entirely on this pre-existing mechanism — the action itself is a stateless
 * dispatch with no pre-check of its own, see action.executor.ts's 'reopen'
 * case). A transition TO 'closed'/'open' posts a system transcript notice and
 * fires the status_changed webhook; a same-status write (open -> open, or
 * closed -> closed) does neither, exactly mirroring the pre-existing
 * close -> close no-op `close` already relied on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const emitConversationStatusChanged = vi.fn()
const publishConversationEvent = vi.fn()
const publishConversationUpdate = vi.fn()
const insertCalls: string[] = []

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: (...a: unknown[]) => publishConversationEvent(...a),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: (...a: unknown[]) => publishConversationUpdate(...a),
  publishTyping: vi.fn(),
}))

vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string; status: string }) => ({
    id: c.id,
    status: c.status,
  })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => m),
  authorFromInput: vi.fn(),
  resolveAuthor: vi.fn(),
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

vi.mock('@/lib/server/domains/conversation-attributes/ai-classification.service', () => ({
  classifyConversationAttributes: vi.fn().mockResolvedValue([]),
}))

let conversationRow: Record<string, unknown> = {
  id: 'conversation_1',
  customAttributes: null,
  status: 'closed',
}

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(table: string): Record<string, unknown> {
    let setPayload: Record<string, unknown> = {}
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.set = (payload: Record<string, unknown>) => {
      setPayload = payload
      return c
    }
    c.values = (payload: Record<string, unknown>) => {
      insertCalls.push(table)
      setPayload = payload
      return c
    }
    c.where = () => c
    c.limit = async () => [conversationRow]
    // update(conversations).set({status,...}).where().returning() reflects the
    // requested status, matching the real UPDATE this mocks. update/insert on
    // any other table (e.g. the system-notice insert into conversationMessages)
    // just echoes its own payload back.
    c.returning = async () => [
      table === 'conversations' ? { ...conversationRow, ...setPayload } : setPayload,
    ]
    return c
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      select: () => chain('select'),
      update: (t: { __name?: string }) => chain(t?.__name ?? 'conversations'),
      insert: (t: { __name?: string }) => chain(t?.__name ?? 'conversationMessages'),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
  }
})

import { setConversationStatus } from '../conversation.service'

const convId = 'conversation_1' as ConversationId
const actor: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'service',
  segmentIds: new Set(),
}

beforeEach(() => {
  vi.clearAllMocks()
  insertCalls.length = 0
  conversationRow = { id: 'conversation_1', customAttributes: null, status: 'closed' }
})

describe('setConversationStatus reopen no-op (SF4)', () => {
  it('closed -> open is a REAL transition: posts the reopened notice and fires the webhook', async () => {
    const result = await setConversationStatus(convId, 'open', actor)
    expect(result.status).toBe('open')
    expect(insertCalls).toHaveLength(1) // the 'Conversation reopened' system message
    expect(emitConversationStatusChanged).toHaveBeenCalledTimes(1)
    expect(emitConversationStatusChanged.mock.calls[0][2]).toBe('closed') // previous status
  })

  it('open -> open is a no-op: no duplicate transcript notice, no re-fired webhook', async () => {
    conversationRow = { id: 'conversation_1', customAttributes: null, status: 'open' }
    const result = await setConversationStatus(convId, 'open', actor)
    expect(result.status).toBe('open')
    expect(insertCalls).toHaveLength(0) // no system message posted
    expect(emitConversationStatusChanged).not.toHaveBeenCalled()
  })
})
