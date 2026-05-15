/**
 * Tests for syncPostMentions — reconciliation + dispatch of post.mentioned.
 *
 * Mocking strategy: dispatches a `from(table)` switch inside `db.select()`
 * so the eligibility query (from principal) and existing-rows query
 * (from postMentions) can return distinct results without ordering-sensitive
 * mockReturnValueOnce chains. Each test resets state in beforeEach.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PrincipalId } from '@quackback/ids'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const PRINCIPAL_TABLE = { __tag: 'principal' } as const
const POST_MENTIONS_TABLE = { __tag: 'postMentions' } as const

// Per-test state for the two select branches.
let eligibilityRows: Array<{ id: string; type: string; role: string | null }> = []
let existingRows: Array<{ principalId: string; notifiedAt: Date | null }> = []

// Captured side effects from the chain mocks.
const insertCalls: { rows: Array<{ postId: string; principalId: string }> }[] = []
const deleteCalls: { principalIds: string[] }[] = []
const updateNotifiedCalls: { principalId: string }[] = []

// Whatever the insert chain's .returning() should yield (test-controlled).
let insertReturning: Array<{ principalId: string }> = []

// The implementation calls `.select({...}).from(table)`. Branch on the table
// passed to `.from()` so we can return the right rows for each query.
function makeSelect() {
  return {
    from: (table: unknown) => ({
      where: (..._args: unknown[]) => {
        if (table === PRINCIPAL_TABLE) return Promise.resolve(eligibilityRows)
        if (table === POST_MENTIONS_TABLE) return Promise.resolve(existingRows)
        return Promise.resolve([])
      },
    }),
  }
}

function makeInsertChain() {
  let pending: Array<{ postId: string; principalId: string }> = []
  const chain = {
    values: (rows: Array<{ postId: string; principalId: string }>) => {
      pending = rows
      insertCalls.push({ rows })
      return chain
    },
    onConflictDoNothing: () => chain,
    returning: () => Promise.resolve(insertReturning.length > 0 ? insertReturning : pending),
  }
  return chain
}

function makeDeleteChain() {
  return {
    where: (whereArg: { __principalIds?: string[] }) => {
      deleteCalls.push({ principalIds: whereArg?.__principalIds ?? [] })
      return Promise.resolve(undefined)
    },
  }
}

function makeUpdateChain() {
  let capturedPrincipalId = ''
  const chain = {
    set: (_values: unknown) => chain,
    where: (whereArg: { __principalId?: string }) => {
      capturedPrincipalId = whereArg?.__principalId ?? ''
      updateNotifiedCalls.push({ principalId: capturedPrincipalId })
      return Promise.resolve(undefined)
    },
  }
  return chain
}

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (_cols: unknown) => makeSelect(),
    insert: (_table: unknown) => makeInsertChain(),
    delete: (_table: unknown) => makeDeleteChain(),
    update: (_table: unknown) => makeUpdateChain(),
  },
  // Column references — the implementation uses them only as eq/and/inArray
  // arguments, which our mocks consume opaquely.
  principal: PRINCIPAL_TABLE,
  postMentions: POST_MENTIONS_TABLE,
  // Operators: we capture only what tests need to differentiate the
  // delete/update WHERE clauses. and()/eq()/inArray() return a synthetic
  // object the chain mocks can inspect.
  eq: vi.fn((col: unknown, val: unknown) => ({ __eq: { col, val } })),
  and: vi.fn(
    (...args: Array<{ __eq?: { col: unknown; val: unknown }; __principalIds?: string[] }>) => {
      let principalId: string | undefined
      let principalIds: string[] | undefined
      for (const a of args) {
        const v = a?.__eq?.val
        // The principal-eq branch carries a single principalId string.
        if (typeof v === 'string' && v.startsWith('principal_')) {
          principalId = v
        }
        if (Array.isArray(a?.__principalIds)) {
          principalIds = a.__principalIds
        }
      }
      return { __principalId: principalId, __principalIds: principalIds }
    }
  ),
  inArray: vi.fn((_col: unknown, vals: unknown[]) => ({ __principalIds: vals as string[] })),
}))

const dispatchPostMentioned = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../events/dispatch', () => ({
  dispatchPostMentioned: (...args: unknown[]) => dispatchPostMentioned(...args),
}))

// Import after mocks
const { syncPostMentions } = await import('../sync-post-mentions')

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const POST_ID = 'post_test' as PostId
const ACTOR_PRINCIPAL = 'principal_actor' as PrincipalId
const P1 = 'principal_one' as PrincipalId
const P2 = 'principal_two' as PrincipalId
const P3 = 'principal_three' as PrincipalId

const ACTOR = {
  type: 'user' as const,
  principalId: ACTOR_PRINCIPAL,
  userId: 'user_actor',
  email: 'actor@example.com',
}

function userRow(id: string) {
  return { id, type: 'user', role: 'member' }
}

function defaultInput(overrides: Partial<Parameters<typeof syncPostMentions>[0]> = {}) {
  return {
    postId: POST_ID,
    postTitle: 'Hello',
    postUrl: 'https://example.com/p/hello',
    mentionedIds: new Set<PrincipalId>(),
    excerptByPrincipalId: new Map<PrincipalId, string>(),
    actor: ACTOR,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncPostMentions', () => {
  beforeEach(() => {
    eligibilityRows = []
    existingRows = []
    insertCalls.length = 0
    deleteCalls.length = 0
    updateNotifiedCalls.length = 0
    insertReturning = []
    dispatchPostMentioned.mockClear()
  })

  it('dispatches one event per newly inserted mention', async () => {
    eligibilityRows = [userRow(P1), userRow(P2)]
    existingRows = []
    insertReturning = [{ principalId: P1 }, { principalId: P2 }]

    await syncPostMentions(
      defaultInput({
        mentionedIds: new Set([P1, P2]),
        excerptByPrincipalId: new Map([
          [P1, 'first excerpt'],
          [P2, 'second excerpt'],
        ]),
      })
    )

    expect(dispatchPostMentioned).toHaveBeenCalledTimes(2)
    const targets = dispatchPostMentioned.mock.calls.map((c) => c[1].mentionedPrincipalId).sort()
    expect(targets).toEqual([P1, P2].sort())
    // Inserts contain both, no deletes happened.
    expect(insertCalls.length).toBe(1)
    expect(insertCalls[0].rows.map((r) => r.principalId).sort()).toEqual([P1, P2].sort())
    expect(deleteCalls.length).toBe(0)
    // Each new mention got its watermark set.
    expect(updateNotifiedCalls.map((c) => c.principalId).sort()).toEqual([P1, P2].sort())
  })

  it('does not re-dispatch for principals already in post_mentions', async () => {
    // P1 already exists (already-notified), P2 is fresh.
    eligibilityRows = [userRow(P1), userRow(P2)]
    existingRows = [{ principalId: P1, notifiedAt: new Date('2024-01-01') }]
    insertReturning = [{ principalId: P2 }]

    await syncPostMentions(
      defaultInput({
        mentionedIds: new Set([P1, P2]),
        excerptByPrincipalId: new Map([[P2, 'fresh']]),
      })
    )

    expect(dispatchPostMentioned).toHaveBeenCalledTimes(1)
    expect(dispatchPostMentioned.mock.calls[0][1].mentionedPrincipalId).toBe(P2)
    // Only P2 was inserted.
    expect(insertCalls[0].rows.map((r) => r.principalId)).toEqual([P2])
    expect(deleteCalls.length).toBe(0)
  })

  it('skips dispatch for self-mention but still records the row', async () => {
    eligibilityRows = [userRow(ACTOR_PRINCIPAL), userRow(P1)]
    existingRows = []
    insertReturning = [{ principalId: ACTOR_PRINCIPAL }, { principalId: P1 }]

    await syncPostMentions(
      defaultInput({
        mentionedIds: new Set([ACTOR_PRINCIPAL as unknown as PrincipalId, P1]),
        excerptByPrincipalId: new Map([[P1, 'hi']]),
      })
    )

    expect(dispatchPostMentioned).toHaveBeenCalledTimes(1)
    expect(dispatchPostMentioned.mock.calls[0][1].mentionedPrincipalId).toBe(P1)
    // Both rows were inserted (self-mention is still recorded).
    expect(insertCalls[0].rows.map((r) => r.principalId).sort()).toEqual(
      [ACTOR_PRINCIPAL as string, P1 as string].sort()
    )
    // Both got notifiedAt watermark set (self-mention via the skip-branch).
    expect(updateNotifiedCalls.map((c) => c.principalId).sort()).toEqual(
      [ACTOR_PRINCIPAL as string, P1 as string].sort()
    )
  })

  it('removes rows for principals no longer mentioned (and does not dispatch)', async () => {
    // P1 was previously mentioned, but mentionedIds now only has P2.
    eligibilityRows = [userRow(P2)]
    existingRows = [{ principalId: P1, notifiedAt: new Date('2024-01-01') }]
    insertReturning = [{ principalId: P2 }]

    await syncPostMentions(
      defaultInput({
        mentionedIds: new Set([P2]),
        excerptByPrincipalId: new Map([[P2, 'still here']]),
      })
    )

    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0].principalIds).toEqual([P1])
    // Only P2 (the new one) dispatched.
    expect(dispatchPostMentioned).toHaveBeenCalledTimes(1)
    expect(dispatchPostMentioned.mock.calls[0][1].mentionedPrincipalId).toBe(P2)
  })

  it('does not double-notify on a no-op edit', async () => {
    // mentionedIds matches what's already in post_mentions exactly.
    eligibilityRows = [userRow(P1), userRow(P2)]
    existingRows = [
      { principalId: P1, notifiedAt: new Date('2024-01-01') },
      { principalId: P2, notifiedAt: new Date('2024-01-01') },
    ]
    insertReturning = []

    await syncPostMentions(
      defaultInput({
        mentionedIds: new Set([P1, P2]),
        excerptByPrincipalId: new Map([
          [P1, 'a'],
          [P2, 'b'],
        ]),
      })
    )

    expect(dispatchPostMentioned).not.toHaveBeenCalled()
    expect(insertCalls.length).toBe(0)
    expect(deleteCalls.length).toBe(0)
    expect(updateNotifiedCalls.length).toBe(0)
  })

  it('filters out ineligible mentioned principals (anonymous/service)', async () => {
    // Three requested: P1=user, P2=anonymous, P3=service.
    eligibilityRows = [
      { id: P1, type: 'user', role: 'member' },
      { id: P2, type: 'anonymous', role: null },
      { id: P3, type: 'service', role: null },
    ]
    existingRows = []
    insertReturning = [{ principalId: P1 }]

    await syncPostMentions(
      defaultInput({
        mentionedIds: new Set([P1, P2, P3]),
        excerptByPrincipalId: new Map([
          [P1, 'allowed'],
          [P2, 'should not be sent'],
          [P3, 'service principal'],
        ]),
      })
    )

    // Only the eligible user was inserted.
    expect(insertCalls.length).toBe(1)
    expect(insertCalls[0].rows.map((r) => r.principalId)).toEqual([P1])
    // Only the eligible user got a dispatch.
    expect(dispatchPostMentioned).toHaveBeenCalledTimes(1)
    expect(dispatchPostMentioned.mock.calls[0][1].mentionedPrincipalId).toBe(P1)
  })

  it('dispatches normally when actor.principalId is undefined (no self-mention false match)', async () => {
    // When actor has no principalId (e.g., service integration), mentions should
    // still dispatch instead of being incorrectly skipped as self-mentions.
    eligibilityRows = [userRow(P1), userRow(P2)]
    existingRows = []
    insertReturning = [{ principalId: P1 }, { principalId: P2 }]

    const actorNoPrincipal = { type: 'service' as const, displayName: 'integration' }

    await syncPostMentions(
      defaultInput({
        mentionedIds: new Set([P1, P2]),
        excerptByPrincipalId: new Map([
          [P1, 'excerpt one'],
          [P2, 'excerpt two'],
        ]),
        actor: actorNoPrincipal,
      })
    )

    // Both mentions should dispatch despite actor having no principalId.
    expect(dispatchPostMentioned).toHaveBeenCalledTimes(2)
    const targets = dispatchPostMentioned.mock.calls.map((c) => c[1].mentionedPrincipalId).sort()
    expect(targets).toEqual([P1, P2].sort())
    // Both rows get inserted and marked notified.
    expect(insertCalls[0].rows.map((r) => r.principalId).sort()).toEqual([P1, P2].sort())
    expect(updateNotifiedCalls.map((c) => c.principalId).sort()).toEqual([P1, P2].sort())
  })
})
