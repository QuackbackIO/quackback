/**
 * An article write that names a category or article that is not there is the
 * caller's mistake: a typed error, never the foreign key violation (a 500)
 * the insert would hit.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createId,
  type KbArticleId,
  type KbCategoryId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { helpCenterCategories, principal, user } from '@/lib/server/db'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('../help-center-embedding.service', () => ({
  generateArticleEmbedding: async () => undefined,
}))

import { createArticle, updateArticle } from '../help-center.article.service'
import { recordArticleFeedback } from '../help-center.article-feedback.service'

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

const category = async (values: { deletedAt?: Date } = {}) => {
  const [row] = await testDb
    .insert(helpCenterCategories)
    .values({ name: 'Docs', slug: `docs-${createId('kb_category')}`, ...values })
    .returning()
  return row!.id
}

it('refuses to file an article in a category that does not exist or was deleted', async () => {
  for (const categoryId of [createId('kb_category'), await category({ deletedAt: new Date() })]) {
    const attempt = createArticle({ title: 'Setup', content: 'x', categoryId }, author)
    await expect(attempt).rejects.toBeInstanceOf(ValidationError)
    await expect(attempt).rejects.toThrow('Category not found')
  }
})

it('refuses to move an article to a category that does not exist', async () => {
  const article = await createArticle(
    { title: 'Setup', content: 'x', categoryId: await category() },
    author
  )
  const attempt = updateArticle(article.id, { categoryId: createId('kb_category') as KbCategoryId })
  await expect(attempt).rejects.toBeInstanceOf(ValidationError)
  await expect(attempt).rejects.toThrow('Category not found')
})

it('feedback on an article that does not exist is not found', async () => {
  const attempt = recordArticleFeedback(createId('kb_article') as KbArticleId, true, author)
  await expect(attempt).rejects.toBeInstanceOf(NotFoundError)
  await expect(attempt).rejects.toMatchObject({ code: 'ARTICLE_NOT_FOUND' })
})
