import { describe, it, expect } from 'vitest'
import { serializeConversation, serializeMessage } from '../-serialize'
import type { ConversationDTO, ConversationMessageDTO } from '@/lib/shared/conversation/types'

const convBase = {
  id: 'conversation_1',
  status: 'open',
  priority: 'none',
  channel: 'messenger',
  subject: 'Hi',
  lastMessagePreview: 'Hi',
  lastMessageAt: '2026-06-05T00:00:00.000Z',
  createdAt: '2026-06-05T00:00:00.000Z',
  visitor: { principalId: 'principal_v', displayName: 'Sam', avatarUrl: null },
  assignedAgent: null,
  unreadCount: 0,
  visitorLastReadAt: null,
  agentLastReadAt: null,
  csatRating: null,
  visitorEmail: null,
  resolvedAt: null,
  tags: [],
} as unknown as ConversationDTO

describe('serializeConversation', () => {
  it('maps the public fields and strips a synthetic anon email', () => {
    const dto = { ...convBase, visitorEmail: 'temp-abc@anon.quackback.io' } as ConversationDTO
    expect(serializeConversation(dto)).toEqual({
      id: 'conversation_1',
      status: 'open',
      channel: 'messenger',
      priority: 'none',
      subject: 'Hi',
      visitorPrincipalId: 'principal_v',
      visitorEmail: null, // synthetic stripped by realEmail()
      assignedAgentPrincipalId: null,
      lastMessageAt: '2026-06-05T00:00:00.000Z',
      resolvedAt: null,
      createdAt: '2026-06-05T00:00:00.000Z',
    })
  })

  it('preserves a real captured email and the assigned agent id', () => {
    const dto = {
      ...convBase,
      visitorEmail: 'real@acme.com',
      assignedAgent: { principalId: 'principal_a', displayName: 'Agent', avatarUrl: null },
    } as ConversationDTO
    const out = serializeConversation(dto)
    expect(out.visitorEmail).toBe('real@acme.com')
    expect(out.assignedAgentPrincipalId).toBe('principal_a')
  })
})

describe('serializeMessage', () => {
  it('maps an agent message', () => {
    const m = {
      id: 'chat_msg_1',
      conversationId: 'conversation_1',
      senderType: 'agent',
      content: 'hello',
      createdAt: '2026-06-05T00:00:00.000Z',
      author: { principalId: 'principal_a', displayName: 'Agent', avatarUrl: null },
      attachments: [],
      isInternal: false,
      contentJson: null,
      viaEmail: false,
      systemEvent: null,
    } as unknown as ConversationMessageDTO
    expect(serializeMessage(m)).toEqual({
      id: 'chat_msg_1',
      conversationId: 'conversation_1',
      senderType: 'agent',
      isInternal: false,
      authorPrincipalId: 'principal_a',
      authorName: 'Agent',
      content: 'hello',
      createdAt: '2026-06-05T00:00:00.000Z',
    })
  })

  it('handles a system message with no author', () => {
    const m = {
      id: 'chat_msg_2',
      conversationId: 'conversation_1',
      senderType: 'system',
      content: 'Chat ended',
      createdAt: '2026-06-05T00:00:00.000Z',
      author: null,
      attachments: [],
      isInternal: false,
      contentJson: null,
      viaEmail: false,
      systemEvent: { kind: 'chat_ended' },
    } as unknown as ConversationMessageDTO
    const out = serializeMessage(m)
    expect(out.authorPrincipalId).toBeNull()
    expect(out.authorName).toBeNull()
  })
})
