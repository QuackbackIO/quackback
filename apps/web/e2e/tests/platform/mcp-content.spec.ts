/**
 * MCP changelog and help-center tools (/api/mcp): scopes across domains,
 * drafts, publishing and its single announcement, publish dates, the
 * help-center feature switch, articles and categories.
 *
 * Journeys: API-M-18, API-M-35, API-M-70, API-M-71, API-M-72, API-M-73,
 * API-M-74, API-M-76, API-M-77, API-M-78, API-M-79, API-M-80, API-M-81,
 * API-M-82, API-M-83.
 *
 * API-M-78 turns the help center off for the workspace and runs in the
 * isolated job only.
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { ISOLATED } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { getMail, mailTo } from '../../support/mailpit'
import { fixture, mcpCall, seedCustomer } from '../../support/api-client'
import {
  ALL_SCOPES,
  adminApi,
  eventTypes,
  expectToolError,
  keyApi,
  newBoard,
  newPost,
  oauthApi,
  rawRpc,
  readResource,
  toolCallMsg,
  uuid,
  waitForAudit,
  waitForEventType,
  type Api,
} from '../../product/mcp'

test.describe.configure({ timeout: 60_000 })

const HC_OFF = 'Error: Help center is not enabled. Enable it in Settings → General.'
const DAY = 24 * 60 * 60 * 1000

/** A changelog subscriber made for this test. */
async function changelogSubscriber(marker: string): Promise<string> {
  const email = `${marker}-sub@customers.example`
  const { principalId } = await seedCustomer(email, `Subscriber ${marker}`)
  await supportDb()`
    INSERT INTO changelog_subscriptions (id, principal_id, source)
    VALUES (${uuid(generateId('changelog_sub'))}, ${uuid(principalId)}, 'admin')`
  return email
}

/** Mail to `to` whose text names `needle` (every subscriber hears every entry). */
async function mailsNaming(to: string, needle: string): Promise<string[]> {
  const out: string[] = []
  for (const summary of await mailTo(to)) {
    const full = await getMail(summary.ID)
    const body = `${full.Subject}\n${full.Text ?? ''}\n${full.HTML ?? ''}`
    if (body.includes(needle)) out.push(summary.ID)
  }
  return out
}

/** A help-center category made through MCP. */
async function newCategory(admin: Api, marker: string, extra: Record<string, unknown> = {}) {
  const res = await mcpCall(admin, 'manage_category', {
    action: 'create',
    name: `${marker} category`.slice(0, 200),
    ...extra,
  })
  expect(res.isError, res.text).toBe(false)
  return res.json as { id: string; slug: string; name: string }
}

/**
 * A draft article made through MCP. A key (a service principal) must name a
 * teammate as the author; an OAuth caller defaults to itself.
 */
async function newArticle(admin: Api, categoryId: string, title: string, authorId?: string) {
  const res = await mcpCall(admin, 'create_article', {
    categoryId,
    title,
    content: `${title} body`,
    ...(authorId ? { authorId } : {}),
  })
  expect(res.isError, res.text).toBe(false)
  return res.json as { id: string; slug: string; title: string }
}

/** A signed-out visitor's view of a public page: status and HTML. */
async function publicText(baseURL: string | undefined, path: string): Promise<string> {
  const res = await fetch(`${baseURL}${path}`)
  return `${res.status} ${await res.text()}`
}

test.describe('MCP changelog tools', () => {
  test(
    'API-M-18 write:changelog does not imply read:feedback, while a same-domain write implies its read',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const writer = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['write:changelog'],
      })
      const created = await mcpCall(writer.api, 'create_changelog', {
        title: `${marker} entry`,
        content: 'notes',
      })
      expect(created.isError, created.text).toBe(false)
      const id = created.json.id as string

      for (const [tool, args] of [
        ['search', { entity: 'changelogs' }],
        ['get_details', { id }],
      ] as const) {
        expectToolError(
          await mcpCall(writer.api, tool, args),
          'Error: Insufficient scope. Required: read:feedback'
        )
      }

      const oauth = await oauthApi(playwright, baseURL, people.people.admin.email, [
        'write:changelog',
      ])
      const stepped = await rawRpc(oauth, toolCallMsg('search', { entity: 'changelogs' }))
      expect(stepped.status).toBe(403)
      expect(stepped.headers['www-authenticate']).toContain('missing scope: read:feedback')

      const feedbackWriter = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['write:feedback'],
      })
      const read = await mcpCall(feedbackWriter.api, 'search', { query: marker })
      expect(read.isError, read.text).toBe(false)
    }
  )

  test(
    'API-M-70 create_changelog saves a draft by default: not public, not announced',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const res = await mcpCall(admin, 'create_changelog', {
        title: `${marker} draft`,
        content: 'Draft notes',
      })
      expect(res.isError, res.text).toBe(false)
      expect(Object.keys(res.json).sort()).toEqual(
        ['id', 'title', 'status', 'publishedAt', 'createdAt'].sort()
      )
      expect(res.json).toMatchObject({
        title: `${marker} draft`,
        status: 'draft',
        publishedAt: null,
      })
      const [row] = await supportDb()`SELECT published_at FROM changelog_entries
                                      WHERE id = ${uuid(res.json.id)}`
      expect(row.published_at).toBeNull()
      expect(await publicText(baseURL, '/changelog/feed')).not.toContain(`${marker} draft`)
      await new Promise((r) => setTimeout(r, 1000))
      expect(await eventTypes(res.json.id)).not.toContain('changelog.published')
    }
  )

  test(
    'API-M-71 create_changelog with publish announces once; publishing again is a no-op',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const subscriber = await changelogSubscriber(marker)
      const title = `${marker} release`

      const res = await mcpCall(admin, 'create_changelog', {
        title,
        content: 'Shipped today',
        publish: true,
      })
      expect(res.isError, res.text).toBe(false)
      expect(res.json.status).toBe('published')
      expect(Math.abs(Date.parse(res.json.publishedAt) - Date.now())).toBeLessThan(60_000)
      const id = res.json.id as string
      const [payload] = await waitForEventType(id, 'changelog.published')
      expect(payload).toMatchObject({ changelog: { id, title, linkedPostCount: 0 } })
      await pollFor(
        'the subscriber email',
        async () => ((await mailsNaming(subscriber, title)).length > 0 ? true : null),
        { timeoutMs: 20_000 }
      )
      expect(await publicText(baseURL, '/changelog/feed')).toContain(title)

      const again = await mcpCall(admin, 'update_changelog', { changelogId: id, publish: true })
      expect(again.isError, again.text).toBe(false)
      await new Promise((r) => setTimeout(r, 3000))
      expect((await eventTypes(id)).filter((t) => t === 'changelog.published')).toHaveLength(1)
      expect(await mailsNaming(subscriber, title)).toHaveLength(1)
    }
  )

  test(
    'API-M-72 create_changelog backdates from a past publishedAt and schedules from a future one',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const past = new Date(Date.now() - 30 * DAY).toISOString()
      const backdated = await mcpCall(admin, 'create_changelog', {
        title: `${marker} old`,
        content: 'x',
        publishedAt: past,
      })
      expect(backdated.json).toMatchObject({ status: 'published' })
      expect(Date.parse(backdated.json.publishedAt)).toBe(Date.parse(past))
      await waitForEventType(backdated.json.id, 'changelog.published')

      const future = new Date(Date.now() + DAY).toISOString()
      const scheduled = await mcpCall(admin, 'create_changelog', {
        title: `${marker} later`,
        content: 'x',
        publishedAt: future,
      })
      expect(scheduled.json).toMatchObject({ status: 'scheduled' })
      expect(await publicText(baseURL, '/changelog/feed')).not.toContain(`${marker} later`)
    }
  )

  test(
    'API-M-73 publishing an already published entry keeps its date',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'Product bug: update_changelog({ publish: true }) on a published entry resets publishedAt to now (mcp/tools/changelog.ts update_changelog). Fixed by open PR #812. See QUARANTINE.md.',
      },
    },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const past = new Date(Date.now() - 30 * DAY).toISOString()
      const created = await mcpCall(admin, 'create_changelog', {
        title: `${marker} old`,
        content: 'x',
        publishedAt: past,
      })
      const res = await mcpCall(admin, 'update_changelog', {
        changelogId: created.json.id,
        title: `${marker} renamed`,
        publish: true,
      })
      expect(res.isError, res.text).toBe(false)
      expect(Date.parse(res.json.publishedAt)).toBe(Date.parse(past))
    }
  )

  test(
    'API-M-74 update_changelog displayDate rules',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const draft = await mcpCall(admin, 'create_changelog', { title: `${marker} d`, content: 'x' })
      expectToolError(
        await mcpCall(admin, 'update_changelog', {
          changelogId: draft.json.id,
          displayDate: new Date(Date.now() - DAY).toISOString(),
        }),
        /Display date can only be set on published changelog entries/
      )
      const pub = await mcpCall(admin, 'create_changelog', {
        title: `${marker} p`,
        content: 'x',
        publish: true,
      })
      const id = pub.json.id as string
      expectToolError(
        await mcpCall(admin, 'update_changelog', {
          changelogId: id,
          displayDate: new Date(Date.now() + 2 * DAY).toISOString(),
        }),
        /Display date cannot be in the future/
      )
      const past = new Date(Date.now() - 10 * DAY).toISOString()
      const set = await mcpCall(admin, 'update_changelog', { changelogId: id, displayDate: past })
      expect(Date.parse(set.json.displayDate)).toBe(Date.parse(past))
      const sameDay = await mcpCall(admin, 'update_changelog', {
        changelogId: id,
        displayDate: new Date().toISOString(),
      })
      expect(sameDay.json.displayDate).toBeNull()
      await mcpCall(admin, 'update_changelog', { changelogId: id, displayDate: past })
      const cleared = await mcpCall(admin, 'update_changelog', {
        changelogId: id,
        displayDate: null,
      })
      expect(cleared.json.displayDate).toBeNull()
    }
  )

  test(
    'API-M-76 delete_changelog soft-deletes once',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const pub = await mcpCall(admin, 'create_changelog', {
        title: `${marker} gone`,
        content: 'x',
        publish: true,
      })
      const id = pub.json.id as string
      expect((await mcpCall(admin, 'delete_changelog', { changelogId: id })).json).toEqual({
        deleted: true,
        changelogId: id,
      })
      const [row] =
        await supportDb()`SELECT deleted_at FROM changelog_entries WHERE id = ${uuid(id)}`
      expect(row.deleted_at).not.toBeNull()
      expect(await publicText(baseURL, '/changelog/feed')).not.toContain(`${marker} gone`)
      const notFound = `Error: Changelog entry with ID ${id} not found (code: CHANGELOG_NOT_FOUND)`
      expectToolError(await mcpCall(admin, 'delete_changelog', { changelogId: id }), notFound)
      expectToolError(await mcpCall(admin, 'get_details', { id }), /not found/)
    }
  )

  test(
    'API-M-77 search and get_details list drafts, scheduled and published entries for the team',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} linked`)
      const draft = await mcpCall(admin, 'create_changelog', {
        title: `${marker} draft`,
        content: 'x',
      })
      const sched = await mcpCall(admin, 'create_changelog', {
        title: `${marker} sched`,
        content: 'x',
        publishedAt: new Date(Date.now() + DAY).toISOString(),
      })
      const pub = await mcpCall(admin, 'create_changelog', {
        title: `${marker} pub`,
        content: 'published body',
        publish: true,
      })
      await mcpCall(admin, 'update_changelog', {
        changelogId: pub.json.id,
        linkedPostIds: [post.id],
      })

      // `query` does not narrow changelog search, so read a full page (newest
      // first) and look for this test's three entries in it.
      const mine = [draft.json.id, sched.json.id, pub.json.id]
      const page = async (status: string) => {
        const res = await mcpCall(admin, 'search', { entity: 'changelogs', status, limit: 100 })
        expect(res.isError, res.text).toBe(false)
        return res.json.changelogs as Array<{ id: string }>
      }
      const idsFor = async (status: string) =>
        (await page(status)).map((c) => c.id).filter((id) => mine.includes(id))
      expect(await idsFor('draft')).toEqual([draft.json.id])
      expect(await idsFor('scheduled')).toEqual([sched.json.id])
      expect(await idsFor('published')).toEqual([pub.json.id])
      expect((await idsFor('all')).sort()).toEqual([...mine].sort())
      expect((await idsFor('nonsense')).sort()).toEqual([...mine].sort())

      const listed = (await page('published')).filter((c) => c.id === pub.json.id)
      expect(listed[0]).toMatchObject({
        id: pub.json.id,
        status: 'published',
        linkedPosts: [{ id: post.id, title: `${marker} linked` }],
      })
      const details = await mcpCall(admin, 'get_details', { id: pub.json.id })
      expect(details.json).toMatchObject({ id: pub.json.id, content: 'published body' })
      expect(details.json.linkedPosts[0]).toHaveProperty('status')
      expect(details.json).toHaveProperty('updatedAt')
    }
  )
})

test.describe('MCP help-center tools', () => {
  test(
    'API-M-78 with the help center off every article tool refuses first',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, baseURL, people, marker }) => {
      test.skip(!ISOLATED, 'runs in product-isolated')
      const admin = await keyApi(playwright, baseURL, { creatorEmail: people.people.admin.email })
      const category = await newCategory(admin.api, marker)
      const article = await newArticle(
        admin.api,
        category.id,
        `${marker} article`,
        people.people.admin.principalId
      )
      const noArticleScope = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['read:feedback'],
      })
      const oauth = await oauthApi(playwright, baseURL, people.people.admin.email, [
        'read:feedback',
      ])

      await withSettings({ feature_flags: { helpCenter: false } }, async () => {
        const writes = [
          ['create_article', { categoryId: category.id, title: `${marker} x`, content: 'x' }],
          ['update_article', { articleId: article.id, title: `${marker} y` }],
          ['delete_article', { articleId: article.id }],
          ['manage_category', { action: 'update', categoryId: category.id, name: 'z' }],
        ] as const
        for (const [tool, args] of writes) {
          expectToolError(await mcpCall(admin.api, tool, args), HC_OFF)
          const rows = await waitForAudit({ tool, credentialId: admin.id })
          expect(rows.at(-1)).toMatchObject({
            event_outcome: 'failure',
            metadata: { tool, errorCode: 'FEATURE_DISABLED' },
          })
        }
        expectToolError(await mcpCall(admin.api, 'search', { entity: 'articles' }), HC_OFF)
        expectToolError(await mcpCall(admin.api, 'get_details', { id: article.id }), HC_OFF)
        // A key without write:article hears about the feature, not the scope.
        expectToolError(
          await mcpCall(noArticleScope.api, 'create_article', {
            categoryId: category.id,
            title: 'x',
            content: 'x',
          }),
          HC_OFF
        )
        // An OAuth token without it is stepped up before any tool runs.
        const stepped = await rawRpc(
          oauth,
          toolCallMsg('create_article', { categoryId: category.id, title: 'x', content: 'x' })
        )
        expect(stepped.status).toBe(403)
        // The categories resource answers the same refusal (API-M-35 step 3).
        const resource = await readResource(admin.api, 'quackback://help-center/categories')
        expect(resource.text).toBe('Help center is not enabled. Enable it in Settings → General.')
      })
      const [row] =
        await supportDb()`SELECT title, deleted_at FROM kb_articles WHERE id = ${uuid(article.id)}`
      expect(row).toEqual({ title: `${marker} article`, deleted_at: null })
    }
  )

  test(
    'API-M-79 create_article saves a draft; the author must be a teammate',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await oauthApi(playwright, baseURL, people.people.admin.email, ALL_SCOPES)
      const category = await newCategory(admin, marker)
      const res = await mcpCall(admin, 'create_article', {
        categoryId: category.id,
        title: `${marker} How to start`,
        content: '## Steps\n1. Open the app',
      })
      expect(res.isError, res.text).toBe(false)
      for (const key of [
        'id',
        'slug',
        'title',
        'content',
        'description',
        'position',
        'category',
        'author',
        'publishedAt',
        'viewCount',
        'helpfulCount',
        'notHelpfulCount',
        'createdAt',
        'updatedAt',
      ]) {
        expect(res.json, key).toHaveProperty(key)
      }
      expect(res.json.id).toMatch(/^article_/)
      expect(res.json).toMatchObject({
        title: `${marker} How to start`,
        publishedAt: null,
        category: { id: category.id },
      })
      expect(res.json.content).toContain('## Steps')
      expect(res.json.slug).toContain('how-to-start')
      expect(await publicText(baseURL, `/hc/${category.slug}/${res.json.slug}`)).not.toContain(
        `${marker} How to start`
      )

      const customer = await seedCustomer(`${marker}@customers.example`)
      expectToolError(
        await mcpCall(admin, 'create_article', {
          categoryId: category.id,
          title: `${marker} by customer`,
          content: 'x',
          authorId: customer.principalId,
        }),
        /Author must be a team member \(code: VALIDATION_ERROR\)$/
      )
      const bad = await mcpCall(admin, 'create_article', {
        categoryId: category.id,
        title: `${marker} bad author`,
        content: 'x',
        authorId: 'not-a-principal',
      })
      expect(bad.isError).toBe(true)
      expectToolError(
        await mcpCall(admin, 'create_article', {
          categoryId: category.id,
          title: '',
          content: 'x',
        }),
        /Title is required/
      )
      const rows =
        await supportDb()`SELECT title FROM kb_articles WHERE category_id = ${uuid(category.id)}`
      expect(rows.map((r) => r.title)).toEqual([`${marker} How to start`])
    }
  )

  test(
    'API-M-80 update_article publishes now, unpublishes and edits in place; a bad author stops the publish',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await oauthApi(playwright, baseURL, people.people.admin.email, ALL_SCOPES)
      const category = await newCategory(admin, marker)
      const article = await newArticle(admin, category.id, `${marker} Guide`)
      const page = `/hc/${category.slug}/${article.slug}`

      const published = await mcpCall(admin, 'update_article', {
        articleId: article.id,
        publishedAt: '2020-01-01T00:00:00Z',
      })
      expect(published.isError, published.text).toBe(false)
      expect(Math.abs(Date.parse(published.json.publishedAt) - Date.now())).toBeLessThan(60_000)
      expect(await publicText(baseURL, page)).toContain(`${marker} Guide`)

      const unpublished = await mcpCall(admin, 'update_article', {
        articleId: article.id,
        publishedAt: null,
      })
      expect(unpublished.json.publishedAt).toBeNull()
      expect(await publicText(baseURL, page)).not.toContain(`${marker} Guide`)

      const renamed = await mcpCall(admin, 'update_article', {
        articleId: article.id,
        title: `${marker} Guide v2`,
      })
      expect(renamed.json).toMatchObject({
        title: `${marker} Guide v2`,
        slug: article.slug,
        content: `${marker} Guide body`,
        publishedAt: null,
      })

      const customer = await seedCustomer(`${marker}@customers.example`)
      const refused = await mcpCall(admin, 'update_article', {
        articleId: article.id,
        authorId: customer.principalId,
        publishedAt: '2020-01-01T00:00:00Z',
      })
      expect(refused.isError).toBe(true)
      const [row] =
        await supportDb()`SELECT published_at FROM kb_articles WHERE id = ${uuid(article.id)}`
      expect(row.published_at).toBeNull()

      const notDate = await rawRpc(
        admin,
        toolCallMsg('update_article', { articleId: article.id, publishedAt: 'tomorrow' })
      )
      expect(JSON.stringify(notDate.body)).toMatch(/publishedAt|Invalid/)
      expect(
        (await supportDb()`SELECT published_at FROM kb_articles WHERE id = ${uuid(article.id)}`)[0]
          .published_at
      ).toBeNull()
    }
  )

  test(
    'API-M-81 delete_article soft-deletes once and the public page goes away',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await oauthApi(playwright, baseURL, people.people.admin.email, ALL_SCOPES)
      const category = await newCategory(admin, marker)
      const article = await newArticle(admin, category.id, `${marker} Doomed`)
      await mcpCall(admin, 'update_article', {
        articleId: article.id,
        publishedAt: '2020-01-01T00:00:00Z',
      })
      const page = `/hc/${category.slug}/${article.slug}`
      expect(await publicText(baseURL, page)).toContain(`${marker} Doomed`)

      expect((await mcpCall(admin, 'delete_article', { articleId: article.id })).json).toEqual({
        deleted: true,
        id: article.id,
      })
      expect(await publicText(baseURL, page)).not.toContain(`${marker} Doomed`)
      expectToolError(
        await mcpCall(admin, 'delete_article', { articleId: article.id }),
        `Error: Article ${article.id} not found (code: ARTICLE_NOT_FOUND)`
      )
    }
  )

  test(
    'API-M-82 manage_category creates, updates and deletes with its children; refusals name the missing field',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await oauthApi(playwright, baseURL, people.people.admin.email, ALL_SCOPES)
      const parent = await mcpCall(admin, 'manage_category', {
        action: 'create',
        name: `${marker} parent`,
        icon: 'RocketLaunchIcon',
      })
      expect(Object.keys(parent.json).sort()).toEqual(
        [
          'id',
          'slug',
          'name',
          'description',
          'icon',
          'parentId',
          'isPublic',
          'position',
          'createdAt',
          'updatedAt',
        ].sort()
      )
      expect(parent.json).toMatchObject({ icon: 'RocketLaunchIcon', parentId: null })
      const child = await mcpCall(admin, 'manage_category', {
        action: 'create',
        name: `${marker} child`,
        parentId: parent.json.id,
      })
      const article = await newArticle(admin, child.json.id, `${marker} nested`)

      const priv = await mcpCall(admin, 'manage_category', {
        action: 'update',
        categoryId: parent.json.id,
        isPublic: false,
      })
      expect(priv.json.isPublic).toBe(false)

      expect(
        (await mcpCall(admin, 'manage_category', { action: 'delete', categoryId: parent.json.id }))
          .json
      ).toEqual({ deleted: true, id: parent.json.id })
      const [childRow] =
        await supportDb()`SELECT deleted_at FROM kb_categories WHERE id = ${uuid(child.json.id)}`
      expect(childRow.deleted_at).not.toBeNull()
      const [articleRow] =
        await supportDb()`SELECT deleted_at FROM kb_articles WHERE id = ${uuid(article.id)}`
      expect(articleRow.deleted_at).not.toBeNull()

      expectToolError(
        await mcpCall(admin, 'manage_category', { action: 'create' }),
        'Error: name is required when action is "create"'
      )
      expectToolError(
        await mcpCall(admin, 'manage_category', { action: 'update', name: 'x' }),
        'Error: categoryId is required when action is "update"'
      )
      expectToolError(
        await mcpCall(admin, 'manage_category', { action: 'delete' }),
        'Error: categoryId is required when action is "delete"'
      )
      const emoji = await rawRpc(
        admin,
        toolCallMsg('manage_category', { action: 'create', name: `${marker} emoji`, icon: '🚀' })
      )
      expect(JSON.stringify(emoji.body)).toContain(
        'Not a category icon. Use a Heroicons name such as \\"RocketLaunchIcon\\".'
      )
    }
  )

  test(
    'API-M-83 search and get_details cover drafts, private categories and both article prefixes',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await oauthApi(playwright, baseURL, people.people.admin.email, ALL_SCOPES)
      const open = await newCategory(admin, marker, { isPublic: true })
      const hidden = await newCategory(admin, `${marker} hidden`, { isPublic: false })
      const draft = await newArticle(admin, open.id, `${marker} draft`)
      const live = await newArticle(admin, hidden.id, `${marker} live`)
      await mcpCall(admin, 'update_article', {
        articleId: live.id,
        publishedAt: '2020-01-01T00:00:00Z',
      })

      const res = await mcpCall(admin, 'search', { entity: 'articles', query: marker })
      expect(res.isError, res.text).toBe(false)
      const ids = res.json.articles.map((a: { id: string }) => a.id).sort()
      expect(ids).toEqual([draft.id, live.id].sort())
      const byCategory = await mcpCall(admin, 'search', {
        entity: 'articles',
        categoryId: hidden.id,
      })
      expect(byCategory.json.articles.map((a: { id: string }) => a.id)).toEqual([live.id])
      expect(byCategory.json.articles[0]).toMatchObject({
        categoryId: hidden.id,
        categorySlug: hidden.slug,
      })

      const viaArticle = await mcpCall(admin, 'get_details', { id: live.id })
      expect(viaArticle.json).toMatchObject({ id: live.id, title: `${marker} live` })
      const viaAlias = await mcpCall(admin, 'get_details', {
        id: live.id.replace(/^article_/, 'kb_article_'),
      })
      expect(viaAlias.json).toMatchObject({ id: live.id })
      const cat = await mcpCall(admin, 'get_details', { id: hidden.id })
      expect(cat.json).toMatchObject({ id: hidden.id, isPublic: false })
    }
  )

  test(
    'API-M-35 the help-center categories resource is team-only',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      fixture({ op: 'enablePortalMcp' })
      const admin = await oauthApi(playwright, baseURL, people.people.admin.email, ALL_SCOPES)
      const hidden = await newCategory(admin, marker, { isPublic: false })
      const listed = await readResource(admin, 'quackback://help-center/categories')
      expect(listed.status).toBe(200)
      const mine = listed.json.find((c: { id: string }) => c.id === hidden.id)
      expect(Object.keys(mine).sort()).toEqual(
        [
          'id',
          'slug',
          'name',
          'description',
          'icon',
          'parentId',
          'isPublic',
          'position',
          'articleCount',
        ].sort()
      )
      expect(mine).toMatchObject({ isPublic: false, articleCount: 0 })

      await seedCustomer(`${marker}@customers.example`)
      const portal = await oauthApi(playwright, baseURL, `${marker}@customers.example`, [
        'read:article',
      ])
      const refused = await readResource(portal, 'quackback://help-center/categories')
      expect(refused.status).toBe(200)
      expect(refused.text).toBe(
        'Error: This resource requires a team member (admin or member) role.'
      )
    }
  )
})
