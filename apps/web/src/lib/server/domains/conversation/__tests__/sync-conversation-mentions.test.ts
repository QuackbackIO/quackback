/**
 * Tests for syncConversationMessageMentions — server-side persistence of
 * @-mentions inside an internal conversation note — and
 * markConversationMentionsNotified, the notifiedAt watermark helper.
 *
 * Mirrors syncPostMentions but: notes are immutable (no delete/diff path),
 * mentions are TEAM-ONLY (admin/member; visitors and service principals are
 * dropped).
 *
 * WO-3 slice 3: the in-app alert itself (previously a direct
 * createNotificationsBatch call here) now rides the `conversation.note_mentioned`
 * event/hook pipeline — this file asserts the dispatch call carries the exact
 * recipient/content characterization the direct write used to (recipients,
 * author-excluded); events/__tests__/notification-handler.test.ts and
 * events/__tests__/targets-assignment.test.ts assert the ported
 * title/body/metadata/target-resolution behavior on the event path. The
 * notifiedAt watermark moved out of this function entirely into
 * markConversationMentionsNotified, called by the hook AFTER its batch insert
 * succeeds — tested directly below.
 *
 * Mock strategy: `db.select().from(principal).where()` resolves the
 * eligibility rows; the insert chain captures rows and returns a
 * test-controlled `insertReturning`; dispatchConversationNoteMentioned is
 * spied so we assert exactly who gets alerted.
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

const dispatchConversationNoteMentioned = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchConversationNoteMentioned: (...args: unknown[]) =>
    dispatchConversationNoteMentioned(...args),
}))

const { syncConversationMessageMentions, markConversationMentionsNotified } =
  await import('../sync-conversation-mentions')

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
    dispatchConversationNoteMentioned.mockClear()
  })

  it('persists and dispatches conversation.note_mentioned for newly-mentioned teammates', async () => {
    eligibilityRows = [teamRow(P1), teamRow(P2)]
    insertReturning = [{ principalId: P1 }, { principalId: P2 }]

    await syncConversationMessageMentions(defaultInput({ mentionedIds: new Set([P1, P2]) }))

    // One insert carrying both mentions, keyed to the message (unchanged
    // behavior — the insert/eligibility path is not part of this move).
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].rows).toEqual([
      { conversationMessageId: MESSAGE_ID, principalId: P1 },
      { conversationMessageId: MESSAGE_ID, principalId: P2 },
    ])
    // Both teammates dispatched, carrying the note's context.
    expect(dispatchConversationNoteMentioned).toHaveBeenCalledTimes(1)
    const [actorArg, payloadArg] = dispatchConversationNoteMentioned.mock.calls[0]
    expect(actorArg).toEqual({ type: 'user', principalId: AUTHOR, displayName: 'Jane' })
    expect(payloadArg).toEqual({
      conversationId: CONVERSATION_ID,
      conversationMessageId: MESSAGE_ID,
      mentionedPrincipalIds: [P1, P2],
      authorName: 'Jane',
      preview: 'please take a look',
    })
  })

  it('drops non-team principals (visitors and service principals) server-side', async () => {
    // The query returns every mentioned principal; the service itself must drop
    // the visitor (role 'user') and the service principal (type 'service'),
    // inserting/dispatching only the genuine teammate.
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
    const payloadArg = dispatchConversationNoteMentioned.mock.calls[0][1]
    expect(payloadArg.mentionedPrincipalIds).toEqual([P1])
  })

  it('persists a self-mention but never dispatches for the author', async () => {
    eligibilityRows = [teamRow(AUTHOR), teamRow(P1)]
    insertReturning = [{ principalId: AUTHOR }, { principalId: P1 }]

    await syncConversationMessageMentions(defaultInput({ mentionedIds: new Set([AUTHOR, P1]) }))

    // Both rows persist (the author can mention themselves in a note)…
    expect(insertCalls[0].rows.map((r) => r.principalId)).toEqual([AUTHOR, P1])
    // …but only the teammate is dispatched.
    const payloadArg = dispatchConversationNoteMentioned.mock.calls[0][1]
    expect(payloadArg.mentionedPrincipalIds).toEqual([P1])
  })

  it('does nothing when no one is mentioned', async () => {
    await syncConversationMessageMentions(defaultInput({ mentionedIds: new Set() }))
    expect(insertCalls).toHaveLength(0)
    expect(dispatchConversationNoteMentioned).not.toHaveBeenCalled()
  })

  it('does not re-dispatch when the mention already existed (idempotent re-sync)', async () => {
    eligibilityRows = [teamRow(P1)]
    insertReturning = [] // onConflictDoNothing inserted nothing — already present.

    await syncConversationMessageMentions(defaultInput({ mentionedIds: new Set([P1]) }))

    // Insert was attempted, but since nothing was newly inserted, no dispatch.
    expect(insertCalls).toHaveLength(1)
    expect(dispatchConversationNoteMentioned).not.toHaveBeenCalled()
  })

  it('truncates the preview to 140 chars', async () => {
    eligibilityRows = [teamRow(P1)]
    insertReturning = [{ principalId: P1 }]
    const long = 'x'.repeat(200)

    await syncConversationMessageMentions(
      defaultInput({ mentionedIds: new Set([P1]), content: long })
    )

    const payloadArg = dispatchConversationNoteMentioned.mock.calls[0][1]
    expect((payloadArg.preview as string).length).toBeLessThanOrEqual(140)
  })

  it('swallows a thrown dependency (the note is saved even if dispatch fails)', async () => {
    // The note is already committed by the caller; a mid-flight failure here
    // must never reject into the caller's success path or lose the note.
    eligibilityRows = [teamRow(P1)]
    insertReturning = [{ principalId: P1 }]
    dispatchConversationNoteMentioned.mockRejectedValueOnce(new Error('queue down'))

    await expect(
      syncConversationMessageMentions(defaultInput({ mentionedIds: new Set([P1]) }))
    ).resolves.toBeUndefined()
  })
})

describe('markConversationMentionsNotified', () => {
  beforeEach(() => {
    updateNotifiedCalls.length = 0
  })

  it('stamps notifiedAt for exactly the given principal ids', async () => {
    await markConversationMentionsNotified(MESSAGE_ID, [P1, P2])
    expect(updateNotifiedCalls).toEqual([{ principalIds: [P1, P2] }])
  })

  it('is a no-op for an empty principal id list (no update issued)', async () => {
    await markConversationMentionsNotified(MESSAGE_ID, [])
    expect(updateNotifiedCalls).toHaveLength(0)
  })
})
