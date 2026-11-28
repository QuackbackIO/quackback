/**
 * The translation events against the real database (rolled back): a
 * translation behind its article is announced once per language and article
 * revision, so saving the same text again announces nothing new.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type KbArticleId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  events,
  helpCenterArticleTranslations,
  helpCenterArticles,
  helpCenterCategories,
  principal,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { announceTranslationsBehind } = await import('../help-center-translation-events')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ r: helpCenterArticles.textRevision }).from(helpCenterArticles).limit(0)
  },
})

async function needsUpdateEvents(articleId: string) {
  return testDb
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.type, 'article.translation_needs_update'), eq(events.entityId, articleId)))
}

describe.skipIf(!fixture.available)('translation events', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('announces each translation behind once per article revision', async () => {
    const author = createId('principal') as PrincipalId
    await testDb.insert(principal).values({ id: author, createdAt: new Date() })
    const categoryId = createId('kb_category')
    await testDb
      .insert(helpCenterCategories)
      .values({ id: categoryId as never, name: 'C', slug: categoryId })
    const articleId = createId('kb_article') as KbArticleId
    await testDb.insert(helpCenterArticles).values({
      id: articleId,
      categoryId: categoryId as never,
      slug: articleId,
      title: 'Refunds',
      content: 'x',
      principalId: author,
      textRevision: 2,
    })
    for (const [locale, sourceRevision] of [
      ['de', 1],
      ['fr', 2],
    ] as const) {
      await testDb
        .insert(helpCenterArticleTranslations)
        .values({ articleId, locale, title: locale, content: 'x', sourceRevision })
    }

    await announceTranslationsBehind(articleId, 2)
    await announceTranslationsBehind(articleId, 2)

    const announced = await needsUpdateEvents(articleId)
    expect(announced.map((e) => e.payload)).toEqual([
      { articleId, locale: 'de', articleRevision: 2, translationRevision: 1 },
    ])

    await announceTranslationsBehind(articleId, 3)
    expect(await needsUpdateEvents(articleId)).toHaveLength(3)
  })
})
