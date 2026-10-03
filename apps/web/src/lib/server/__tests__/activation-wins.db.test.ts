import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from './db-test-fixture'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { conversations, principal, statusComponents, user, type SetupState } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))
import { detectFirstWin } from '../activation-wins'
const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: statusComponents.id }).from(statusComponents).limit(0)
  },
})
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

it('uses the primary goal and the earliest live service for a status win', async () => {
  const state: SetupState = {
    version: 2,
    steps: { core: true, workspace: true, startingPoint: null },
    useCase: 'status_page',
    goals: ['customer_support', 'status_page'],
  }
  await testDb.insert(statusComponents).values([
    { name: 'Acme deleted', createdAt: new Date('2026-01-01'), deletedAt: new Date() },
    { name: 'Acme later', createdAt: new Date('2026-03-01') },
    { name: 'Acme first', createdAt: new Date('2026-02-01') },
  ])
  expect(await detectFirstWin(state)).toEqual({ reached: false, reachedAt: null })
  expect(await detectFirstWin({ ...state, goals: ['status_page', 'customer_support'] })).toEqual({
    reached: true,
    reachedAt: '2026-02-01T00:00:00.000Z',
  })
})

it('counts a conversation a customer starts by email as the support win, not one from GitHub', async () => {
  const state: SetupState = {
    version: 2,
    steps: { core: true, workspace: true, startingPoint: null },
    useCase: 'customer_support',
    goals: ['customer_support'],
  }
  await testDb.delete(conversations)
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  await testDb.insert(conversations).values({
    visitorPrincipalId: principalId,
    channel: 'github',
    source: 'github',
    createdAt: new Date('2026-02-01'),
  })
  expect(await detectFirstWin(state)).toEqual({ reached: false, reachedAt: null })
  await testDb.insert(conversations).values({
    visitorPrincipalId: principalId,
    channel: 'email',
    source: 'email',
    createdAt: new Date('2026-03-01'),
  })
  expect(await detectFirstWin(state)).toEqual({
    reached: true,
    reachedAt: '2026-03-01T00:00:00.000Z',
  })
})
