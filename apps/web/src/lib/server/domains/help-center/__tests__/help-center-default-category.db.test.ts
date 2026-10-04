import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { helpCenterCategories, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('../help-center-embedding.service', () => ({
  generateArticleEmbedding: async () => undefined,
}))

import { createArticle } from '../help-center.article.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: helpCenterCategories.id }).from(helpCenterCategories).limit(0)
  },
})

let author: PrincipalId
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  const userId = createId('user') as UserId
  author = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Ada', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: author, userId, role: 'admin', type: 'user', createdAt: new Date() })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

const draft = (title: string) => ({ title, content: `About ${title}` })

it('files an article without a category under General, creating it once', async () => {
  const first = await createArticle(draft('Getting started'), author)
  const second = await createArticle({ ...draft('Billing'), categoryId: '' }, author)
  const live = await testDb.query.helpCenterCategories.findMany()
  expect(live.map((category) => [category.name, category.slug])).toEqual([['General', 'general']])
  expect(first.categoryId).toBe(live[0]!.id)
  expect(second.categoryId).toBe(live[0]!.id)
})

it('uses the chosen category when there is one', async () => {
  const [docs] = await testDb
    .insert(helpCenterCategories)
    .values({ name: 'Docs', slug: 'docs' })
    .returning()
  const article = await createArticle({ ...draft('Setup'), categoryId: docs!.id }, author)
  expect(article.categoryId).toBe(docs!.id)
  expect(await testDb.query.helpCenterCategories.findMany()).toHaveLength(1)
})

it('never files into a General category someone deleted', async () => {
  const [deleted] = await testDb
    .insert(helpCenterCategories)
    .values({ name: 'General', slug: 'general', deletedAt: new Date() })
    .returning()
  const article = await createArticle(draft('Setup'), author)
  expect(article.categoryId).not.toBe(deleted!.id)
  const filed = await testDb.query.helpCenterCategories.findFirst({
    where: (category, { eq }) => eq(category.id, article.categoryId),
  })
  expect(filed).toMatchObject({ name: 'General', deletedAt: null })
})
