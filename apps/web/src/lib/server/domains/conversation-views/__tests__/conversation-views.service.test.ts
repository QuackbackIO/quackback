/**
 * Real-DB coverage for the conversation-views service (§4.6): visibility of
 * shared vs private views. Runs inside the db-test-fixture rollback
 * transaction (see server/__tests__/README.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversationViews, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createView, listViewsForPrincipal } from '../conversation-views.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversationViews.id }).from(conversationViews).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `V-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

describe.skipIf(!fixture.available)('conversation-views.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('shows a shared view to any teammate', async () => {
    const author = await seedTeammate()
    const other = await seedTeammate()
    const id = await createView(
      { name: 'Team queue', filters: { rules: [] }, isShared: true },
      author
    )

    expect((await listViewsForPrincipal(author)).map((v) => v.id)).toContain(id)
    expect((await listViewsForPrincipal(other)).map((v) => v.id)).toContain(id)
  })

  it('shows a private view only to its author', async () => {
    const author = await seedTeammate()
    const other = await seedTeammate()
    const id = await createView(
      { name: 'My drafts', filters: { rules: [] }, isShared: false },
      author
    )

    expect((await listViewsForPrincipal(author)).map((v) => v.id)).toContain(id)
    expect((await listViewsForPrincipal(other)).map((v) => v.id)).not.toContain(id)
  })
})
