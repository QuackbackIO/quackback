/**
 * Tests for syncConversationMessageMentions — server-side persistence + in-app
 * notification of @-mentions inside an internal conversation note.
 *
 * Mirrors syncPostMentions but: notes are immutable (no delete/diff path),
 * mentions are TEAM-ONLY (admin/member; visitors and service principals are
 * dropped), and alerts are in-app only (no email/event fan-out).
 *
 * Mock strategy: `db.select().from(principal).where()` resolves the
 * eligibility rows; the insert chain captures rows and returns a
 * test-controlled `insertReturning`; createNotificationsBatch is spied so we
 * assert exactly who gets alerted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationMessageId, ConversationId, PrincipalId } from '@quackback/ids'

const PRINCIPAL_TABLE = { __tag: 'principal' } as const
const CONVERSATION_MENTIONS_TABLE = { __tag: 'conversationMessageMentions' } as const

// Per-test state.
let eligibilityRows: Array<{ id: string; type: string; role: string | null }> = []
let insertReturning: Array<{ principalId: string }> = []
const insertCalls: { rows: Array<{ conversationMessageId: string; principalId: string }> }[] = []
const updateNotifiedCalls: { principalIds: string[] }[] = []

function makeSelect() {
  return {
    from: (_table: unknown) => ({
      where: (..._args: unknown[]) => Promise.resolve(eligibilityRows),
    }),
  }
}

function makeInsertChain() {
  const chain = {
    values: (rows: Array<{ conversationMessageId: string; principalId: string }>) => {
      insertCalls.push({ rows })
      return chain
    },
    onConflictDoNothing: () => chain,
    // Returns exactly the rows the test says were newly inserted — an empty
    // array models onConflictDoNothing skipping an already-present mention.
    returning: () => Promise.resolve(insertReturning),
  }
  return chain
}

function makeUpdateChain() {
  const chain = {
    set: (_values: unknown) => chain,
    where: (whereArg: { __principalIds?: string[] }) => {
      updateNotifiedCalls.push({ principalIds: whereArg?.__principalIds ?? [] })
      return Promise.resolve(undefined)
    },
  }
  return chain
}

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (_cols: unknown) => makeSelect(),
    insert: (_table: unknown) => makeInsertChain(),
    update: (_table: unknown) => makeUpdateChain(),
  },
  principal: PRINCIPAL_TABLE,
  conversationMessageMentions: CONVERSATION_MENTIONS_TABLE,
  eq: vi.fn((col: unknown, val: unknown) => ({ __eq: { col, val } })),
  and: vi.fn((...args: Array<{ __principalIds?: string[] }>) => {
    let principalIds: string[] | undefined
    for (const a of args) if (Array.isArray(a?.__principalIds)) principalIds = a.__principalIds
    return { __principalIds: principalIds }
  }),
  inArray: vi.fn((_col: unknown, vals: unknown[]) => ({ __principalIds: vals as string[] })),
}))

const createNotificationsBatch = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/server/domains/notifications/notification.service', () => ({
  createNotificationsBatch: (...args: unknown[]) => createNotificationsBatch(...args),
}))

const { syncConversationMessageMentions } = await import('../sync-conversation-mentions')

const MESSAGE_ID = 'conversation_msg_test' as ConversationMessageId
const CONVERSATION_ID = 'conversation_test' as ConversationId
const AUTHOR = 'principal_author' as PrincipalId
const P1 = 'principal_one' as PrincipalId
const P2 = 'principal_two' as PrincipalId
const VISITOR = 'principal_visitor' as PrincipalId
const SERVICE = 'principal_service' as PrincipalId

function teamRow(id: string) {
  return { id, type: 'user', role: 'member' }
}

function defaultInput(
  overrides: Partial<Parameters<typeof syncConversationMessageMentions>[0]> = {}
) {
  return {
    conversationMessageId: MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    mentionedIds: new Set<PrincipalId>(),
    authorPrincipalId: AUTHOR,
    authorName: 'Jane',
    content: 'please take a look',
    ...overrides,
  }
}

describe('syncConversationMessageMentions', () => {
  beforeEach(() => {
    eligibilityRows = []
    insertReturning = []
    insertCalls.length = 0
    updateNotifiedCalls.length = 0
    createNotificationsBatch.mockClear()
  })

  it('persists and notifies newly-mentioned teammates', async () => {
    eligibilityRows = [teamRow(P1), teamRow(P2)]
    insertReturning = [{ principalId: P1 }, { principalId: P2 }]

    await syncConversationMessageMentions(defaultInput({ mentionedIds: new Set([P1, P2]) }))

    // One insert carrying both mentions, keyed to the message.
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].rows).toEqual([
      { conversationMessageId: MESSAGE_ID, principalId: P1 },
      { conversationMessageId: MESSAGE_ID, principalId: P2 },
    ])
    // Both teammates alerted, with a chat_mention pointing at the conversation.
    expect(createNotificationsBatch).toHaveBeenCalledTimes(1)
    const batch = createNotificationsBatch.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch).toHaveLength(2)
    expect(batch[0]).toMatchObject({
      principalId: P1,
      type: 'chat_mention',
      metadata: { conversationId: CONVERSATION_ID },
    })
  })

  it('drops non-team principals (visitors and service principals) server-side', async () => {
    // The query returns every mentioned principal; the service itself must drop
    // the visitor (role 'user') and the service principal (type 'service'),
    // inserting/notifying only the genuine teammate.
    eligibilityRows = [
      teamRow(P1),
      { id: VISITOR, type: 'user', role: 'user' },
      { id: SERVICE, type: 'service', role: 'admin' },
    ]
    insertReturning = [{ principalId: P1 }]

    await syncConversationMessageMentions(
      defaultInput({ mentionedIds: new Set([P1, VISITOR, SERVICE]) })
    )

    expect(insertCalls[0].rows).toEqual([{ conversationMessageId: MESSAGE_ID, principalId: P1 }])
    const batch = createNotificationsBatch.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch.map((n) => n.principalId)).toEqual([P1])
  })

  it('persists a self-mention but never notifies the author', async () => {
    eligibilityRows = [teamRow(AUTHOR), teamRow(P1)]
    insertReturning = [{ principalId: AUTHOR }, { principalId: P1 }]

    await syncConversationMessageMentions(defaultInput({ mentionedIds: new Set([AUTHOR, P1]) }))

    // Both rows persist (the author can mention themselves in a note)…
    expect(insertCalls[0].rows.map((r) => r.principalId)).toEqual([AUTHOR, P1])
    // …but only the teammate is alerted.
    const batch = createNotificationsBatch.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(batch.map((n) => n.principalId)).toEqual([P1])
  })

  it('does nothing when no one is mentioned', async () => {
    await syncConversationMessageMentions(defaultInput({ mentionedIds: new Set() }))
    expect(insertCalls).toHaveLength(0)
    expect(createNotificationsBatch).not.toHaveBeenCalled()
  })

  it('does not re-notify when the mention already existed (idempotent re-sync)', async () => {
    eligibilityRows = [teamRow(P1)]
    insertReturning = [] // onConflictDoNothing inserted nothing — already present.

    await syncConversationMessageMentions(defaultInput({ mentionedIds: new Set([P1]) }))

    // Insert was attempted, but since nothing was newly inserted, no alert.
    expect(insertCalls).toHaveLength(1)
    expect(createNotificationsBatch).not.toHaveBeenCalled()
  })

  it('swallows a thrown dependency (the note is saved even if mention sync fails)', async () => {
    // The note is already committed by the caller; a mid-flight failure here
    // must never reject into the caller's success path or lose the note.
    eligibilityRows = [teamRow(P1)]
    insertReturning = [{ principalId: P1 }]
    createNotificationsBatch.mockRejectedValueOnce(new Error('db down'))

    await expect(
      syncConversationMessageMentions(defaultInput({ mentionedIds: new Set([P1]) }))
    ).resolves.toBeUndefined()
    // notifiedAt is stamped only after delivery, so a failed batch leaves the
    // rows un-watermarked rather than claiming an alert that never landed.
    expect(updateNotifiedCalls).toHaveLength(0)
  })
})
