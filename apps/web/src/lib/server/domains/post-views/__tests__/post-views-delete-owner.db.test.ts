/**
 * Who may delete a saved inbox view (FBA-I-27): its author always; a shared
 * view also an admin. Anyone else gets VIEW_NOT_FOUND and the view survives,
 * since a private view is not even listed to them.
 *
 * Real Postgres in a rolled-back transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { createId, type PostViewId, type PrincipalId, type UserId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { postViews, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createView, deleteView } from '../post-views.service'

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

async function isDeleted(id: PostViewId): Promise<boolean> {
  const [row] = await testDb
    .select({ deletedAt: postViews.deletedAt })
    .from(postViews)
    .where(eq(postViews.id, id))
  return row.deletedAt !== null
}

describe.skipIf(!fixture.available)('deleting a saved view (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('refuses a teammate deleting a colleague’s private view, which survives', async () => {
    const author = await seedTeammate()
    const colleague = await seedTeammate()
    const id = await createView({ name: 'Mine', filters: {}, isShared: false }, author)

    await expect(deleteView(id, { principalId: colleague, isAdmin: false })).rejects.toMatchObject({
      code: 'VIEW_NOT_FOUND',
    })
    expect(await isDeleted(id)).toBe(false)
  })

  it('refuses even an admin deleting someone else’s private view', async () => {
    const author = await seedTeammate()
    const admin = await seedTeammate()
    const id = await createView({ name: 'Mine', filters: {}, isShared: false }, author)

    await expect(deleteView(id, { principalId: admin, isAdmin: true })).rejects.toMatchObject({
      code: 'VIEW_NOT_FOUND',
    })
    expect(await isDeleted(id)).toBe(false)
  })

  it('refuses a non-admin deleting a colleague’s shared view', async () => {
    const author = await seedTeammate()
    const colleague = await seedTeammate()
    const id = await createView({ name: 'Team', filters: {}, isShared: true }, author)

    await expect(deleteView(id, { principalId: colleague, isAdmin: false })).rejects.toMatchObject({
      code: 'VIEW_NOT_FOUND',
    })
    expect(await isDeleted(id)).toBe(false)
  })

  it('lets the author delete their own view, private or shared', async () => {
    const author = await seedTeammate()
    const priv = await createView({ name: 'Mine', filters: {}, isShared: false }, author)
    const shared = await createView({ name: 'Team', filters: {}, isShared: true }, author)

    await deleteView(priv, { principalId: author, isAdmin: false })
    await deleteView(shared, { principalId: author, isAdmin: false })
    expect(await isDeleted(priv)).toBe(true)
    expect(await isDeleted(shared)).toBe(true)
  })

  it('lets an admin delete a colleague’s shared view', async () => {
    const author = await seedTeammate()
    const admin = await seedTeammate()
    const id = await createView({ name: 'Team', filters: {}, isShared: true }, author)

    await deleteView(id, { principalId: admin, isAdmin: true })
    expect(await isDeleted(id)).toBe(true)
  })

  it('answers VIEW_NOT_FOUND for a view already deleted', async () => {
    const author = await seedTeammate()
    const id = await createView({ name: 'Gone', filters: {}, isShared: true }, author)
    await deleteView(id, { principalId: author, isAdmin: false })

    await expect(deleteView(id, { principalId: author, isAdmin: false })).rejects.toMatchObject({
      code: 'VIEW_NOT_FOUND',
    })
  })
})
