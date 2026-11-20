/**
 * Routing claims a conversation with an UPDATE guarded on "still unassigned"
 * (assignRoutedConversation), so two routing attempts for the same
 * conversation (a racing first message, two agents going offline together)
 * can never both assign it. The attempt whose guarded update matches no row
 * posts no "Conversation assigned to ..." notice and emits no
 * conversation.assigned event; it re-broadcasts the current row instead.
 * Exercised through the offline requeue, the path that routes an existing row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

const publishConversationUpdate = vi.fn()
const emitConversationAssigned = vi.fn()
const routeConversation = vi.fn()

// Results the awaited query chains resolve to, in call order.
let results: unknown[][]
const insertPayloads: Record<string, unknown>[] = []

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
  authorFromInput: vi.fn(),
  resolveAuthor: vi.fn(),
}))

vi.mock('../routing', () => ({
  routeConversation: (...a: unknown[]) => routeConversation(...a),
}))

// The offline requeue runs only with routing on.
vi.mock('@/lib/server/domains/settings/settings.conversation-routing', () => ({
  getConversationRouting: async () => ({ enabled: true, strategy: 'auto_assign_active' }),
}))

vi.mock('@/lib/server/test-data', () => ({
  activeTestOwnerOf: vi.fn(async () => null),
  testOwnerOf: vi.fn(async () => null),
  notTestPrincipal: vi.fn(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    const next = async () => results.shift() ?? []
    for (const m of ['from', 'set', 'where', 'innerJoin', 'leftJoin', 'orderBy']) c[m] = () => c
    c.values = (payload: Record<string, unknown>) => {
      insertPayloads.push(payload)
      return c
    }
    c.limit = next
    c.returning = next
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      next().then(resolve, reject)
    return c
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      select: () => chain(),
      selectDistinct: () => chain(),
      update: () => chain(),
      insert: () => chain(),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    inArray: vi.fn(),
  }
})

import { requeueUnansweredOnAgentOffline } from '../conversation.service'

const offlineAgent = 'principal_offline' as PrincipalId
const winner = 'principal_online' as PrincipalId
const freed = {
  id: 'conversation_1',
  status: 'open',
  visitorPrincipalId: 'principal_visitor',
  assignedAgentPrincipalId: null,
  assignedTeamId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  insertPayloads.length = 0
  routeConversation.mockResolvedValue({
    assignedPrincipalId: winner,
    strategyId: 'auto_assign_active',
  })
})

describe('routing claim race (RTE-15)', () => {
  it('the attempt that loses the guarded claim posts no notice and emits no assignment', async () => {
    const claimedElsewhere = { ...freed, assignedAgentPrincipalId: 'principal_other' }
    results = [
      [{ id: freed.id, status: 'open' }], // the offline agent's assigned threads
      [], // none answered
      [freed], // freed by the requeue
      [], // the guarded claim matches no row: someone else won
      [claimedElsewhere], // the current row, re-read for the broadcast
    ]
    await requeueUnansweredOnAgentOffline(offlineAgent)

    expect(routeConversation).toHaveBeenCalledTimes(1)
    expect(insertPayloads).toEqual([])
    expect(emitConversationAssigned).not.toHaveBeenCalled()
    // The broadcast carries the current row (the other claim), not "unassigned".
    expect(publishConversationUpdate).toHaveBeenCalledTimes(1)
    expect(publishConversationUpdate.mock.calls[0][0]).toBe(freed.id)
  })

  it('the attempt that wins the claim posts one notice and emits the assignment', async () => {
    results = [
      [{ id: freed.id, status: 'open' }],
      [],
      [freed],
      [{ ...freed, assignedAgentPrincipalId: winner }], // the guarded claim matched
      [{ displayName: 'Ben Agent' }], // the assignee's name for the notice
      [], // the notice insert's returning()
    ]
    await requeueUnansweredOnAgentOffline(offlineAgent)

    expect(insertPayloads).toHaveLength(1)
    expect(insertPayloads[0]).toMatchObject({
      senderType: 'system',
      content: 'Conversation assigned to Ben Agent',
      isInternal: true,
    })
    expect(emitConversationAssigned).toHaveBeenCalledTimes(1)
  })
})
