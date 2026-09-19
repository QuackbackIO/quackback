/**
 * Run records never reach a visitor (QUINN-PRODUCT Step 11, P8).
 *
 * The inspector reads a lot that a customer must never see: dispositions,
 * fences, evidence passages, snapshot hashes, receipts. This file is the guard
 * that fails when any of it turns up in something a visitor is sent, and it is
 * written to fail on a FIELD NAME rather than on a shape, so adding a run field
 * to a visitor DTO trips it even if the value happens to be null.
 *
 * Three surfaces are pinned, because they are the three ways a visitor is told
 * anything: the conversation update published to their own channel, the message
 * DTO, and the one frame a durable run is allowed to produce for them.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'

const publish = vi.fn()
vi.mock('../pubsub', () => ({ publish: (...args: unknown[]) => publish(...args) }))

import { conversationChannel, publishConversationUpdate } from '../conversation-channels'
import { durableActivityFrame } from '@/lib/server/domains/assistant/assistant-activity-snapshot'
import { toMessageDTO } from '@/lib/server/messages/message-core'

const conversationId = 'conversation_1' as ConversationId

/**
 * Every field the run inspector reads. None of them is a visitor's business,
 * and the list is deliberately the inspector's vocabulary rather than a
 * hand-picked subset, so a new run field added to a DTO is caught by name.
 */
const RUN_FIELDS = [
  'runId',
  'assistantRunId',
  'phase',
  'disposition',
  'errorReason',
  'triggerKey',
  'triggerKind',
  'inputRevision',
  'stateVersion',
  'attemptCount',
  'jobId',
  'jobLeaseToken',
  'snapshotId',
  'snapshot',
  'contentHash',
  'candidateHash',
  'behaviour',
  'evidence',
  'passage',
  'steps',
  'receipts',
  'approvals',
  'validation',
  'validator',
  'guidanceAppliedIds',
  'guidanceOmittedIds',
  'outcomeStatus',
  'reconciliationState',
  'replayStrategy',
  'queuedMs',
  'totalMs',
]

/** Every key anywhere in the value, including inside arrays and nested objects. */
function deepKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) deepKeys(entry, into)
    return into
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key)
      deepKeys(nested, into)
    }
  }
  return into
}

function expectNoRunFields(value: unknown, what: string): void {
  const keys = deepKeys(value)
  const leaked = RUN_FIELDS.filter((field) => keys.has(field))
  expect(leaked, `${what} carries run fields`).toEqual([])
}

const agentDto = {
  id: conversationId,
  status: 'open',
  priority: 'none',
  channel: 'messenger',
  subject: null,
  lastMessagePreview: 'hi',
  lastMessageAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  visitor: { principalId: 'principal_v', displayName: null, avatarUrl: null },
  assignedAgent: null,
  unreadCount: 0,
  visitorLastReadAt: null,
  agentLastReadAt: null,
  csatRating: null,
  visitorEmail: 'visitor@example.com',
  resolvedAt: null,
  endReason: null,
  endNote: 'internal end note',
  tags: [],
  sla: null,
} as unknown as ConversationDTO

describe('visitor payloads carry no run records', () => {
  it('the conversation update published to a visitor', () => {
    publish.mockClear()
    publishConversationUpdate(conversationId, agentDto)
    const visitorCall = publish.mock.calls.find(
      ([channel]) => channel === conversationChannel(conversationId)
    )
    expect(visitorCall).toBeDefined()
    const payload = visitorCall![1]
    expectNoRunFields(
      typeof payload === 'string' ? JSON.parse(payload) : payload,
      'the visitor conversation update'
    )
  })

  it('the message DTO', () => {
    const dto = toMessageDTO(
      {
        id: 'conversation_msg_1',
        conversationId,
        ticketId: null,
        senderType: 'agent',
        content: 'Here is the answer.',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        principalId: 'principal_quinn' as PrincipalId,
        attachments: [],
        citations: [{ type: 'article', id: 'article_1', title: 'Refunds', url: '/a' }],
        isInternal: false,
        contentJson: null,
        metadata: {},
        // The run pointer 0287 put on the row. It must not survive the mapping.
        assistantRunId: 'assistant_run_1',
      } as never,
      null,
      'principal_quinn' as PrincipalId
    )
    expectNoRunFields(dto, 'the visitor message DTO')
  })

  it('the reconnect frame a durable run produces', () => {
    const frame = durableActivityFrame(conversationId, {
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(Object.keys(frame).sort()).toEqual(['at', 'conversationId', 'kind', 'status'])
    expectNoRunFields(frame, 'the durable reconnect frame')
  })

  it('and still says a turn is in flight, which is the point of it', () => {
    const frame = durableActivityFrame(
      conversationId,
      { startedAt: null },
      new Date('2026-02-02T03:04:05.000Z')
    )
    expect(frame.status).toBe('thinking')
    expect(frame.at).toBe('2026-02-02T03:04:05.000Z')
  })
})
