/**
 * toMessageDTO's block/blockReply projection (Phase C conversational block
 * layer, slice C-1) — mirrors the systemEvent precedent: metadata.block /
 * metadata.blockReply on the stored row project straight onto the DTO's
 * `block` / `blockReply` fields, defaulting to null when absent.
 */
import { describe, it, expect } from 'vitest'
import type { ConversationMessage } from '@/lib/server/db'
import { toMessageDTO } from '../message-core'

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'conversation_msg_1',
    conversationId: 'conversation_1',
    ticketId: null,
    principalId: 'principal_quinn',
    senderType: 'agent',
    content: 'Hi Jane!',
    contentJson: null,
    isInternal: false,
    attachments: null,
    citations: null,
    metadata: null,
    createdAt: new Date('2026-07-10T10:00:00Z'),
    updatedAt: null,
    deletedAt: null,
    deletedByPrincipalId: null,
    ...overrides,
  } as ConversationMessage
}

describe('toMessageDTO — block/blockReply projection', () => {
  it('projects metadata.block onto the DTO, null when absent', () => {
    expect(toMessageDTO(message(), null).block).toBeNull()

    const blockPayload = {
      v: 1 as const,
      runId: 'workflow_run_1',
      nodeId: 'n1',
      waiting: true,
      kind: 'buttons' as const,
      options: [{ key: 'yes', label: 'Yes' }],
      allowTyping: false,
    }
    const dto = toMessageDTO(message({ metadata: { block: blockPayload } }), null)
    expect(dto.block).toEqual(blockPayload)
  })

  it('projects metadata.blockReply onto the DTO, null when absent', () => {
    expect(toMessageDTO(message(), null).blockReply).toBeNull()

    const blockReply = {
      kind: 'buttons' as const,
      inReplyToMessageId: 'conversation_msg_block1',
      buttonKey: 'yes',
    }
    const dto = toMessageDTO(message({ senderType: 'visitor', metadata: { blockReply } }), null)
    expect(dto.blockReply).toEqual(blockReply)
  })

  it('isAssistant still derives independently of the block payload (same rule as an ordinary message)', () => {
    const blockPayload = {
      v: 1 as const,
      runId: 'workflow_run_1',
      nodeId: 'n1',
      waiting: false,
      kind: 'message' as const,
    }
    const dto = toMessageDTO(
      message({ principalId: 'principal_quinn', metadata: { block: blockPayload } }),
      null,
      'principal_quinn' as ConversationMessage['principalId']
    )
    expect(dto.isAssistant).toBe(true)
    expect(dto.block).toEqual(blockPayload)
  })
})
