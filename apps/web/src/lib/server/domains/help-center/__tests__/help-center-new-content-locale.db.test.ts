/**
 * New help center content is labelled with the main language, against the
 * real database: a collection, an article, and the General collection a first
 * article without one files into. A label left at the column default would
 * read as English on a workspace that writes in another language.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, helpCenterCategories, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('../help-center-embedding.service', () => ({
  generateArticleEmbedding: async () => undefined,
}))
vi.mock('@/lib/server/domains/settings/settings.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.service')>()),
  getMainLanguage: async () => 'de',
}))

const { createArticle } = await import('../help-center.article.service')
const { createCategory } = await import('../help-center.category.service')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ locale: helpCenterCategories.locale }).from(helpCenterCategories).limit(0)
  },
})

let author: PrincipalId
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  await testDb.update(helpCenterCategories).set({ deletedAt: new Date() })
  const userId = createId('user') as UserId
  author = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Ada', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: author, userId, role: 'admin', type: 'user', createdAt: new Date() })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

it('labels a new collection with the main language', async () => {
  const category = await createCategory({ name: 'Erste Schritte' })
  expect(category.locale).toBe('de')
})

it('labels a new article, and the General collection it files into, with the main language', async () => {
  const article = await createArticle(
    { title: 'Passwort ändern', content: 'Öffne dein Konto.' },
    author
  )
  expect(article.locale).toBe('de')
  const [general] = await testDb
    .select({ locale: helpCenterCategories.locale })
    .from(helpCenterCategories)
    .where(eq(helpCenterCategories.id, article.categoryId))
  expect(general!.locale).toBe('de')
})
