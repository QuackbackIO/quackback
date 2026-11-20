/**
 * subscribeStatusFn against real Postgres: a subscription to chosen services
 * must name at least one service the subscriber can see. An empty list, an
 * unknown service or a gated one would store an active subscription that no
 * incident can ever match, which still counts as a subscriber.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, statusSubscriptions, user } from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: unknown) => fn,
    }
    return chain
  },
}))
const caller = vi.hoisted(() => ({ id: '' }))
vi.mock('../auth-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth-helpers')>()
  const auth = () => ({
    principal: { id: caller.id, role: 'user', type: 'user' },
    permissions: [],
  })
  return {
    ...actual,
    requireAuth: vi.fn(async () => auth()),
    policyActorFromAuth: vi.fn(async () => ({
      principalId: caller.id,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(),
    })),
  }
})
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => ({ maxStatusSubscribers: null }),
}))

import { createStatusComponent } from '@/lib/server/domains/status'
import { subscribeStatusFn } from '../status-subscriptions'

const subscribeFn = subscribeStatusFn as unknown as (args: {
  data: { scope: 'page' | 'components'; componentIds?: string[] }
}) => Promise<{ subscribed: boolean }>

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: statusSubscriptions.id }).from(statusSubscriptions).limit(0)
  },
})

async function row(principalId: PrincipalId) {
  return testDb.query.statusSubscriptions.findFirst({
    where: eq(statusSubscriptions.principalId, principalId),
  })
}

describe('subscribing to chosen services (Postgres)', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    const userId = createId('user')
    caller.id = createId('principal')
    await testDb.insert(user).values({ id: userId, name: 'Sub', email: `${userId}@example.com` })
    await testDb.insert(principal).values({
      id: caller.id as PrincipalId,
      userId,
      role: 'user',
      type: 'user',
      createdAt: new Date(),
    })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it.each([
    ['no services', () => []],
    ['an unknown service', () => [createId('status_component')]],
    ['a malformed id', () => ['not-an-id']],
  ])('refuses %s', async (_name, ids) => {
    await expect(
      subscribeFn({ data: { scope: 'components', componentIds: ids() } })
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await row(caller.id as PrincipalId)).toBeUndefined()
  })

  it('refuses a service gated away from the subscriber', async () => {
    const gated = await createStatusComponent({
      name: 'Team only',
      segmentIds: [createId('segment')],
    })
    await expect(
      subscribeFn({ data: { scope: 'components', componentIds: [gated.id] } })
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await row(caller.id as PrincipalId)).toBeUndefined()
  })

  it('stores a subscription to a service the subscriber can see', async () => {
    const api = await createStatusComponent({ name: 'API' })
    expect(await subscribeFn({ data: { scope: 'components', componentIds: [api.id] } })).toEqual({
      subscribed: true,
    })
    expect((await row(caller.id as PrincipalId))?.componentIds).toEqual([api.id])
  })

  it('a page-wide subscription needs no services', async () => {
    await subscribeFn({ data: { scope: 'page' } })
    expect((await row(caller.id as PrincipalId))?.scope).toBe('page')
  })
})
