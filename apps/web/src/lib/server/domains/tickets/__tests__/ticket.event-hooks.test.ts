import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '@/lib/server/events/types'
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'

const mockResolvePairTicketIdForConversation = vi.fn()
const mockAutoReopenOnRequesterReply = vi.fn()
const mockStatusMovedSince = vi.fn()
const mockPublishTicketUpdated = vi.fn()
const mockEmitTicketStatusChanged = vi.fn()

const dbSelectQueue: unknown[][] = []
const mockTxUpdateReturning = vi.fn()
const mockTxInsertValues = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  const makeSelectChain = () => {
    const rows = dbSelectQueue.shift() ?? []
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => Promise.resolve(rows),
      limit: () => Promise.resolve(rows),
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(rows).then(resolve, reject),
    }
    return chain
  }
  return {
    ...actual,
    db: {
      select: () => makeSelectChain(),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          update: () => ({
            set: () => ({
              where: () => ({
                returning: () => mockTxUpdateReturning(),
              }),
            }),
          }),
          insert: () => ({
            values: (...args: unknown[]) => mockTxInsertValues(...args),
          }),
        }),
    },
  }
})

vi.mock('../pair-thread.service', () => ({
  resolvePairTicketIdForConversation: (...a: unknown[]) =>
    mockResolvePairTicketIdForConversation(...a),
}))
vi.mock('../ticket.service', () => ({
  autoReopenOnRequesterReply: (...a: unknown[]) => mockAutoReopenOnRequesterReply(...a),
}))
vi.mock('../ticket-activity.service', () => ({
  statusMovedSince: (...a: unknown[]) => mockStatusMovedSince(...a),
}))
vi.mock('../ticket-intake.service', () => ({
  publishTicketUpdated: (...a: unknown[]) => mockPublishTicketUpdated(...a),
}))
vi.mock('../ticket.webhooks', () => ({
  emitTicketStatusChanged: (...a: unknown[]) => mockEmitTicketStatusChanged(...a),
}))

import {
  autoReopenPairTicketFromEvent,
  autoResolveOnConversationClose,
  autoResolvePairTicketFromEvent,
} from '../ticket.event-hooks'

beforeEach(() => {
  vi.clearAllMocks()
  dbSelectQueue.length = 0
})

describe('ticket.event-hooks', () => {
  it('autoReopenPairTicketFromEvent reopens paired customer ticket on visitor message.created', async () => {
    mockResolvePairTicketIdForConversation.mockResolvedValue('ticket_pair_1')
    const event = {
      id: 'evt_1',
      type: 'message.created',
      timestamp: '2026-10-28T10:00:00.000Z',
      actor: { type: 'user', principalId: 'principal_v' },
      data: {
        conversation: { id: 'conv_1', status: 'open', channel: 'messenger' },
        message: {
          id: 'msg_1',
          conversationId: 'conv_1',
          senderType: 'visitor',
          authorPrincipalId: 'principal_v',
          content: 'Still happening',
          isInternal: false,
          createdAt: '2026-10-28T10:00:00.000Z',
        },
      },
    } as unknown as EventData

    await autoReopenPairTicketFromEvent(event)
    expect(mockResolvePairTicketIdForConversation).toHaveBeenCalledWith('conv_1')
    expect(mockAutoReopenOnRequesterReply).toHaveBeenCalledWith(
      'ticket_pair_1',
      'principal_v',
      new Date('2026-10-28T10:00:00.000Z')
    )
  })

  it('autoResolvePairTicketFromEvent transitions paired open customer ticket to resolved on non-spam conversation close', async () => {
    mockResolvePairTicketIdForConversation.mockResolvedValue('ticket_pair_1')
    mockStatusMovedSince.mockResolvedValue(false)

    // 1. conversations select
    dbSelectQueue.push([{ status: 'closed', endReason: 'resolved' }])
    // 2. tickets select
    dbSelectQueue.push([
      {
        id: 'ticket_pair_1',
        statusId: 'ticket_status_open',
        requesterPrincipalId: 'principal_v',
        deletedAt: null,
      },
    ])
    // 3. current ticketStatuses select
    dbSelectQueue.push([{ name: 'New', category: 'open', publicStage: 'received' }])
    // 4. closedStatuses select
    dbSelectQueue.push([
      { id: 'ticket_status_wont_do', name: "Won't do", publicStage: null },
      { id: 'ticket_status_resolved', name: 'Resolved', publicStage: 'resolved' },
    ])

    const updatedTicket = {
      id: 'ticket_pair_1',
      statusId: 'ticket_status_resolved',
      requesterPrincipalId: 'principal_v',
      resolvedAt: new Date('2026-10-28T11:00:00.000Z'),
    }
    mockTxUpdateReturning.mockResolvedValue([updatedTicket])
    mockTxInsertValues.mockResolvedValue(undefined)

    const event = {
      id: 'evt_2',
      type: 'conversation.status_changed',
      timestamp: '2026-10-28T11:00:00.000Z',
      actor: { type: 'user', principalId: 'principal_agent' },
      data: {
        conversation: { id: 'conv_1', status: 'closed', channel: 'messenger' },
        previousStatus: 'open',
        newStatus: 'closed',
      },
    } as unknown as EventData

    await autoResolvePairTicketFromEvent(event)

    expect(mockResolvePairTicketIdForConversation).toHaveBeenCalledWith('conv_1')
    expect(mockTxInsertValues).toHaveBeenCalledWith({
      ticketId: 'ticket_pair_1',
      principalId: 'principal_agent',
      type: 'status.changed',
      metadata: {
        fromId: 'ticket_status_open',
        fromName: 'New',
        toId: 'ticket_status_resolved',
        toName: 'Resolved',
        trigger: 'conversation_closed',
      },
    })
    expect(mockPublishTicketUpdated).toHaveBeenCalledWith(updatedTicket)
    expect(mockEmitTicketStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'principal_agent' }),
      updatedTicket,
      'open',
      'closed',
      'resolved',
      'received',
      'principal_v'
    )
  })

  it('autoResolveOnConversationClose skips resolution when conversation was ended as spam', async () => {
    dbSelectQueue.push([{ status: 'closed', endReason: 'spam' }])
    const didResolve = await autoResolveOnConversationClose(
      'ticket_pair_1' as TicketId,
      'conv_1' as ConversationId,
      'principal_agent' as PrincipalId,
      new Date('2026-10-28T11:00:00.000Z')
    )
    expect(didResolve).toBe(false)
    expect(mockTxUpdateReturning).not.toHaveBeenCalled()
    expect(mockPublishTicketUpdated).not.toHaveBeenCalled()
  })
})
