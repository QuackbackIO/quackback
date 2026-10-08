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
  statusIncidents,
  statusSubscriptions,
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

/** The test admin with these permissions too. */
function withPermissions(...extra: string[]): Actor {
  return {
    ...actor,
    permissions: new Set([...(actor.permissions as Set<string>), ...extra]),
  } as unknown as Actor
}

/** A portal user outside the team. */
async function customer(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: 'Ana', email: `${userId}@northwind.example` })
  await testDb
    .insert(principal)
    .values({ id, userId, role: 'user', type: 'user', createdAt: new Date() })
  return id
}

describe('whether Home has real data', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    await testDb.delete(conversations)
    await testDb.delete(posts)
    await testDb.delete(helpCenterArticles)
    await testDb.delete(changelogEntries)
    await testDb.delete(statusComponents)
    await testDb.delete(statusSubscriptions)
    await testDb.delete(statusIncidents)
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

  it('does not take the service setup seeded for real data, but a subscriber is', async () => {
    const status = { ...flags, statusPage: true }
    const owner = withPermissions(PERMISSIONS.STATUS_PAGE_PUBLISH, PERMISSIONS.STATUS_PAGE_MANAGE)
    await testDb.insert(statusComponents).values({ name: 'Acme API' })
    expect(
      (await getAdminOverview({ actor: owner, flags: status, probeRealData: true })).hasRealData
    ).toBe(false)

    await testDb
      .insert(statusSubscriptions)
      .values({ principalId: await customer(), source: 'self_serve' })
    expect(
      (await getAdminOverview({ actor: owner, flags: status, probeRealData: true })).hasRealData
    ).toBe(true)
  })

  it('counts a status page’s subscribers and open incidents, and names the module', async () => {
    const status = { ...flags, statusPage: true }
    const owner = withPermissions(PERMISSIONS.STATUS_PAGE_PUBLISH, PERMISSIONS.STATUS_PAGE_MANAGE)
    await testDb.insert(statusSubscriptions).values([
      { principalId: await customer(), source: 'self_serve' },
      { principalId: await customer(), source: 'self_serve', unsubscribedAt: new Date() },
    ])
    await testDb.insert(statusIncidents).values([
      { kind: 'incident', title: 'Acme API slow', status: 'investigating' },
      { kind: 'incident', title: 'Acme API down', status: 'resolved', resolvedAt: new Date() },
      { kind: 'maintenance', title: 'Acme upgrade', status: 'scheduled' },
    ])
    const overview = await getAdminOverview({ actor: owner, flags: status })
    expect(
      overview.metrics
        .filter((metric) => metric.filter === 'status')
        .map((metric) => [metric.key, metric.count])
    ).toEqual([
      ['subscribers', 1],
      ['incidents', 1],
    ])
    expect(overview.sections.status).toEqual({ enabled: true, error: null })
    expect((await getAdminOverview({ actor, flags })).sections.status.enabled).toBe(false)
  })

  it('shows status subscribers only to whoever can open their list', async () => {
    const status = { ...flags, statusPage: true }
    await testDb
      .insert(statusSubscriptions)
      .values({ principalId: await customer(), source: 'self_serve' })
    await testDb
      .insert(statusIncidents)
      .values({ kind: 'incident', title: 'Acme API slow', status: 'investigating' })
    const statusKeys = (overview: Awaited<ReturnType<typeof getAdminOverview>>) =>
      overview.metrics.filter((metric) => metric.filter === 'status').map((metric) => metric.key)

    // Publishing incidents does not open the subscriber list, so no count, query or empty line.
    const publisher = withPermissions(PERMISSIONS.STATUS_PAGE_PUBLISH)
    statements.length = 0
    const published = await getAdminOverview({ actor: publisher, flags: status })
    expect(statusKeys(published)).toEqual(['incidents'])
    expect(published.sections.status.enabled).toBe(false)
    expect(statements.some((sql) => /from "status_subscriptions"/i.test(sql))).toBe(false)

    const manager = withPermissions(PERMISSIONS.STATUS_PAGE_PUBLISH, PERMISSIONS.STATUS_PAGE_MANAGE)
    const managed = await getAdminOverview({ actor: manager, flags: status })
    expect(statusKeys(managed)).toEqual(['subscribers', 'incidents'])
    expect(managed.sections.status.enabled).toBe(true)
  })

  it('never counts shipped ideas waiting for an announcement while Changelog is off', async () => {
    const feedback = withPermissions(PERMISSIONS.POST_VIEW_PRIVATE)
    const keys = async (changelog: boolean) =>
      (
        await getAdminOverview({
          actor: feedback,
          flags: { ...flags, feedback: true, changelog },
        })
      ).metrics.map((metric) => metric.key)
    expect(await keys(false)).not.toContain('complete')
    expect(await keys(true)).toContain('complete')
  })

  it('reports real data without probing once the workspace is past its launch window', async () => {
    statements.length = 0
    const overview = await getAdminOverview({ actor, flags, probeRealData: false })
    expect(overview.hasRealData).toBe(true)
    expect(statements.some((sql) => /from "status_components"/i.test(sql))).toBe(false)
    expect(statements.some((sql) => /published_at" is not null/i.test(sql))).toBe(false)
  })
})
