/**
 * The reply preview read behind the widget's card above the closed launcher:
 * widget sessions only, nothing when conversations are off or nothing is
 * unread, plain text from the newest unread replies, and the newest reply's
 * author, shown as the team alone when it reads as the team.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let handler: (() => Promise<unknown>) | null = null
    const fn = () => {
      if (!handler) throw new Error('handler not registered')
      return handler()
    }
    fn.validator = () => fn
    fn.handler = (h: () => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  isConversationsEnabled: vi.fn(),
  listVisitorUnreadReplies: vi.fn(),
  loadAuthors: vi.fn(),
  getSupportTeamName: vi.fn(),
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
  getOptionalAuth: vi.fn(),
  hasAuthCredentials: vi.fn(),
  requireAuth: vi.fn(),
  assertPermission: vi.fn(),
  policyActorFromAuth: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: hoisted.isConversationsEnabled,
  isConversationsEnabledFor: () => hoisted.isConversationsEnabled(),
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listVisitorUnreadReplies: hoisted.listVisitorUnreadReplies,
}))
vi.mock('@/lib/server/domains/principals/principal-display', () => ({
  loadAuthors: hoisted.loadAuthors,
  getSupportTeamName: hoisted.getSupportTeamName,
}))

import { runGetReplyPreview } from '../conversation'

const widgetCtx = { principal: { id: 'principal_v', role: 'user' }, scope: 'widget' } as never

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.isConversationsEnabled.mockResolvedValue(true)
  hoisted.getSupportTeamName.mockResolvedValue('Acme')
  hoisted.loadAuthors.mockResolvedValue(
    new Map([
      [
        'principal_alex',
        {
          principalId: 'principal_alex',
          displayName: 'Alex Kim',
          avatarUrl: 'https://cdn.example.com/a.png',
        },
      ],
    ])
  )
  hoisted.listVisitorUnreadReplies.mockResolvedValue(
    listed(
      [
        row(1, '**Thanks** for waiting', 'principal_alex'),
        row(2, '<p>It is fixed now</p>', 'principal_alex'),
      ],
      4
    )
  )
})

type Row = {
  id: string
  content: string
  createdAt: Date
  principalId: string | null
  cited: boolean
}

function row(n: number, content: string, principalId: string | null, cited = false): Row {
  return {
    id: `conversation_msg_${n}`,
    content,
    createdAt: new Date(`2026-11-20T10:0${n}:00.000Z`),
    principalId,
    cited,
  }
}

/** The read's result: the card's rows, and the same rows as the recent list
 *  unless given. */
function listed(
  messages: Row[],
  count = messages.length,
  recent?: Array<Row & { conversationId: string }>
) {
  return {
    conversationId: 'conversation_1',
    count,
    messages,
    recent: recent ?? messages.map((m) => ({ ...m, conversationId: 'conversation_1' })),
  }
}

describe('runGetReplyPreview', () => {
  it('reads nothing without a widget session', async () => {
    expect(await runGetReplyPreview(null)).toBeNull()
    expect(
      await runGetReplyPreview({ principal: { id: 'principal_v', role: 'user' } } as never)
    ).toBeNull()
    expect(hoisted.listVisitorUnreadReplies).not.toHaveBeenCalled()
  })

  it('reads nothing when conversations are off', async () => {
    hoisted.isConversationsEnabled.mockResolvedValue(false)
    expect(await runGetReplyPreview(widgetCtx)).toBeNull()
    expect(hoisted.listVisitorUnreadReplies).not.toHaveBeenCalled()
  })

  it('is null when nothing is unread', async () => {
    hoisted.listVisitorUnreadReplies.mockResolvedValue(null)
    expect(await runGetReplyPreview(widgetCtx)).toBeNull()
  })

  it('returns plain text, the count, the newest reply author and the recent replies', async () => {
    const alex = { name: 'Alex Kim', avatarUrl: 'https://cdn.example.com/a.png' }
    expect(await runGetReplyPreview(widgetCtx)).toEqual({
      conversationId: 'conversation_1',
      author: alex,
      teamName: 'Acme',
      count: 4,
      messages: [
        {
          id: 'conversation_msg_1',
          text: 'Thanks for waiting',
          createdAt: '2026-11-20T10:01:00.000Z',
        },
        {
          id: 'conversation_msg_2',
          text: 'It is fixed now',
          createdAt: '2026-11-20T10:02:00.000Z',
        },
      ],
      recent: [
        {
          id: 'conversation_msg_1',
          conversationId: 'conversation_1',
          author: alex,
          text: 'Thanks for waiting',
        },
        {
          id: 'conversation_msg_2',
          conversationId: 'conversation_1',
          author: alex,
          text: 'It is fixed now',
        },
      ],
    })
    expect(hoisted.listVisitorUnreadReplies).toHaveBeenCalledWith('principal_v', 3)
    expect(hoisted.loadAuthors).toHaveBeenCalledWith(
      ['principal_alex', 'principal_alex', 'principal_alex', 'principal_alex'],
      { forCustomer: true }
    )
  })

  it('reports replies in other conversations, each with its own author', async () => {
    hoisted.listVisitorUnreadReplies.mockResolvedValue(
      listed([row(3, 'Newest', 'principal_alex')], 1, [
        { ...row(1, 'From the assistant', 'principal_bot'), conversationId: 'conversation_2' },
        { ...row(3, 'Newest', 'principal_alex'), conversationId: 'conversation_1' },
      ])
    )
    const preview = await runGetReplyPreview(widgetCtx)
    expect(preview!.recent).toEqual([
      {
        id: 'conversation_msg_1',
        conversationId: 'conversation_2',
        author: { name: null, avatarUrl: null },
        text: 'From the assistant',
      },
      expect.objectContaining({ id: 'conversation_msg_3', conversationId: 'conversation_1' }),
    ])
  })

  it('keeps only the newest author\u2019s latest run of replies in the card', async () => {
    hoisted.listVisitorUnreadReplies.mockResolvedValue(
      listed([
        row(1, 'From Alex', 'principal_alex'),
        row(2, 'From the assistant', 'principal_bot'),
        row(3, 'Also from the assistant', 'principal_bot'),
      ])
    )
    const preview = await runGetReplyPreview(widgetCtx)
    expect(preview!.messages.map((m) => m.text)).toEqual([
      'From the assistant',
      'Also from the assistant',
    ])
    expect(preview!.count).toBe(3)
  })

  it('shows a reply that reads as the team as the team alone', async () => {
    hoisted.loadAuthors.mockResolvedValue(
      new Map([
        ['principal_alex', { principalId: 'principal_alex', displayName: 'Acme', avatarUrl: null }],
      ])
    )
    const preview = await runGetReplyPreview(widgetCtx)
    expect(preview?.author).toEqual({ name: null, avatarUrl: null })
  })

  it("drops an assistant reply's source markers, and keeps brackets in other replies", async () => {
    hoisted.listVisitorUnreadReplies.mockResolvedValue(
      listed([
        row(1, 'Step [1] of the guide', null),
        row(2, 'Export from Settings [1] and import it again [2].', null, true),
      ])
    )
    const preview = await runGetReplyPreview(widgetCtx)
    expect(preview!.messages.map((m) => m.text)).toEqual([
      'Step [1] of the guide',
      'Export from Settings and import it again.',
    ])
  })

  it('caps a long reply between code points, with an ellipsis', async () => {
    const long = 'a'.repeat(1998) + '\u{1F680}' + 'tail'
    hoisted.listVisitorUnreadReplies.mockResolvedValue(listed([row(1, long, null)]))
    const preview = await runGetReplyPreview(widgetCtx)
    const text = preview!.messages[0].text
    expect(Array.from(text)).toHaveLength(2000)
    expect(text.endsWith('\u{1F680}…')).toBe(true)
    expect(Array.from(preview!.recent[0].text)).toHaveLength(280)
    expect(preview!.recent[0].text.endsWith('…')).toBe(true)
    expect(preview!.author).toEqual({ name: null, avatarUrl: null })
  })

  it('keeps text at the cap whole', async () => {
    const exact = 'b'.repeat(2000)
    hoisted.listVisitorUnreadReplies.mockResolvedValue(listed([row(1, exact, null)]))
    const preview = await runGetReplyPreview(widgetCtx)
    expect(preview!.messages[0].text).toBe(exact)
  })
})
