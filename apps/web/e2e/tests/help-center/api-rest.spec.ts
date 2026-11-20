/**
 * Help center REST API (/api/v1/help-center/...): articles, categories,
 * authors, permissions and the article feedback endpoint.
 *
 * Journeys: HC-A-11, HC-A-16, HC-A-70, HC-A-71, HC-A-72, HC-A-73, HC-A-74,
 * HC-A-75, HC-A-76, HC-F-07.
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { apiFor, createKey, expectJson, type Wire } from '../../support/api-client'
import { supportEnv } from '../../support/env'
import { SUPPORT_PEOPLE } from '../../support/people'
import { supportDb } from '../../support/db'
import {
  adminPrincipalId,
  articlePath,
  articleRow,
  categoryRow,
  hcApi,
  hcArticle,
  hcCategory,
  searchWord,
  uuidOfTypeId,
} from '../../product/help-center'

const baseURL = supportEnv().baseUrl
const ARTICLES = '/api/v1/help-center/articles'
const CATEGORIES = '/api/v1/help-center/categories'

/** Every item of a paginated article list, following the cursor. */
async function listAll(
  api: Awaited<ReturnType<typeof hcApi>>,
  query: Record<string, string>
): Promise<{ items: Wire[]; pages: number }> {
  const items: Wire[] = []
  let cursor: string | null = null
  let pages = 0
  do {
    const params = new URLSearchParams({ ...query, ...(cursor ? { cursor } : {}) })
    const body = await expectJson<{ data: Wire[]; meta: Wire }>(
      await api.get(`${ARTICLES}?${params}`),
      200
    )
    items.push(...body.data)
    pages++
    cursor = body.meta.pagination.hasMore ? body.meta.pagination.cursor : null
  } while (cursor && pages < 20)
  return { items, pages }
}

test.describe('articles over REST', () => {
  test(
    'HC-A-70 the article list filters by status, category and search and pages by cursor',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const hc = await hcApi(playwright)
      const word = searchWord()
      const category = await hcCategory(hc, `Listed ${marker}`, { isPublic: false })
      const draftA = await hcArticle(hc, { categoryId: category.id, title: `Draft A ${marker}` })
      const draftB = await hcArticle(hc, {
        categoryId: category.id,
        title: `Draft B ${word} ${marker}`,
        content: '# Heading\n\nSome **bold** text.',
      })
      const live = await hcArticle(hc, {
        categoryId: category.id,
        title: `Live ${marker}`,
        publish: true,
      })

      // Drafts only, in this (private) category, one per page.
      const drafts = await listAll(hc, { categoryId: category.id, status: 'draft', limit: '1' })
      expect(drafts.items.map((a) => a.id).sort()).toEqual([draftA.id, draftB.id].sort())
      expect(drafts.pages).toBe(2)

      const published = await listAll(hc, { categoryId: category.id, status: 'published' })
      expect(published.items.map((a) => a.id)).toEqual([live.id])
      const all = await listAll(hc, { categoryId: category.id })
      expect(all.items).toHaveLength(3)

      // Each item carries markdown content, counters, category and author.
      const b = all.items.find((a) => a.id === draftB.id)
      expect(b).toMatchObject({
        title: draftB.title,
        publishedAt: null,
        viewCount: 0,
        helpfulCount: 0,
        notHelpfulCount: 0,
        category: { id: category.id, slug: category.slug },
        author: { name: SUPPORT_PEOPLE.admin.name },
      })
      expect(b.content).toContain('**bold**')

      // Search ranks within the filters.
      const found = await listAll(hc, { categoryId: category.id, search: word })
      expect(found.items.map((a) => a.id)).toEqual([draftB.id])

      // No key, no list.
      const anon = await apiFor(playwright, baseURL, null)
      expect((await anon.get(ARTICLES)).status()).toBe(401)
    }
  )

  test(
    'HC-A-71 one article by id: drafts are returned, a malformed id is 400, unknown or deleted 404',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `One ${marker}`)
      const draft = await hcArticle(hc, { categoryId: category.id, title: `Got ${marker}` })

      const got = await expectJson<{ data: Wire }>(await hc.get(`${ARTICLES}/${draft.id}`), 200)
      expect(got.data).toMatchObject({
        id: draft.id,
        title: draft.title,
        publishedAt: null,
        category: { id: category.id },
        author: { name: SUPPORT_PEOPLE.admin.name },
      })
      // The retired kb_article_ prefix still resolves.
      const alias = draft.id.replace(/^article_/, 'kb_article_')
      expect((await hc.get(`${ARTICLES}/${alias}`)).status()).toBe(200)

      expect((await hc.get(`${ARTICLES}/not-an-id`)).status()).toBe(400)
      const unknown = await hc.get(`${ARTICLES}/${generateId('article')}`)
      expect(unknown.status()).toBe(404)

      expect((await hc.delete(`${ARTICLES}/${draft.id}`)).status()).toBe(204)
      expect((await hc.get(`${ARTICLES}/${draft.id}`)).status()).toBe(404)
    }
  )

  test(
    'HC-A-72 create: a draft with editor JSON from markdown; field errors; permission',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Create ${marker}`)
      const res = await hc.post(ARTICLES, {
        data: {
          categoryId: category.id,
          title: `  Created ${marker}  `,
          content: '## Steps\n\n1. One\n2. Two',
          description: `About ${marker}`,
          slug: `custom-${marker}`,
          authorId: adminPrincipalId(),
        },
      })
      const { data } = await expectJson<{ data: Wire }>(res, 201)
      expect(data).toMatchObject({
        title: `Created ${marker}`,
        slug: `custom-${marker}`,
        description: `About ${marker}`,
        publishedAt: null,
      })
      const row = await articleRow(uuidOfTypeId(data.id))
      const json = JSON.stringify(row?.content_json)
      expect(json).toContain('"type":"heading"')
      expect(json).toContain('"type":"orderedList"')

      // Field errors: no category, empty title or content, long title or description.
      const bad = async (body: Record<string, unknown>, field: string) => {
        const r = await expectJson<{ error: Wire }>(
          await hc.post(ARTICLES, {
            data: { categoryId: category.id, title: 'T', content: 'C', ...body },
          }),
          400
        )
        expect(Object.keys(r.error.details?.errors ?? {}), JSON.stringify(r)).toContain(field)
      }
      await bad({ categoryId: undefined }, 'categoryId')
      await bad({ title: '' }, 'title')
      await bad({ content: '' }, 'content')
      await bad({ title: 'x'.repeat(201) }, 'title')
      await bad({ description: 'x'.repeat(301) }, 'description')

      // A key whose person cannot manage the help center cannot create.
      const contributor = await apiFor(
        playwright,
        baseURL,
        createKey({ creatorEmail: SUPPORT_PEOPLE.contributor.email }).key
      )
      const refused = await contributor.post(ARTICLES, {
        data: { categoryId: category.id, title: `Refused ${marker}`, content: 'C' },
      })
      expect(refused.status()).toBe(403)
    }
  )

  test(
    'HC-A-11 authors: a key needs an explicit team author; others are refused',
    { tag: '@core' },
    async ({ playwright, marker, people }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Authors ${marker}`)
      const base = { categoryId: category.id, content: 'C' }

      const noAuthor = await expectJson<{ error: Wire }>(
        await hc.post(ARTICLES, { data: { ...base, title: `No author ${marker}` } }),
        400
      )
      expect(noAuthor.error.message).toBe('Service principals must provide an explicit authorId')

      const customer = await expectJson<{ error: Wire }>(
        await hc.post(ARTICLES, {
          data: {
            ...base,
            title: `Customer ${marker}`,
            authorId: people.people.customer.principalId,
          },
        }),
        400
      )
      expect(customer.error.message).toBe('Author must be a team member')

      const unknown = await expectJson<{ error: Wire }>(
        await hc.post(ARTICLES, {
          data: {
            ...base,
            title: `Unknown ${marker}`,
            authorId: generateId('principal'),
          },
        }),
        400
      )
      expect(unknown.error.message).toBe('Author not found')

      const teammate = await expectJson<{ data: Wire }>(
        await hc.post(ARTICLES, {
          data: { ...base, title: `By Ben ${marker}`, authorId: people.people.agentB.principalId },
        }),
        201
      )
      expect(teammate.data.author).toMatchObject({
        id: people.people.agentB.principalId,
        name: SUPPORT_PEOPLE.agentB.name,
      })
      const rows =
        await supportDb()`SELECT title FROM kb_articles WHERE title LIKE ${`%${marker}%`}`
      expect(rows.map((r) => r.title)).toEqual([`By Ben ${marker}`])
    }
  )

  test(
    'HC-A-73 update: fields, an emptied description, author, category and publish state',
    { tag: '@core' },
    async ({ playwright, marker, people }) => {
      const hc = await hcApi(playwright)
      const from = await hcCategory(hc, `Patch from ${marker}`)
      const to = await hcCategory(hc, `Patch to ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: from.id,
        title: `Patched ${marker}`,
        description: `Was described ${marker}`,
      })
      const patch = (data: Record<string, unknown>) =>
        hc.patch(`${ARTICLES}/${article.id}`, { data })

      // A bad author refuses the whole update: the title does not change.
      const refused = await patch({
        title: `Never ${marker}`,
        authorId: people.people.customer.principalId,
      })
      expect(refused.status()).toBe(400)
      expect((await articleRow(article.uuid))?.title).toBe(article.title)

      const updated = await expectJson<{ data: Wire }>(
        await patch({
          title: `Renamed ${marker}`,
          description: '',
          categoryId: to.id,
          authorId: people.people.agentB.principalId,
          publishedAt: '2001-01-01T00:00:00.000Z',
        }),
        200
      )
      expect(updated.data).toMatchObject({
        title: `Renamed ${marker}`,
        description: null,
        category: { id: to.id },
        author: { id: people.people.agentB.principalId },
      })
      // Any datetime publishes now; the value sent is not stored.
      const publishedAt = new Date(updated.data.publishedAt as string).getTime()
      expect(Math.abs(publishedAt - Date.now())).toBeLessThan(60_000)

      const unpublished = await expectJson<{ data: Wire }>(await patch({ publishedAt: null }), 200)
      expect(unpublished.data.publishedAt).toBeNull()
      expect((await articleRow(article.uuid))?.published_at).toBeNull()

      // An empty body changes nothing.
      const same = await expectJson<{ data: Wire }>(await patch({}), 200)
      expect(same.data).toMatchObject({ title: `Renamed ${marker}`, publishedAt: null })
    }
  )

  test(
    'HC-A-74 delete: 204 and a soft delete, then 404',
    { tag: '@core' },
    async ({ playwright, marker, request }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Delete ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Deleted ${marker}`,
        publish: true,
      })
      expect((await request.get(articlePath(article))).status()).toBe(200)

      expect((await hc.delete(`${ARTICLES}/${article.id}`)).status()).toBe(204)
      expect((await articleRow(article.uuid))?.deleted_at).not.toBeNull()
      expect((await request.get(articlePath(article), { maxRedirects: 0 })).status()).toBe(404)
      const listed = await listAll(hc, { categoryId: category.id })
      expect(listed.items).toEqual([])

      expect((await hc.delete(`${ARTICLES}/${article.id}`)).status()).toBe(404)
    }
  )

  test(
    'HC-A-16 a whitespace-only title or category name is refused on update',
    {
      tag: '@core',
    },
    async ({ playwright, marker }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Blank ${marker}`)
      const article = await hcArticle(hc, { categoryId: category.id, title: `Blank ${marker}` })

      const title = await hc.patch(`${ARTICLES}/${article.id}`, { data: { title: '   ' } })
      const name = await hc.patch(`${CATEGORIES}/${category.id}`, { data: { name: '   ' } })
      // Whatever the answers, nothing may be stored blank.
      expect((await articleRow(article.uuid))?.title).toBe(article.title)
      expect((await categoryRow(category.uuid))?.name).toBe(category.name)
      expect(title.status()).toBe(400)
      expect(name.status()).toBe(400)
    }
  )
})

test.describe('categories over REST', () => {
  test(
    'HC-A-75 categories: create, read, update, list with counts, delete cascades',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const hc = await hcApi(playwright)
      const created = await expectJson<{ data: Wire }>(
        await hc.post(CATEGORIES, {
          data: {
            name: `Parent ${marker}`,
            description: 'Top',
            isPublic: false,
            icon: 'book',
            position: 3,
          },
        }),
        201
      )
      expect(created.data).toMatchObject({
        name: `Parent ${marker}`,
        description: 'Top',
        isPublic: false,
        icon: 'book',
        position: 3,
        parentId: null,
      })
      const parentId = created.data.id as string
      const child = await hcCategory(hc, `Child ${marker}`, { parentId })
      const article = await hcArticle(hc, { categoryId: child.id, title: `Under child ${marker}` })

      const got = await expectJson<{ data: Wire }>(await hc.get(`${CATEGORIES}/${parentId}`), 200)
      expect(got.data.name).toBe(`Parent ${marker}`)

      const patched = await expectJson<{ data: Wire }>(
        await hc.patch(`${CATEGORIES}/${parentId}`, {
          data: { name: `Renamed parent ${marker}`, description: null },
        }),
        200
      )
      expect(patched.data).toMatchObject({ name: `Renamed parent ${marker}`, description: null })

      // The list includes private categories, with article counts.
      const list = await expectJson<{ data: Wire[] }>(await hc.get(CATEGORIES), 200)
      const listedChild = list.data.find((c) => c.id === child.id)
      expect(list.data.some((c) => c.id === parentId)).toBe(true)
      expect(listedChild?.articleCount).toBe(1)

      // A category cannot be its own descendant's child.
      const cycle = await hc.patch(`${CATEGORIES}/${parentId}`, { data: { parentId: child.id } })
      expect(cycle.status()).toBe(400)

      // Delete cascades to the sub-category and its article.
      expect((await hc.delete(`${CATEGORIES}/${parentId}`)).status()).toBe(204)
      expect((await categoryRow(child.uuid))?.deleted_at).not.toBeNull()
      expect((await articleRow(article.uuid))?.deleted_at).not.toBeNull()
      expect((await hc.get(`${CATEGORIES}/${parentId}`)).status()).toBe(404)
    }
  )

  test(
    'HC-A-76 a key without help_center.manage cannot read drafts or private categories',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'HC-B3: REST GET article list, article, category list and category call withApiKeyAuth(request) with no permission and read at team scope',
      },
    },
    async ({ playwright, marker }) => {
      const hc = await hcApi(playwright)
      const hidden = await hcCategory(hc, `Hidden ${marker}`, { isPublic: false })
      const draft = await hcArticle(hc, { categoryId: hidden.id, title: `Secret ${marker}` })
      const contributor = await apiFor(
        playwright,
        baseURL,
        createKey({ creatorEmail: SUPPORT_PEOPLE.contributor.email }).key
      )

      const one = await contributor.get(`${ARTICLES}/${draft.id}`)
      const list = await contributor.get(`${ARTICLES}?status=draft&categoryId=${hidden.id}`)
      const cat = await contributor.get(`${CATEGORIES}/${hidden.id}`)
      const cats = await contributor.get(CATEGORIES)
      const text = [await one.text(), await list.text(), await cat.text(), await cats.text()]
      for (const body of text) {
        expect(body).not.toContain(`Secret ${marker}`)
        expect(body).not.toContain(`Hidden ${marker}`)
      }
      expect(one.status()).toBe(403)
    }
  )
})

test.describe('feedback over REST', () => {
  test(
    'HC-F-07 the feedback endpoint records a vote and moves the counters',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Votes ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Voted ${marker}`,
        publish: true,
      })
      const res = await hc.post(`${ARTICLES}/${article.id}/feedback`, { data: { helpful: true } })
      expect(res.status()).toBeLessThan(300)
      await expect.poll(async () => (await articleRow(article.uuid))?.helpful_count).toBe(1)
      const bad = await hc.post(`${ARTICLES}/${article.id}/feedback`, { data: { helpful: 'yes' } })
      expect(bad.status()).toBe(400)
      const anon = await apiFor(playwright, baseURL, null)
      const refused = await anon.post(`${ARTICLES}/${article.id}/feedback`, {
        data: { helpful: true },
      })
      expect(refused.status()).toBe(401)
    }
  )
})
