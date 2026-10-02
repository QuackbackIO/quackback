import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const mockListConversationsForAgent = vi.fn()
const mockAssertConversationViewable = vi.fn()
const mockConversationToDTO = vi.fn()
const mockListMessages = vi.fn()
const mockSendAgentMessage = vi.fn()
const mockSetConversationStatus = vi.fn()

vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listConversationsForAgent: (...a: unknown[]) => mockListConversationsForAgent(...a),
  conversationToDTO: (...a: unknown[]) => mockConversationToDTO(...a),
  listMessages: (...a: unknown[]) => mockListMessages(...a),
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: (...a: unknown[]) => mockAssertConversationViewable(...a),
  sendAgentMessage: (...a: unknown[]) => mockSendAgentMessage(...a),
  setConversationStatus: (...a: unknown[]) => mockSetConversationStatus(...a),
}))

import { registerConversationTools } from '../conversations'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function collect(auth: McpAuthContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerConversationTools(fakeServer as never, auth)
  return handlers
}

const teamAuth = {
  principalId: 'principal_key',
  userId: 'user_1',
  name: 'Agent',
  email: 'agent@acme.com',
  role: 'admin' as const,
  authMethod: 'api-key' as const,
  scopes: ['read:chat', 'write:chat'],
} as unknown as McpAuthContext

beforeEach(() => vi.clearAllMocks())

describe('reply_to_conversation fileIds', () => {
  it('passes fileIds through as attachment refs the service resolves', async () => {
    mockSendAgentMessage.mockResolvedValue({
      message: { id: 'm_1', conversationId: 'conversation_1', createdAt: '2026-07-04T00:00:00Z' },
      conversation: { status: 'open' },
    })

    await collect(teamAuth).get('reply_to_conversation')!({
      conversationId: 'conversation_1',
      content: 'See attached',
      fileIds: ['file_1', 'file_2'],
    })

    const [, , , , attachments] = mockSendAgentMessage.mock.calls[0]
    expect(attachments).toEqual([{ fileId: 'file_1' }, { fileId: 'file_2' }])
  })

  it('passes no attachments when fileIds is omitted', async () => {
    mockSendAgentMessage.mockResolvedValue({
      message: { id: 'm_1', conversationId: 'conversation_1', createdAt: '2026-07-04T00:00:00Z' },
      conversation: { status: 'open' },
    })

    await collect(teamAuth).get('reply_to_conversation')!({
      conversationId: 'conversation_1',
      content: 'Hi',
    })

    const [, , , , attachments] = mockSendAgentMessage.mock.calls[0]
    expect(attachments).toBeUndefined()
  })
})
