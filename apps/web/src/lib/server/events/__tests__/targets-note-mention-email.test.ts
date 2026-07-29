/**
 * Target resolution for the internal-note @-mention EMAIL builder
 * (getConversationNoteMentionedEmailTargets). The recipient set arrives on the
 * payload already team-filtered and author-excluded, so this builder only has
 * two jobs: find an address for each mentioned teammate, and honour the
 * `chat_mention` email preference. Both seams are mocked — the db select chain
 * yields the principal/user join rows behind resolveContactRecipients, and the
 * preference matrix is stubbed directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '../types'
import type { HookContext } from '../hook-context'

// --- db: chainable select() consuming a FIFO of result rows ---
const selectQueue: unknown[][] = []
function queueSelect(rows: unknown[]): void {
  selectQueue.push(rows)
}
const mockSelect = vi.fn((..._args: unknown[]) => {
  const rows = selectQueue.shift() ?? []
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'limit', 'orderBy']) {
    chain[m] = () => chain
  }
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(res, rej)
  return chain
})

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { select: (...args: unknown[]) => mockSelect(...args) },
}))

// --- preference matrix ---
const batchGetNotificationPreferences = vi.fn<(ids: string[]) => Promise<Map<string, unknown>>>()
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  batchGetNotificationPreferences: (ids: string[]) => batchGetNotificationPreferences(ids),
}))

const { getConversationNoteMentionedEmailTargets } = await import('../targets')

const context: HookContext = {
  portalBaseUrl: 'https://w.example',
  workspaceName: 'Acme Support',
  logoUrl: null,
}

beforeEach(() => {
  selectQueue.length = 0
  mockSelect.mockClear()
  batchGetNotificationPreferences.mockReset().mockResolvedValue(new Map())
})

function noteMentionedEvent(mentionedPrincipalIds: string[]): EventData {
  return {
    id: 'evt-note-mention',
    type: 'conversation.note_mentioned',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_author', displayName: 'Jane' },
    data: {
      conversationId: 'conversation_1',
      conversationMessageId: 'conversation_msg_1',
      mentionedPrincipalIds,
      authorName: 'Jane',
      preview: 'can you take a look at the refund policy here?',
    },
  } as EventData
}

describe('getConversationNoteMentionedEmailTargets', () => {
  it('emails each mentioned teammate with the note preview and an inbox link', async () => {
    queueSelect([
      { id: 'principal_one', email: 'one@acme.test', contactEmail: null },
      { id: 'principal_two', email: 'two@acme.test', contactEmail: null },
    ])

    const targets = await getConversationNoteMentionedEmailTargets(
      noteMentionedEvent(['principal_one', 'principal_two']),
      context
    )

    expect(targets).toEqual([
      {
        type: 'email',
        target: { email: 'one@acme.test', unsubscribeUrl: '' },
        config: {
          workspaceName: 'Acme Support',
          conversationId: 'conversation_1',
          authorName: 'Jane',
          preview: 'can you take a look at the refund policy here?',
          ctaUrl: 'https://w.example/admin/inbox?i=conversation_1',
          logoUrl: undefined,
          preferencesUrl: 'https://w.example/settings/preferences',
        },
      },
      {
        type: 'email',
        target: { email: 'two@acme.test', unsubscribeUrl: '' },
        config: expect.objectContaining({ conversationId: 'conversation_1' }),
      },
    ])
  })

  it('skips a teammate who muted chat mentions on the email channel', async () => {
    queueSelect([
      { id: 'principal_one', email: 'one@acme.test', contactEmail: null },
      { id: 'principal_two', email: 'two@acme.test', contactEmail: null },
    ])
    batchGetNotificationPreferences.mockResolvedValue(
      new Map<string, unknown>([['principal_two', { matrix: { chat_mention: { email: false } } }]])
    )

    const targets = await getConversationNoteMentionedEmailTargets(
      noteMentionedEvent(['principal_one', 'principal_two']),
      context
    )

    expect(targets).toHaveLength(1)
    expect((targets[0].target as { email: string }).email).toBe('one@acme.test')
  })

  it('skips a teammate who muted email globally', async () => {
    queueSelect([{ id: 'principal_one', email: 'one@acme.test', contactEmail: null }])
    batchGetNotificationPreferences.mockResolvedValue(
      new Map<string, unknown>([['principal_one', { emailMuted: true }]])
    )

    expect(
      await getConversationNoteMentionedEmailTargets(noteMentionedEvent(['principal_one']), context)
    ).toEqual([])
  })

  it('skips a teammate with no reachable address', async () => {
    queueSelect([{ id: 'principal_one', email: null, contactEmail: null }])

    expect(
      await getConversationNoteMentionedEmailTargets(noteMentionedEvent(['principal_one']), context)
    ).toEqual([])
  })

  it('is a no-op when no one is mentioned', async () => {
    expect(await getConversationNoteMentionedEmailTargets(noteMentionedEvent([]), context)).toEqual(
      []
    )
    expect(mockSelect).not.toHaveBeenCalled()
  })
})
