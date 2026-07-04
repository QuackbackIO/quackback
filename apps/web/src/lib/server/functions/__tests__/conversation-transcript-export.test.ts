/**
 * Tests for exportConversationTranscriptFn (Phase 7 Messenger parity: transcript
 * export). The fn is thin orchestration over the pure renderer, so these pin the
 * two things the wrapper owns: the agent-only gate (internal notes must never
 * leak to a non-team principal) and full oldest-first paging of the history.
 * The renderer itself is left real (covered by conversation-transcript.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// createServerFn → directly-callable fns (mirrors conversation-bulk.test.ts).
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler(args)
    }
    fn.validator = () => fn
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  policyActorFromAuth: vi.fn(),
  assertConversationViewable: vi.fn(),
  listMessages: vi.fn(),
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}))

vi.mock('@/lib/server/logger', () => {
  const child = () => ({ ...hoisted.log, child })
  return { logger: { ...hoisted.log, child }, createLogger: () => ({ ...hoisted.log, child }) }
})
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: hoisted.assertConversationViewable,
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listMessages: hoisted.listMessages,
}))

import { exportConversationTranscriptFn } from '../conversation'

type Msg = {
  senderType: string
  content: string
  createdAt: string
  author: { displayName: string } | null
  isInternal: boolean
  isAssistant: boolean
  attachments: unknown[]
}
const message = (over: Partial<Msg>): Msg => ({
  senderType: 'visitor',
  content: 'hi',
  createdAt: '2026-07-04T09:15:30.000Z',
  author: { displayName: 'Alice' },
  isInternal: false,
  isAssistant: false,
  attachments: [],
  ...over,
})
const page = (messages: Msg[], over: { hasMore?: boolean; nextCursor?: string | null } = {}) => ({
  messages,
  hasMore: false,
  nextCursor: null,
  postSuggestions: new Map(),
  ...over,
})

const conversation = {
  id: 'conversation_1',
  subject: 'Billing',
  status: 'closed',
  channel: 'messenger',
  createdAt: new Date('2026-07-04T09:15:30.000Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_agent', role: 'admin' } })
  hoisted.policyActorFromAuth.mockResolvedValue({ principalId: 'principal_agent', role: 'admin' })
  hoisted.assertConversationViewable.mockResolvedValue(conversation)
  hoisted.listMessages.mockResolvedValue(page([message({})]))
})

describe('exportConversationTranscriptFn', () => {
  it('renders the transcript with conversation metadata and a download filename', async () => {
    const res = (await exportConversationTranscriptFn({
      data: { conversationId: 'conversation_1' },
    })) as { filename: string; mimeType: string; content: string }

    expect(res.filename).toBe('conversation-conversation_1.md')
    expect(res.mimeType).toBe('text/markdown')
    expect(res.content).toContain('# Conversation conversation_1')
    expect(res.content).toContain('- Subject: Billing')
    expect(res.content).toContain('Alice (visitor): hi')
    // Agent scope always pages with internal notes included.
    expect(hoisted.listMessages).toHaveBeenCalledWith(
      'conversation_1',
      expect.objectContaining({ includeInternal: true })
    )
  })

  it('refuses a non-team principal so internal notes cannot leak', async () => {
    hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_visitor', role: 'user' } })
    await expect(
      exportConversationTranscriptFn({ data: { conversationId: 'conversation_1' } })
    ).rejects.toThrow(/team members/i)
    // Bailed before touching the message history.
    expect(hoisted.listMessages).not.toHaveBeenCalled()
  })

  it('pages the full history oldest-first across multiple pages', async () => {
    hoisted.listMessages
      .mockResolvedValueOnce(
        page([message({ content: 'newer', createdAt: '2026-07-04T10:00:00.000Z' })], {
          hasMore: true,
          nextCursor: 'cursor_older',
        })
      )
      .mockResolvedValueOnce(
        page([message({ content: 'older', createdAt: '2026-07-04T09:00:00.000Z' })])
      )

    const res = (await exportConversationTranscriptFn({
      data: { conversationId: 'conversation_1' },
    })) as { content: string }

    expect(hoisted.listMessages).toHaveBeenCalledTimes(2)
    // The second page walks back from the first page's oldest cursor.
    expect(hoisted.listMessages).toHaveBeenNthCalledWith(
      2,
      'conversation_1',
      expect.objectContaining({ before: 'cursor_older' })
    )
    // Older block assembled before the newer block.
    expect(res.content.indexOf('older')).toBeLessThan(res.content.indexOf('newer'))
  })
})
