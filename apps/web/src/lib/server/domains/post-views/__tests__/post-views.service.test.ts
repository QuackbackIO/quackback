/**
 * Real-DB coverage for the post-views service: saving a named filter set and
 * the visibility of shared vs private views. Runs inside the db-test-fixture
 * rollback transaction (see server/__tests__/README.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { postViews, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createView, listViewsForPrincipal, deleteView } from '../post-views.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: postViews.id }).from(postViews).limit(0)
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

describe.skipIf(!fixture.available)('post-views.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('saves a named filter set and serves it back to any teammate', async () => {
    const author = await seedTeammate()
    const other = await seedTeammate()
    const id = await createView(
      {
        name: 'Unresponded bugs',
        filters: { status: ['open'], tags: ['post_tag_bug'], responded: 'unresponded' },
        isShared: true,
      },
      author
    )

    const forOther = await listViewsForPrincipal(other)
    const saved = forOther.find((v) => v.id === id)
    expect(saved?.name).toBe('Unresponded bugs')
    expect(saved?.filters).toEqual({
      status: ['open'],
      tags: ['post_tag_bug'],
      responded: 'unresponded',
    })
  })

  it('shows a private view only to its author', async () => {
    const author = await seedTeammate()
    const other = await seedTeammate()
    const id = await createView(
      { name: 'My triage', filters: { owner: 'unassigned' }, isShared: false },
      author
    )

    expect((await listViewsForPrincipal(author)).map((v) => v.id)).toContain(id)
    expect((await listViewsForPrincipal(other)).map((v) => v.id)).not.toContain(id)
  })

  it('a soft-deleted view leaves every listing', async () => {
    const author = await seedTeammate()
    const id = await createView({ name: 'Gone', filters: {}, isShared: true }, author)
    await deleteView(id)
    expect((await listViewsForPrincipal(author)).map((v) => v.id)).not.toContain(id)
  })
})
