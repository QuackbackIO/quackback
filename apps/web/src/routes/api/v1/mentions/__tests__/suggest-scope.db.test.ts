/**
 * The mention typeahead marks teammates who cannot see the item being noted
 * on, over real rows: with `itemKind` and `itemId`, a teammate whose own scope
 * does not hold the item comes back with `noAccess: true`, so the picker can
 * show them muted and refuse the pick. The caller must see the item first; a
 * hidden, missing or malformed item gets today's plain list, which says
 * nothing about the item.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, principal, eq } from '@/lib/server/db'
import {
  SCOPED_KEYS,
  seedConversation,
  seedPerson,
  seedTeam,
  seedTicket,
  type SeededPerson,
} from '@/lib/server/__tests__/scope-seed'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const session = vi.hoisted(() => ({ userId: '' }))
vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: async () => ({ user: { id: session.userId } }) } },
}))
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: async () => ({ count: 1 }),
}))

import { handleMentionSuggest } from '../suggest'

const fixture = await createDbTestFixture()

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

interface Row {
  principalId: string
  noAccess?: boolean
}

const prefix = () => `zq${Math.random().toString(36).slice(2, 8)}`

async function seedWorld() {
  const p = prefix()
  const manager = await seedPerson(`${p} manager`, 'member')
  const onTeam = await seedPerson(`${p} on-team`, 'member', { keys: SCOPED_KEYS })
  const elsewhere = await seedPerson(`${p} elsewhere`, 'member', { keys: SCOPED_KEYS })
  const requester = await seedPerson(`${p} requester`, 'user')
  const billing = await seedTeam('Billing', [onTeam.id])
  await seedTeam('Logistics', [elsewhere.id])
  return { p, manager, onTeam, elsewhere, requester, billing }
}

async function signIn(person: SeededPerson) {
  const [row] = await testDb
    .select({ userId: principal.userId })
    .from(principal)
    .where(eq(principal.id, person.id))
  session.userId = row.userId!
}

async function suggest(params: Record<string, string>): Promise<Row[]> {
  const url = `http://localhost/api/v1/mentions/suggest?${new URLSearchParams(params)}`
  const res = await handleMentionSuggest({ request: new Request(url) })
  expect(res.status).toBe(200)
  return (await res.json()) as Row[]
}

const marks = (rows: Row[]) =>
  Object.fromEntries(rows.map((r) => [r.principalId, r.noAccess === true]))

describe('mention suggestions for an item', () => {
  it('marks the teammates who cannot see the conversation', async () => {
    const w = await seedWorld()
    const { conversation } = await seedConversation({ team: w.billing })
    await signIn(w.onTeam)

    const rows = await suggest({
      q: w.p,
      scope: 'team',
      itemKind: 'conversation',
      itemId: conversation.id,
    })

    expect(marks(rows)).toEqual({
      [w.manager.id]: false,
      [w.onTeam.id]: false,
      [w.elsewhere.id]: true,
    })
  })

  it('marks the teammates who cannot see the ticket', async () => {
    const w = await seedWorld()
    const ticket = await seedTicket({ requester: w.requester.id, team: w.billing })
    await signIn(w.manager)

    const rows = await suggest({ q: w.p, scope: 'team', itemKind: 'ticket', itemId: ticket.id })

    expect(marks(rows)).toEqual({
      [w.manager.id]: false,
      [w.onTeam.id]: false,
      [w.elsewhere.id]: true,
    })
  })

  it('gives a caller who cannot see the item the plain list, with no marks', async () => {
    const w = await seedWorld()
    const { conversation } = await seedConversation({ team: w.billing })
    await signIn(w.elsewhere)

    const rows = await suggest({
      q: w.p,
      scope: 'team',
      itemKind: 'conversation',
      itemId: conversation.id,
    })

    expect(rows.some((r) => 'noAccess' in r)).toBe(false)
    expect(rows).toHaveLength(3)
  })

  it('gives a customer the plain list for their own conversation', async () => {
    const w = await seedWorld()
    const [conversation] = await testDb
      .insert(conversations)
      .values({
        visitorPrincipalId: w.requester.id,
        channel: 'messenger',
        status: 'open',
        customAttributes: {},
        assignedTeamId: w.billing,
      })
      .returning()
    await signIn(w.requester)

    const rows = await suggest({ q: w.p, itemKind: 'conversation', itemId: conversation.id })

    expect(rows.some((r) => 'noAccess' in r)).toBe(false)
  })

  it.each([
    ['a missing item', 'conversation', createId('conversation')],
    ['a malformed id', 'conversation', 'not-an-id'],
    ['an id of the wrong kind', 'ticket', createId('conversation')],
    ['an unknown kind', 'post', createId('post')],
  ])('gives the plain list for %s', async (_label, itemKind, itemId) => {
    const w = await seedWorld()
    await signIn(w.manager)

    const rows = await suggest({ q: w.p, scope: 'team', itemKind, itemId })

    expect(rows.some((r) => 'noAccess' in r)).toBe(false)
    expect(rows).toHaveLength(3)
  })

  it('marks nobody without an item', async () => {
    const w = await seedWorld()
    await signIn(w.manager)
    const rows = await suggest({ q: w.p, scope: 'team' })
    expect(rows.some((r) => 'noAccess' in r)).toBe(false)
  })
})
