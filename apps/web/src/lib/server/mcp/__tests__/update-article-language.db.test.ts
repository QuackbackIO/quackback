/**
 * update_article with a locale against the real database (rolled back): a
 * publish-only call changes the publish state and nothing else, and a title
 * change without new content keeps the stored rich body whole.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type KbArticleId, type KbCategoryId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  helpCenterArticleTranslations,
  helpCenterArticles,
  helpCenterCategories,
  principal,
  type TiptapContent,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.locales', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/plan-limits/plan-limits.locales')>()),
  assertHelpCenterLocaleEditable: async () => {},
}))
vi.mock('@/lib/server/domains/help-center/help-center-translation-events', () => ({
  announceTranslationPublished: () => {},
  announceTranslationUpdated: () => {},
  announceTranslationUpdateReady: () => {},
  announceTranslationsBehind: async () => {},
}))

const { updateArticleLanguage } = await import('../tools/help-center-translations')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ r: helpCenterArticleTranslations.pendingSourceRevision })
      .from(helpCenterArticleTranslations)
      .limit(0)
  },
})

/** A German draft with an embed and a sized image, made from revision 1 of an article now at 2. */
const richBody: TiptapContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Sieh dir das Video an.' }] },
    { type: 'youtube', attrs: { src: 'https://www.youtube.com/watch?v=abc123def45' } },
    { type: 'resizableImage', attrs: { src: 'https://example.com/a.png', width: 320 } },
  ],
}

async function seed(): Promise<KbArticleId> {
  const author = createId('principal') as PrincipalId
  await testDb.insert(principal).values({ id: author, createdAt: new Date() })
  const categoryId = createId('kb_category') as KbCategoryId
  await testDb
    .insert(helpCenterCategories)
    .values({ id: categoryId, name: 'Start', slug: categoryId })
  const id = createId('kb_article') as KbArticleId
  await testDb.insert(helpCenterArticles).values({
    id,
    categoryId,
    slug: id,
    title: 'Watch the video',
    content: 'Watch the video.',
    principalId: author,
    publishedAt: new Date(),
    textRevision: 2,
  })
  await testDb.insert(helpCenterArticleTranslations).values({
    articleId: id,
    locale: 'de',
    title: 'Sieh dir das Video an',
    content: 'Sieh dir das Video an.',
    contentJson: richBody,
    status: 'draft',
    sourceRevision: 1,
  })
  return id
}

async function german(id: KbArticleId) {
  const [row] = await testDb
    .select()
    .from(helpCenterArticleTranslations)
    .where(
      and(
        eq(helpCenterArticleTranslations.articleId, id),
        eq(helpCenterArticleTranslations.locale, 'de')
      )
    )
  return row!
}

describe.skipIf(!fixture.available)('update_article with a locale', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('publishes with publishedAt alone and leaves the text and its rich body as they are', async () => {
    const id = await seed()
    const result = await updateArticleLanguage({
      articleId: id,
      locale: 'de',
      publishedAt: '2026-11-28T00:00:00Z',
    })
    expect(result.isError).toBeFalsy()
    const row = await german(id)
    expect(row.status).toBe('published')
    expect(row.contentJson).toEqual(richBody)
    expect(row.content).toBe('Sieh dir das Video an.')
    // Publishing does not say the translation caught up with the article.
    expect(row.sourceRevision).toBe(1)
  })

  it('unpublishes with publishedAt null the same way', async () => {
    const id = await seed()
    await updateArticleLanguage({
      articleId: id,
      locale: 'de',
      publishedAt: '2026-11-28T00:00:00Z',
    })
    await updateArticleLanguage({ articleId: id, locale: 'de', publishedAt: null })
    const row = await german(id)
    expect(row.status).toBe('draft')
    expect(row.contentJson).toEqual(richBody)
  })

  it('keeps the rich body when only the title changes', async () => {
    const id = await seed()
    await updateArticleLanguage({ articleId: id, locale: 'de', title: 'Das Video' })
    const row = await german(id)
    expect(row.title).toBe('Das Video')
    expect(row.contentJson).toEqual(richBody)
  })

  it('builds the body from Markdown when new content is given', async () => {
    const id = await seed()
    await updateArticleLanguage({ articleId: id, locale: 'de', content: 'Neuer **Text**.' })
    const row = await german(id)
    expect(row.content).toBe('Neuer **Text**.')
    expect(JSON.stringify(row.contentJson)).toContain('Neuer')
  })
})
