/**
 * The help center over the public REST API (/api/v1/help-center): the module
 * gate, categories, articles, publishing, article feedback, and the scopes
 * and permissions that guard the writes.
 *
 * Journeys: API-R-161, API-R-162, API-R-163, API-R-164, API-R-165,
 * API-R-166, API-R-167, API-R-168, API-R-169, API-R-170, API-R-171,
 * API-R-172.
 *
 * Not here: whether keys without help center permission or scope may read
 * (API-R-162) or rate articles (API-R-170) is an owner question, as is
 * feedback on draft and deleted articles (API-R-171); those journeys prove
 * the uncontested part with a properly privileged key. Redirect rules and
 * pending translations (API-R-164, API-R-169) and the portal pages are not
 * asserted here.
 *
 * The suite's setup turns the help center on; API-R-161 turns it off and runs
 * in the isolated job.
 */
import { generateId } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { apiFor, createKey, expectJson, type Wire } from '../../support/api-client'
import { supportDb } from '../../support/db'
import { ISOLATED } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import {
  UNAUTHORIZED_MESSAGE,
  adminApi,
  missingScope,
  rawJson,
  seedSegment,
  uuid,
} from '../../product/api-rest-content'

test.describe.configure({ timeout: 60_000 })

const CATEGORY_KEYS = [
  'createdAt',
  'description',
  'icon',
  'id',
  'isPublic',
  'name',
  'parentId',
  'position',
  'slug',
  'updatedAt',
]
const ARTICLE_KEYS = [
  'author',
  'category',
  'content',
  'createdAt',
  'description',
  'helpfulCount',
  'id',
  'notHelpfulCount',
  'publishedAt',
  'slug',
  'title',
  'updatedAt',
  'viewCount',
]

async function createCategory(
  api: APIRequestContext,
  data: Record<string, unknown>
): Promise<Wire> {
  return (await expectJson(await api.post('/api/v1/help-center/categories', { data }), 201)).data
}

async function createArticle(
  api: APIRequestContext,
  authorId: string,
  data: Record<string, unknown>
): Promise<Wire> {
  return (
    await expectJson(
      await api.post('/api/v1/help-center/articles', { data: { authorId, ...data } }),
      201
    )
  ).data
}

async function articleRow(
  id: string
): Promise<{ deleted_at: Date | null; published_at: Date | null; category_id: string }> {
  const [row] = await supportDb()<
    { deleted_at: Date | null; published_at: Date | null; category_id: string }[]
  >`SELECT deleted_at, published_at, category_id FROM kb_articles WHERE id = ${uuid(id)}`
  return row
}

test.describe('REST help center: module gate', () => {
  test(
    'API-R-161 with the help center off every route answers 404 before auth',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, baseURL, people }) => {
      test.skip(!ISOLATED, 'runs in product-isolated')
      const { api: admin } = await adminApi(playwright, baseURL, people)
      const anon = await apiFor(playwright, baseURL, null)
      const badKey = await apiFor(playwright, baseURL, `qb_${'0'.repeat(48)}`)
      const cat = generateId('kb_category')
      const art = generateId('article')
      await withSettings({ feature_flags: { helpCenter: false } }, async () => {
        for (const api of [anon, badKey, admin]) {
          for (const res of [
            await api.get('/api/v1/help-center/categories'),
            await api.post('/api/v1/help-center/categories', { data: { name: 'x' } }),
            await api.get(`/api/v1/help-center/categories/${cat}`),
            await api.patch(`/api/v1/help-center/categories/${cat}`, { data: { name: 'x' } }),
            await api.delete(`/api/v1/help-center/categories/${cat}`),
            await api.get('/api/v1/help-center/articles'),
            await api.post('/api/v1/help-center/articles', { data: {} }),
            await api.get(`/api/v1/help-center/articles/${art}`),
            await api.patch(`/api/v1/help-center/articles/${art}`, { data: {} }),
            await api.delete(`/api/v1/help-center/articles/${art}`),
            await api.post(`/api/v1/help-center/articles/${art}/feedback`, {
              data: { helpful: true },
            }),
          ]) {
            const body = await expectJson(res, 404)
            expect(body).toEqual({
              error: { code: 'NOT_FOUND', message: 'Knowledge base not found' },
            })
          }
        }
      })
      // With the module on again, a missing key is a 401 and a valid key reads.
      const unauth = await expectJson(await anon.get('/api/v1/help-center/categories'), 401)
      expect(unauth.error.message).toBe(UNAUTHORIZED_MESSAGE)
      await expectJson(await admin.get('/api/v1/help-center/categories'), 200)
      for (const api of [anon, badKey, admin]) await api.dispose()
    }
  )
})

test.describe('REST help center: categories', () => {
  test(
    'API-R-162 a help center key reads private categories with their counts and draft articles',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people, {
        scopes: ['read:article', 'write:article'],
      })
      const segment = await seedSegment(marker)
      const priv = await createCategory(api, { name: `${marker} private`, isPublic: false })
      await supportDb()`UPDATE kb_categories SET segment_ids = ${supportDb().json([segment])}
        WHERE id = ${uuid(priv.id)}`
      const author = people.people.admin.principalId
      const draft = await createArticle(api, author, {
        categoryId: priv.id,
        title: `${marker} draft`,
        content: 'Draft body text',
      })
      const list = await expectJson(await api.get('/api/v1/help-center/categories'), 200)
      const listed = list.data.find((c: Wire) => c.id === priv.id)
      expect(listed).toMatchObject({ isPublic: false, articleCount: 1 })
      const one = await expectJson(await api.get(`/api/v1/help-center/categories/${priv.id}`), 200)
      expect(Object.keys(one.data).sort()).toEqual(CATEGORY_KEYS)
      const drafts = await expectJson(
        await api.get(`/api/v1/help-center/articles?status=draft&categoryId=${priv.id}`),
        200
      )
      expect(drafts.data.map((a: Wire) => a.id)).toEqual([draft.id])
      const got = await expectJson(await api.get(`/api/v1/help-center/articles/${draft.id}`), 200)
      expect(got.data).toMatchObject({ publishedAt: null, content: 'Draft body text' })
      await api.dispose()
    }
  )

  test(
    'API-R-163 create categories: unique slugs, defaults, a depth limit and body validation',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const first = await createCategory(api, { name: `${marker} Billing` })
      const second = await createCategory(api, { name: `${marker} Billing` })
      expect(Object.keys(first).sort()).toEqual(CATEGORY_KEYS)
      expect(first).toMatchObject({ isPublic: true, position: 0, parentId: null })
      expect(second.slug).not.toBe(first.slug)

      const child = await createCategory(api, { name: `${marker} child`, parentId: first.id })
      const grandchild = await createCategory(api, {
        name: `${marker} grandchild`,
        parentId: child.id,
      })
      expect(grandchild.parentId).toBe(child.id)
      const tooDeep = await expectJson(
        await api.post('/api/v1/help-center/categories', {
          data: { name: `${marker} too deep`, parentId: grandchild.id },
        }),
        400
      )
      expect(tooDeep.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Placing this category here would exceed the maximum depth of 3',
      })

      for (const data of [{ name: '' }, { name: `${marker} icon`, icon: 'x'.repeat(51) }]) {
        const bad = await expectJson(
          await api.post('/api/v1/help-center/categories', { data }),
          400
        )
        expect(bad.error).toMatchObject({ code: 'BAD_REQUEST', message: 'Invalid request body' })
      }
      const [{ n }] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM kb_categories WHERE name LIKE ${`${marker}%`}`
      expect(n).toBe(4)
      await api.dispose()
    }
  )

  test(
    'API-R-164 update a category, then delete a parent with its child and articles',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const author = people.people.admin.principalId
      const parent = await createCategory(api, { name: `${marker} parent`, icon: 'book' })
      const child = await createCategory(api, { name: `${marker} child`, parentId: parent.id })
      const a1 = await createArticle(api, author, {
        categoryId: parent.id,
        title: `${marker} in parent`,
        content: 'P',
      })
      const a2 = await createArticle(api, author, {
        categoryId: child.id,
        title: `${marker} in child`,
        content: 'C',
      })

      const patched = await expectJson(
        await api.patch(`/api/v1/help-center/categories/${parent.id}`, {
          data: { isPublic: false, icon: null },
        }),
        200
      )
      expect(patched.data).toMatchObject({ isPublic: false, icon: null })

      expect((await api.delete(`/api/v1/help-center/categories/${parent.id}`)).status()).toBe(204)
      const deleted = await supportDb()<{ deleted_at: Date | null }[]>`
        SELECT deleted_at FROM kb_categories WHERE id IN ${supportDb()([uuid(parent.id), uuid(child.id)])}
        UNION ALL
        SELECT deleted_at FROM kb_articles WHERE id IN ${supportDb()([uuid(a1.id), uuid(a2.id)])}`
      expect(deleted).toHaveLength(4)
      const stamps = new Set(deleted.map((r) => r.deleted_at?.toISOString()))
      expect(stamps.has(undefined)).toBe(false)
      expect(stamps.size).toBe(1)

      for (const res of [
        await api.delete(`/api/v1/help-center/categories/${parent.id}`),
        await api.get(`/api/v1/help-center/categories/${parent.id}`),
      ]) {
        const body = await expectJson(res, 404)
        expect(body.error).toMatchObject({
          code: 'NOT_FOUND',
          message: 'Help center category not found',
        })
      }
      await api.dispose()
    }
  )
})

test.describe('REST help center: articles', () => {
  test(
    'API-R-165 list articles by category and status, page with the cursor',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const author = people.people.admin.principalId
      const cat = await createCategory(api, { name: `${marker} cat` })
      const published = await createArticle(api, author, {
        categoryId: cat.id,
        title: `${marker} published`,
        content: 'Live',
      })
      await expectJson(
        await api.patch(`/api/v1/help-center/articles/${published.id}`, {
          data: { publishedAt: new Date().toISOString() },
        }),
        200
      )
      const draft = await createArticle(api, author, {
        categoryId: cat.id,
        title: `${marker} draft`,
        content: 'Draft',
      })
      const ids = async (query: string) =>
        (await expectJson(await api.get(`/api/v1/help-center/articles?${query}`), 200)).data.map(
          (a: Wire) => a.id
        )

      const live = await expectJson(
        await api.get(`/api/v1/help-center/articles?categoryId=${cat.id}&status=published`),
        200
      )
      expect(live.data.map((a: Wire) => a.id)).toEqual([published.id])
      expect(Object.keys(live.data[0]).sort()).toEqual(ARTICLE_KEYS)
      expect(live.data[0].category).toMatchObject({ id: cat.id, slug: cat.slug, name: cat.name })
      expect((await ids(`categoryId=${cat.id}&status=draft`)).sort()).toEqual([draft.id])
      // An unknown status means all.
      expect((await ids(`categoryId=${cat.id}&status=bogus`)).sort()).toEqual(
        [published.id, draft.id].sort()
      )
      const page1 = await expectJson(
        await api.get(`/api/v1/help-center/articles?categoryId=${cat.id}&limit=1`),
        200
      )
      expect(page1.data).toHaveLength(1)
      expect(page1.meta.pagination.hasMore).toBe(true)
      const page2 = await expectJson(
        await api.get(
          `/api/v1/help-center/articles?categoryId=${cat.id}&limit=1&cursor=${page1.meta.pagination.cursor}`
        ),
        200
      )
      expect(page2.data).toHaveLength(1)
      expect(page2.data[0].id).not.toBe(page1.data[0].id)
      await api.dispose()
    }
  )

  test(
    'API-R-166 creating an article over REST needs a team author',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const cat = await createCategory(api, { name: `${marker} cat` })
      const post = (data: Record<string, unknown>) =>
        api.post('/api/v1/help-center/articles', {
          data: { categoryId: cat.id, title: `${marker} article`, content: 'Body', ...data },
        })

      const noAuthor = await expectJson(await post({}), 400)
      expect(noAuthor.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Service principals must provide an explicit authorId',
      })
      const teammate = people.people.agentB
      const created = await expectJson(await post({ authorId: teammate.principalId }), 201)
      expect(Object.keys(created.data).sort()).toEqual(ARTICLE_KEYS)
      expect(created.data.publishedAt).toBeNull()
      expect(created.data.author.id).toBe(teammate.principalId)
      const customer = await expectJson(
        await post({ authorId: people.people.customer.principalId }),
        400
      )
      expect(customer.error.message).toBe('Author must be a team member')
      const malformed = await expectJson(await post({ authorId: 'x' }), 400)
      expect(malformed.error.message).toBe('Invalid author ID format')
      const again = await expectJson(await post({ authorId: teammate.principalId }), 201)
      expect(again.data.slug).not.toBe(created.data.slug)
      const [{ n }] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM kb_articles WHERE title = ${`${marker} article`}`
      expect(n).toBe(2)
      await api.dispose()
    }
  )

  test(
    'API-R-167 PATCH publishedAt publishes now, republishes now, and null unpublishes; a bad author keeps it a draft',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const cat = await createCategory(api, { name: `${marker} cat` })
      const article = await createArticle(api, people.people.admin.principalId, {
        categoryId: cat.id,
        title: `${marker} article`,
        content: 'Body',
      })
      const patch = (data: Record<string, unknown>) =>
        api.patch(`/api/v1/help-center/articles/${article.id}`, { data })

      const before = Date.now()
      const pub = await expectJson(await patch({ publishedAt: '2020-01-01T00:00:00Z' }), 200)
      // The value is not stored: publishing means now.
      expect(Date.parse(pub.data.publishedAt)).toBeGreaterThanOrEqual(before - 1000)

      await supportDb()`UPDATE kb_articles SET published_at = NOW() - interval '1 day'
        WHERE id = ${uuid(article.id)}`
      const again = await expectJson(await patch({ publishedAt: '2030-01-01T00:00:00Z' }), 200)
      expect(Date.parse(again.data.publishedAt)).toBeGreaterThanOrEqual(before - 1000)
      expect(Date.parse(again.data.publishedAt)).toBeLessThanOrEqual(Date.now() + 1000)

      const unpub = await expectJson(await patch({ publishedAt: null }), 200)
      expect(unpub.data.publishedAt).toBeNull()
      expect((await articleRow(article.id)).published_at).toBeNull()

      const bad = await expectJson(
        await patch({
          authorId: people.people.customer.principalId,
          publishedAt: new Date().toISOString(),
        }),
        400
      )
      expect(bad.error.message).toBe('Author must be a team member')
      expect((await articleRow(article.id)).published_at).toBeNull()
      await api.dispose()
    }
  )

  test(
    'API-R-168 update article fields and category; an empty PATCH changes nothing; a deleted article is not found',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const author = people.people.admin.principalId
      const catA = await createCategory(api, { name: `${marker} a` })
      const catB = await createCategory(api, { name: `${marker} b` })
      const article = await createArticle(api, author, {
        categoryId: catA.id,
        title: `${marker} article`,
        content: 'Body',
      })
      const patch = (data: Record<string, unknown>) =>
        api.patch(`/api/v1/help-center/articles/${article.id}`, { data })

      const moved = await expectJson(
        await patch({
          title: `${marker} renamed`,
          content: 'New body',
          categoryId: catB.id,
          description: 'Desc',
        }),
        200
      )
      expect(moved.data).toMatchObject({
        title: `${marker} renamed`,
        content: 'New body',
        description: 'Desc',
        category: { id: catB.id },
      })
      const same = await expectJson(await patch({ authorId: author }), 200)
      expect(same.data.author.id).toBe(author)
      const empty = await expectJson(await patch({}), 200)
      expect(empty.data).toMatchObject({
        title: `${marker} renamed`,
        updatedAt: same.data.updatedAt,
      })

      expect((await api.delete(`/api/v1/help-center/articles/${article.id}`)).status()).toBe(204)
      const gone = await expectJson(await patch({ title: 'x' }), 404)
      expect(gone.error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Help center article not found',
      })
      await api.dispose()
    }
  )

  test(
    'API-R-169 delete an article: soft-deleted once, gone from the list',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const cat = await createCategory(api, { name: `${marker} cat` })
      const article = await createArticle(api, people.people.admin.principalId, {
        categoryId: cat.id,
        title: `${marker} article`,
        content: 'Body',
      })
      expect((await api.delete(`/api/v1/help-center/articles/${article.id}`)).status()).toBe(204)
      expect((await articleRow(article.id)).deleted_at).not.toBeNull()
      const list = await expectJson(
        await api.get(`/api/v1/help-center/articles?categoryId=${cat.id}`),
        200
      )
      expect(list.data).toEqual([])
      const again = await expectJson(
        await api.delete(`/api/v1/help-center/articles/${article.id}`),
        404
      )
      expect(again.error.message).toBe('Help center article not found')
      await api.dispose()
    }
  )
})

test.describe('REST help center: feedback', () => {
  test(
    'API-R-170 article feedback counts once per key and flips',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      // Whether any key may rate articles is an owner question; this key holds
      // the help center scopes.
      const { api, principalId } = await adminApi(playwright, baseURL, people, {
        scopes: ['read:article', 'write:article'],
      })
      const cat = await createCategory(api, { name: `${marker} cat` })
      const article = await createArticle(api, people.people.admin.principalId, {
        categoryId: cat.id,
        title: `${marker} article`,
        content: 'Body',
      })
      const vote = (data: Record<string, unknown>) =>
        api.post(`/api/v1/help-center/articles/${article.id}/feedback`, { data })
      const counts = async () => {
        const got = await expectJson(
          await api.get(`/api/v1/help-center/articles/${article.id}`),
          200
        )
        return [got.data.helpfulCount, got.data.notHelpfulCount]
      }

      expect(await expectJson(await vote({ helpful: true }), 200)).toEqual({
        data: { success: true },
      })
      expect(await counts()).toEqual([1, 0])
      await expectJson(await vote({ helpful: true }), 200)
      expect(await counts()).toEqual([1, 0])
      await expectJson(await vote({ helpful: false }), 200)
      expect(await counts()).toEqual([0, 1])
      const rows = await supportDb()<{ principal_id: string; helpful: boolean }[]>`
        SELECT principal_id, helpful FROM kb_article_feedback WHERE article_id = ${uuid(article.id)}`
      expect(rows).toEqual([{ principal_id: uuid(principalId), helpful: false }])
      const bad = await expectJson(await vote({}), 400)
      expect(Object.keys(bad.error.details.errors)).toEqual(['helpful'])
      await api.dispose()
    }
  )
})

test.describe('REST help center: refusals', () => {
  test(
    'API-R-172 help center writes need write:article and help_center.manage',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api: admin } = await adminApi(playwright, baseURL, people)
      const cat = await createCategory(admin, { name: `${marker} cat` })
      const article = await createArticle(admin, people.people.admin.principalId, {
        categoryId: cat.id,
        title: `${marker} article`,
        content: 'Body',
      })
      const { api: readArticle } = await adminApi(playwright, baseURL, people, {
        scopes: ['read:article'],
      })
      const { api: writeFeedback } = await adminApi(playwright, baseURL, people, {
        scopes: ['write:feedback'],
      })
      const contributor = await apiFor(
        playwright,
        baseURL,
        createKey({
          creatorEmail: people.people.contributor.email,
          kind: 'personal',
          scopes: ['read:article', 'write:article'],
        }).key
      )
      const cases: Array<[APIRequestContext, string]> = [
        [readArticle, missingScope('write:article', 'help_center.manage')],
        [writeFeedback, missingScope('write:article', 'help_center.manage')],
        [contributor, "Requires the 'help_center.manage' permission"],
      ]
      for (const [api, message] of cases) {
        for (const res of [
          await api.post('/api/v1/help-center/categories', { data: { name: `${marker} refused` } }),
          await api.patch(`/api/v1/help-center/articles/${article.id}`, {
            data: { title: `${marker} hijacked` },
          }),
        ]) {
          const body = await expectJson(res, 403)
          expect(body.error).toMatchObject({ code: 'FORBIDDEN', message })
        }
      }
      const [{ n }] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM kb_categories WHERE name LIKE ${`${marker}%`}`
      expect(n).toBe(1)
      const got = await expectJson(
        await admin.get(`/api/v1/help-center/articles/${article.id}`),
        200
      )
      expect(got.data.title).toBe(`${marker} article`)
      // Positive control: the admin key's PATCH goes through.
      const ok = await expectJson(
        await admin.patch(`/api/v1/help-center/articles/${article.id}`, {
          data: { title: `${marker} edited` },
        }),
        200
      )
      expect(ok.data.title).toBe(`${marker} edited`)
      for (const api of [admin, readArticle, writeFeedback, contributor]) await api.dispose()
    }
  )
})

test.describe('REST help center: bad input', () => {
  const quarantine = (description: string) => ({
    tag: ['@nightly', '@quarantine'],
    annotation: { type: 'quarantine', description },
  })

  test(
    'API-R-165 a malformed categoryId filter is refused as bad input',
    quarantine(
      'categoryId is not TypeID-validated; the driver throws: 500 ' +
        '(apps/web/src/routes/api/v1/help-center/articles/index.ts:76)'
    ),
    async ({ playwright, baseURL, people }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const res = await api.get('/api/v1/help-center/articles?categoryId=garbage')
      expect(res.status(), await res.text()).toBe(400)
      await api.dispose()
    }
  )

  test(
    'API-R-166 an article in a malformed or unknown category is refused, not a server error',
    quarantine(
      'categoryId is neither validated nor existence-checked: malformed and unknown ids give 500 ' +
        '(apps/web/src/routes/api/v1/help-center/articles/index.ts:21)'
    ),
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      for (const categoryId of ['garbage', generateId('kb_category')]) {
        const res = await api.post('/api/v1/help-center/articles', {
          data: {
            categoryId,
            title: `${marker} orphan`,
            content: 'x',
            authorId: people.people.admin.principalId,
          },
        })
        expect([400, 404], await res.text()).toContain(res.status())
      }
      await api.dispose()
    }
  )

  test(
    'API-R-171 feedback for an unknown article is not found, not a server error',
    quarantine(
      'The feedback insert violates the kb_article_feedback FK: 500 ' +
        '(apps/web/src/lib/server/domains/help-center/help-center.article-feedback.service.ts:63)'
    ),
    async ({ playwright, baseURL, people }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const res = await api.post(`/api/v1/help-center/articles/${generateId('article')}/feedback`, {
        data: { helpful: true },
      })
      const body = await expectJson(res, 404)
      expect(body.error.message).toBe('Help center article not found')
      await api.dispose()
    }
  )

  test(
    'API-R-163 a help center body that is not JSON is refused as bad input',
    quarantine(
      'request.json() throws outside the domain error mapping: 500 ' +
        '(apps/web/src/routes/api/v1/help-center/categories/index.ts:81, $categoryId.ts:91)'
    ),
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const cat = await createCategory(api, { name: `${marker} cat` })
      for (const res of [
        await rawJson(api, 'post', '/api/v1/help-center/categories'),
        await rawJson(api, 'patch', `/api/v1/help-center/categories/${cat.id}`),
      ]) {
        expect(res.status(), await res.text()).toBe(400)
      }
      await api.dispose()
    }
  )
})
