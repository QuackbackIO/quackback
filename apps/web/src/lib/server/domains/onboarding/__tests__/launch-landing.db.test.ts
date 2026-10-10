import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { isWorkspaceAdmin } from '../launch-landing'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function person(role: 'admin' | 'member' | 'user') {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: role, email: `${userId}@acme.example` })
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role,
    type: 'user',
    createdAt: new Date(),
  })
  return userId
}

it('counts only admin-tier teammates', async () => {
  expect(await isWorkspaceAdmin(await person('admin'))).toBe(true)
  expect(await isWorkspaceAdmin(await person('member'))).toBe(false)
  expect(await isWorkspaceAdmin(await person('user'))).toBe(false)
  expect(await isWorkspaceAdmin(createId('user'))).toBe(false)
})
