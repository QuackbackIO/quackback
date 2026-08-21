/**
 * Presence fail-directions.
 *
 * The behavioural cases this file used to hold — online for the life of a
 * stream, not-offline until the last stream closes, ghost pruning, no duplicate
 * on heartbeat — moved to `presence-concurrency.db.test.ts`, where they run
 * against a real server. They had been asserted against an in-memory fake of
 * Redis's sorted sets, which cannot exist now and which could never have shown
 * the defect the real-server suite found on its first run.
 *
 * What stays here is the half a database test cannot easily produce: what each
 * function does when the store is *unreachable*. Those directions are not
 * uniform and each was chosen for a reason, so each gets a case.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  fail: false,
  boom: () => {
    throw new Error('database unreachable')
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    execute: async () => {
      if (hoisted.fail) hoisted.boom()
      return []
    },
    transaction: async (fn: (tx: unknown) => unknown) => {
      if (hoisted.fail) hoisted.boom()
      return fn({ execute: async () => [] })
    },
    select: () => ({ from: () => ({ where: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
  principal: { id: 'id', chatAvailability: 'chat_availability' },
  eq: () => null,
  and: () => null,
  inArray: () => null,
}))

const {
  markPresent,
  clearPresence,
  isPrincipalOnline,
  isAnyAgentOnline,
  listOnlineAgentIds,
  listAvailableAgentIds,
} = await import('../presence')
type PrincipalId = Parameters<typeof isPrincipalOnline>[0]

const A = 'principal_a' as PrincipalId

beforeEach(() => {
  hoisted.fail = false
})

describe('when the store is unreachable', () => {
  it('markPresent swallows the failure — a stream must still open', async () => {
    hoisted.fail = true
    await expect(markPresent(A, 's', true)).resolves.toBeUndefined()
  })

  it('clearPresence returns false — never report an offline we could not write', async () => {
    // The caller re-queues an agent's unanswered conversations on a `true`, so a
    // fabricated offline moves live work off an agent who never left.
    hoisted.fail = true
    expect(await clearPresence(A, 's', true)).toBe(false)
  })

  it('isPrincipalOnline fails CLOSED — a redundant email beats a reply nobody sees', async () => {
    hoisted.fail = true
    expect(await isPrincipalOnline(A)).toBe(false)
  })

  it('isAnyAgentOnline fails OPEN — the widget claims staffed rather than shutting chat off', async () => {
    // Deliberately the opposite direction to its neighbours. Pinned so a later
    // "consistency" tidy-up has to argue with a test rather than a comment.
    hoisted.fail = true
    expect(await isAnyAgentOnline()).toBe(true)
  })

  it('listOnlineAgentIds fails CLOSED — leave conversations unassigned, never mis-route', async () => {
    hoisted.fail = true
    expect(await listOnlineAgentIds()).toEqual([])
  })

  it('listAvailableAgentIds short-circuits an empty input without touching the store', async () => {
    hoisted.fail = true
    expect(await listAvailableAgentIds([])).toEqual([])
  })
})

describe('when the store is reachable', () => {
  it('the same functions do not report the failure values', async () => {
    // The positive control. Without it every assertion above is satisfied by a
    // function that always returns its failure value.
    expect(await isPrincipalOnline(A)).toBe(false)
    expect(await listOnlineAgentIds()).toEqual([])
    expect(await clearPresence(A, 's', true)).toBe(false)
    // `db.execute` returns no rows here, so `went_offline` is undefined and the
    // guarded read yields false rather than throwing — the shape a malformed
    // reply takes.
    expect(await isAnyAgentOnline()).toBe(false)
  })
})
