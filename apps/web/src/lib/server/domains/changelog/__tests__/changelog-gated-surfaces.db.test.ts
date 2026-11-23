// @vitest-environment node
/**
 * The changelog surfaces outside the changelog page ask the page's own
 * question: link embeds (for the viewer), the sitemap and the customer
 * assistant (for a reader with no session). None of them shows an entry a
 * label gate keeps from that reader, and none shows anything while the
 * Changelog product is off, the changelog is for signed-in people (sitemap,
 * assistant) or the portal is private.
 *
 * Real database inside the fixture's rolled-back transaction; settings are
 * mocked.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const workspace = vi.hoisted(() => ({
  changelog: true,
  audience: 'public' as 'public' | 'authenticated',
  visibility: 'public' as 'public' | 'private',
}))
vi.mock('@/lib/server/domains/settings/settings.changelog', () => ({
  getChangelogSettings: async () => ({ audience: workspace.audience }),
}))
vi.mock('@/lib/server/domains/settings/settings.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.service')>()),
  isFeatureEnabled: async (flag: string) => (flag === 'changelog' ? workspace.changelog : true),
  getFeatureFlags: async () => ({ changelog: workspace.changelog, feedback: false }),
  getPortalConfig: async () => ({ access: { visibility: workspace.visibility } }),
  getWorkspaceSettings: async () => ({
    portalConfig: { access: { visibility: workspace.visibility } },
  }),
}))
vi.mock('@/lib/server/domains/settings/section-links', async () => {
  const { allOnPrimary } = await import('@/lib/shared/section-links')
  return { getSectionOrigins: async () => allOnPrimary('https://feedback.example.com') }
})
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: async () => null,
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (opts: unknown) => ({ path, options: opts }),
}))

import {
  changelogCategories,
  changelogEntries,
  changelogEntryCategories,
  segments,
} from '@/lib/server/db'
import {
  createId,
  type ChangelogCategoryId,
  type ChangelogId,
  type SegmentId,
} from '@quackback/ids'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { getPublicChangelogMetaById } from '../changelog.public'
import { retrieveChangelogEntries } from '@/lib/server/domains/assistant/changelog-retrieval'
import { Route } from '@/routes/sitemap[.]xml'

const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const SEGMENT = createId('segment') as SegmentId
const LABEL = createId('changelog_category') as ChangelogCategoryId
const OPEN = createId('changelog') as ChangelogId
const GATED = createId('changelog') as ChangelogId
const MEMBER: Actor = {
  principalId: createId('principal'),
  role: 'user',
  principalType: 'user',
  segmentIds: new Set([SEGMENT]),
}

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: changelogCategories.id }).from(changelogCategories).limit(0)
  },
})

type Handlers = { GET: (args: { request: Request }) => Promise<Response> }
const sitemapGet = (Route as unknown as { options: { server: { handlers: Handlers } } }).options
  .server.handlers.GET

/** The entries of this file the sitemap lists. */
async function sitemapEntries(): Promise<string[]> {
  const res = await sitemapGet({ request: new Request('https://feedback.example.com/sitemap.xml') })
  const xml = await res.text()
  return [OPEN, GATED].filter((id) => xml.includes(`/changelog/${id}`))
}

/** The entries of this file the assistant may ground on at a ceiling. */
async function retrieved(ceiling: 'public' | 'team'): Promise<string[]> {
  const rows = await retrieveChangelogEntries(`gates-${run}`, ceiling, { topK: 50 })
  return rows.map((r) => r.id).filter((id) => id === OPEN || id === GATED)
}

describe.skipIf(!fixture.available)('changelog surfaces respect the changelog gates', () => {
  beforeEach(async () => {
    await fixture.begin()
    await testDb.insert(segments).values({ id: SEGMENT, name: `cg-${run}`, slug: `cg-${run}` })
    await testDb
      .insert(changelogCategories)
      .values({ id: LABEL, name: `vip-${run}`, color: '#000000', segmentIds: [SEGMENT] })
    const publishedAt = new Date(Date.now() - 60_000)
    await testDb.insert(changelogEntries).values([
      { id: OPEN, title: `open gates-${run}`, content: `gates-${run}`, publishedAt },
      { id: GATED, title: `gated gates-${run}`, content: `gates-${run}`, publishedAt },
    ])
    await testDb
      .insert(changelogEntryCategories)
      .values({ changelogEntryId: GATED, categoryId: LABEL })
  })
  afterEach(async () => {
    workspace.changelog = true
    workspace.audience = 'public'
    workspace.visibility = 'public'
    await fixture.rollback()
  })
  afterAll(fixture.close)

  describe('link embeds', () => {
    it('show a gated entry to a member of its segment and to nobody else', async () => {
      expect(await getPublicChangelogMetaById(GATED, MEMBER)).toMatchObject({ id: GATED })
      expect(await getPublicChangelogMetaById(GATED, ANONYMOUS_ACTOR)).toBeNull()
      expect(await getPublicChangelogMetaById(OPEN, ANONYMOUS_ACTOR)).toMatchObject({ id: OPEN })
    })

    it('show nothing while the Changelog product is off', async () => {
      workspace.changelog = false
      expect(await getPublicChangelogMetaById(OPEN, MEMBER)).toBeNull()
    })

    it('show nothing to a visitor when the changelog is for signed-in people', async () => {
      workspace.audience = 'authenticated'
      expect(await getPublicChangelogMetaById(OPEN, ANONYMOUS_ACTOR)).toBeNull()
      expect(await getPublicChangelogMetaById(OPEN, MEMBER)).toMatchObject({ id: OPEN })
    })
  })

  describe('the sitemap', () => {
    it('lists only the entries a crawler can read', async () => {
      expect(await sitemapEntries()).toEqual([OPEN])
    })

    it('lists no entries when the changelog is for signed-in people', async () => {
      workspace.audience = 'authenticated'
      expect(await sitemapEntries()).toEqual([])
    })
  })

  describe('the customer assistant', () => {
    it('grounds only on entries an anonymous visitor can read', async () => {
      expect(await retrieved('public')).toEqual([OPEN])
    })

    it.each([
      ['the Changelog product is off', () => (workspace.changelog = false)],
      ['the changelog is for signed-in people', () => (workspace.audience = 'authenticated')],
      ['the portal is private', () => (workspace.visibility = 'private')],
    ])('grounds on nothing when %s', async (_, close) => {
      close()
      expect(await retrieved('public')).toEqual([])
    })

    it('still lets Copilot ground on every entry', async () => {
      workspace.visibility = 'private'
      expect((await retrieved('team')).sort()).toEqual([OPEN, GATED].sort())
    })
  })
})
