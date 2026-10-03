import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  changelogEntries,
  conversations,
  helpCenterArticles,
  helpCenterCategories,
  posts,
  principal,
  statusComponents,
  user,
} from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { getAdminOverview } = await import('../admin-overview.query')

const statements: string[] = []
const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: changelogEntries.id }).from(changelogEntries).limit(0)
  },
  logger: { logQuery: (query) => statements.push(query) },
})

// Only Help Center and Changelog are on, so the support and feedback loaders
// stay out of the way of what this measures.
const flags = { feedback: false, supportInbox: false, helpCenter: true, changelog: true }

let actor: Actor
let principalId: PrincipalId

describe('whether Home has real data', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    await testDb.delete(conversations)
    await testDb.delete(posts)
    await testDb.delete(helpCenterArticles)
    await testDb.delete(changelogEntries)
    await testDb.delete(statusComponents)
    const userId = createId('user') as UserId
    principalId = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
    await testDb
      .insert(principal)
      .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
    actor = {
      principalId,
      role: 'admin',
      permissions: new Set([PERMISSIONS.HELP_CENTER_MANAGE, PERMISSIONS.CHANGELOG_VIEW_DRAFT]),
    } as unknown as Actor
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('does not count drafts', async () => {
    const [category] = await testDb
      .insert(helpCenterCategories)
      .values({ name: 'Acme', slug: 'acme-real-data' })
      .returning()
    await testDb.insert(helpCenterArticles).values({
      categoryId: category!.id,
      slug: 'acme-draft',
      title: 'Acme draft',
      content: 'Acme',
      principalId,
    })
    await testDb
      .insert(changelogEntries)
      .values({ title: 'Acme draft', content: 'Acme', principalId })
    expect((await getAdminOverview({ actor, flags, probeRealData: true })).hasRealData).toBe(false)

    await testDb.insert(changelogEntries).values({
      title: 'Acme update',
      content: 'Acme',
      principalId,
      publishedAt: new Date(Date.now() - 60_000),
    })
    expect((await getAdminOverview({ actor, flags, probeRealData: true })).hasRealData).toBe(true)
  })

  it('reports real data without probing once the workspace is past its launch window', async () => {
    statements.length = 0
    const overview = await getAdminOverview({ actor, flags, probeRealData: false })
    expect(overview.hasRealData).toBe(true)
    expect(statements.some((sql) => /from "status_components"/i.test(sql))).toBe(false)
    expect(statements.some((sql) => /published_at" is not null/i.test(sql))).toBe(false)
  })
})
