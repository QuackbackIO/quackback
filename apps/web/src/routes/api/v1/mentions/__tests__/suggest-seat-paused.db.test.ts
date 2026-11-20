/**
 * The mention typeahead and a caller whose seat is paused (the plan has fewer
 * team seats than members, after the grace), over real rows: the caller is
 * judged as the portal user they still are, so they never learn which
 * teammates cannot see the item.
 *
 * The paused answer is a stand-in keyed on the principal it is asked about, as
 * the real `isSeatPaused` is; that answer is proved against a database in
 * plan-limits.team.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, eq } from '@/lib/server/db'
import {
  SCOPED_KEYS,
  seedConversation,
  seedPerson,
  seedTeam,
} from '@/lib/server/__tests__/scope-seed'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const hoisted = vi.hoisted(() => ({ userId: '', paused: new Set<string>() }))
vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: async () => ({ user: { id: hoisted.userId } }) } },
}))
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: async () => ({ count: 1 }),
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/plan-limits/plan-limits.service')>()),
  isSeatPaused: async (principalId: string) => hoisted.paused.has(principalId),
}))

import { handleMentionSuggest } from '../suggest'

const fixture = await createDbTestFixture()

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  hoisted.paused.clear()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

interface Row {
  principalId: string
  noAccess?: boolean
}

describe('mention suggestions from a paused seat', () => {
  it('marks nobody for a paused caller, who is judged as a portal user', async () => {
    const p = `zq${Math.random().toString(36).slice(2, 8)}`
    const onTeam = await seedPerson(`${p} on-team`, 'member', { keys: SCOPED_KEYS })
    const elsewhere = await seedPerson(`${p} elsewhere`, 'member', { keys: SCOPED_KEYS })
    const billing = await seedTeam('Billing', [onTeam.id])
    await seedTeam('Logistics', [elsewhere.id])
    const { conversation } = await seedConversation({ team: billing })
    const [row] = await testDb
      .select({ userId: principal.userId })
      .from(principal)
      .where(eq(principal.id, onTeam.id))
    hoisted.userId = row!.userId!

    const suggest = async () => {
      const params = { q: p, scope: 'team', itemKind: 'conversation', itemId: conversation.id }
      const url = `http://localhost/api/v1/mentions/suggest?${new URLSearchParams(params)}`
      const res = await handleMentionSuggest({ request: new Request(url) })
      return { status: res.status, rows: res.status === 200 ? ((await res.json()) as Row[]) : [] }
    }

    // The paused answer is shared for the rest of a request, so each caller is
    // asked about once: the paused caller here, a seat holder in suggest-scope.
    hoisted.paused.add(onTeam.id)
    const paused = await suggest()
    expect(paused.rows.map((r) => r.principalId)).toContain(elsewhere.id)
    expect(paused.rows.some((r) => r.noAccess === true)).toBe(false)
  })
})
