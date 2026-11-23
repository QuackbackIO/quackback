/**
 * Public help center reads against a real database: what the landing cards
 * count, and how a signed-out visitor's vote is kept.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import type { KbArticleId, KbCategoryId, PrincipalId, SegmentId } from '@quackback/ids'
import {
  eq,
  helpCenterArticleFeedback,
  helpCenterArticles,
  helpCenterCategories,
  principal,
} from '@/lib/server/db'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPublicCategories } from '../help-center.category.service'
import { recordArticleFeedback } from '../help-center.article-feedback.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: helpCenterArticleFeedback.id, segmentIds: helpCenterArticles.segmentIds })
      .from(helpCenterArticleFeedback)
      .innerJoin(helpCenterArticles, eq(helpCenterArticles.id, helpCenterArticleFeedback.articleId))
      .limit(0)
  },
})

const SEGMENT = createId('segment') as SegmentId
const AUTHOR = createId('principal') as PrincipalId
const member: Actor = {
  principalId: createId('principal') as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set([SEGMENT]),
}

async function category(
  name: string,
  opts: { parentId?: KbCategoryId; isPublic?: boolean; segmentIds?: string[] } = {}
): Promise<KbCategoryId> {
  const id = createId('kb_category') as KbCategoryId
  await testDb.insert(helpCenterCategories).values({
    id,
    slug: `${name}-${id}`,
    name,
    isPublic: opts.isPublic ?? true,
    parentId: opts.parentId ?? null,
    segmentIds: opts.segmentIds ?? [],
  })
  return id
}

async function article(
  categoryId: KbCategoryId,
  opts: { published?: boolean; segmentIds?: string[] } = {}
): Promise<KbArticleId> {
  const id = createId('kb_article') as KbArticleId
  await testDb.insert(helpCenterArticles).values({
    id,
    categoryId,
    slug: `article-${id}`,
    title: `Article ${id}`,
    content: 'Body',
    principalId: AUTHOR,
    publishedAt: opts.published === false ? null : new Date(Date.now() - 60_000),
    segmentIds: opts.segmentIds ?? [],
  })
  return id
}

describe.skipIf(!fixture.available)('public help center against the database', () => {
  beforeEach(async () => {
    await fixture.begin()
    await testDb.insert(principal).values({ id: AUTHOR, createdAt: new Date() })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('the landing card count', () => {
    it('counts only the articles the viewer can open', async () => {
      const parent = await category('Counted')
      await article(parent)
      await article(parent, { published: false })
      await article(parent, { segmentIds: [SEGMENT] })
      const privateChild = await category('Hidden child', { parentId: parent, isPublic: false })
      for (let i = 0; i < 3; i++) await article(privateChild)
      // A public grandchild under the private child is not reachable from the card.
      const orphan = await category('Orphan', { parentId: privateChild })
      await article(orphan)
      const gatedChild = await category('Gated child', { parentId: parent, segmentIds: [SEGMENT] })
      await article(gatedChild)
      await article(gatedChild)
      const openChild = await category('Open child', { parentId: parent })
      await article(openChild)

      const forAnonymous = (await listPublicCategories(ANONYMOUS_ACTOR)).find(
        (c) => c.id === parent
      )
      expect(forAnonymous?.articleCount).toBe(2)
      expect(forAnonymous?.recursivePublishedArticleCount).toBe(2)

      const forMember = (await listPublicCategories(member)).find((c) => c.id === parent)
      expect(forMember?.articleCount).toBe(5)
    })

    it('drops a category whose only articles the viewer cannot open', async () => {
      const parent = await category('Only hidden')
      await article(parent, { segmentIds: [SEGMENT] })
      const privateChild = await category('Private child', { parentId: parent, isPublic: false })
      await article(privateChild)

      const ids = (await listPublicCategories(ANONYMOUS_ACTOR)).map((c) => c.id)
      expect(ids).not.toContain(parent)
      expect(ids).not.toContain(privateChild)
      expect((await listPublicCategories(member)).map((c) => c.id)).toContain(parent)
    })
  })

  describe('a signed-out vote', () => {
    async function counts(id: KbArticleId) {
      const [row] = await testDb
        .select({
          helpful: helpCenterArticles.helpfulCount,
          notHelpful: helpCenterArticles.notHelpfulCount,
        })
        .from(helpCenterArticles)
        .where(eq(helpCenterArticles.id, id))
      const votes = await testDb
        .select({ helpful: helpCenterArticleFeedback.helpful })
        .from(helpCenterArticleFeedback)
        .where(eq(helpCenterArticleFeedback.articleId, id))
      return { ...row, rows: votes.map((v) => v.helpful) }
    }

    it('replaces the earlier vote when the visitor changes their mind', async () => {
      const id = await article(await category('Votes'))
      const first = await recordArticleFeedback(id, true, null)
      const second = await recordArticleFeedback(id, false, null, { replaces: first })

      expect(second).toBe(first)
      expect(await counts(id)).toEqual({ helpful: 0, notHelpful: 1, rows: [false] })
    })

    it('leaves the counters alone when the same vote is sent again', async () => {
      const id = await article(await category('Votes'))
      const first = await recordArticleFeedback(id, true, null)
      await recordArticleFeedback(id, true, null, { replaces: first })

      expect(await counts(id)).toEqual({ helpful: 1, notHelpful: 0, rows: [true] })
    })

    it('never rewrites a signed-in visitor vote or a vote on another article', async () => {
      const voter = createId('principal') as PrincipalId
      await testDb.insert(principal).values({ id: voter, createdAt: new Date() })
      const id = await article(await category('Votes'))
      const other = await article(await category('Other'))
      const signedIn = await recordArticleFeedback(id, true, voter)
      const elsewhere = await recordArticleFeedback(other, true, null)

      const a = await recordArticleFeedback(id, false, null, { replaces: signedIn })
      const b = await recordArticleFeedback(id, false, null, { replaces: elsewhere })

      expect(a).not.toBe(signedIn)
      expect(b).not.toBe(elsewhere)
      expect((await counts(id)).rows.sort()).toEqual([false, false, true])
      expect(await counts(other)).toEqual({ helpful: 1, notHelpful: 0, rows: [true] })
    })
  })
})
