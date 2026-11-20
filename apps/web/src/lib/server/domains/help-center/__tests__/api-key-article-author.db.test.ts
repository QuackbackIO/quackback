/**
 * Real-Postgres coverage for whose name a help center article an API key wrote
 * shows on the public help center.
 *
 * An article a workspace key wrote, or a personal key that keeps its own name
 * (made before the cutoff), shows the support team's name with no avatar on
 * every public read: the article page (by url id, id and slug, which the
 * portal, widget help and embeds use), the public article list, and both
 * category lists. A personal key made after the cutoff shows its creator. The
 * team's views keep the key's name, and a teammate's article is unchanged.
 *
 * Keys come from createApiKey; the reads are the real loaders.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type KbArticleId,
  type KbCategoryId,
  type PrincipalId,
  type RoleId,
  type UserId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/config')>()),
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheDel: vi.fn(),
}))

vi.mock('@/lib/server/domains/teams', () => ({
  addPrincipalToDefaultTeam: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/membership-sync', () => ({
  enqueueMembershipSync: vi.fn(async () => {}),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  helpCenterArticles,
  helpCenterCategories,
  principal,
  roles,
  settings,
  sql,
  user,
} from '@/lib/server/db'
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '@/lib/shared/permissions'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import {
  getSupportTeamName,
  PERSONAL_KEY_CUTOFF_KV_KEY,
} from '@/lib/server/domains/principals/principal-display'
import {
  getArticleById,
  getPublicArticleById,
  getPublicArticleBySlug,
  getPublicArticleByUrlId,
} from '../help-center.article.service'
import {
  listArticles,
  listPublicArticles,
  listPublicArticlesForCategories,
  listPublicArticlesForCategory,
} from '../help-center.article.query'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: helpCenterArticles.id }).from(helpCenterArticles).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const KEY_NAME = 'docs-bot'
const PUBLIC_NAME = 'Pat from Support'
const CREATOR_IMAGE = 'https://images.example.com/pat.png'
const WRITER_NAME = 'Wren Writer'
const WRITER_IMAGE = 'https://images.example.com/wren.png'

async function setCutoff(at: Date | null): Promise<void> {
  await testDb.execute(sql`delete from kv_store where key = ${PERSONAL_KEY_CUTOFF_KV_KEY}`)
  if (!at) return
  await testDb.execute(sql`insert into kv_store (workspace_key, key, value, expires_at)
    values ('_', ${PERSONAL_KEY_CUTOFF_KV_KEY}, to_jsonb(${at.toISOString()}::timestamptz),
      now() + interval '100 years')`)
}

const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000)
const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000)

async function seedTeammate(displayName: string, image: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: `${displayName} Account`,
    image,
    email: `article-author-${suffix()}@example.com`,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'admin',
    type: 'user',
    displayName,
    createdAt: new Date(),
  })
  return principalId
}

async function managerRoleId(): Promise<RoleId> {
  const [row] = await testDb
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, SYSTEM_ROLES.MANAGER))
  return row.id as RoleId
}

async function workspaceKey(creator: PrincipalId): Promise<PrincipalId> {
  const { apiKey } = await createApiKey(
    { name: KEY_NAME, kind: 'workspace', roleId: await managerRoleId() },
    creator,
    { permissions: ALL_PERMISSIONS, role: 'admin' }
  )
  return apiKey.principalId
}

async function personalKey(creator: PrincipalId): Promise<PrincipalId> {
  const { apiKey } = await createApiKey({ name: KEY_NAME }, creator)
  return apiKey.principalId
}

/**
 * A public category holding a published article the key wrote and one a
 * teammate wrote. Seeded directly: articles written through a key today must
 * name a teammate as author, so a key byline is an article from before that.
 */
async function seedArticles(keyPrincipal: PrincipalId) {
  const writer = await seedTeammate(WRITER_NAME, WRITER_IMAGE)
  const categoryId = createId('kb_category') as KbCategoryId
  await testDb
    .insert(helpCenterCategories)
    .values({ id: categoryId, slug: `docs-${suffix()}`, name: 'Docs', isPublic: true })
  const keyArticle = createId('kb_article') as KbArticleId
  const writerArticle = createId('kb_article') as KbArticleId
  const publishedAt = new Date(Date.now() - 60_000)
  await testDb.insert(helpCenterArticles).values([
    {
      id: keyArticle,
      categoryId,
      slug: `from-the-key-${suffix()}`,
      title: 'From the key',
      content: 'Synced from the docs repo.',
      principalId: keyPrincipal,
      publishedAt,
      position: 0,
    },
    {
      id: writerArticle,
      categoryId,
      slug: `from-a-writer-${suffix()}`,
      title: 'From a writer',
      content: 'Written by hand.',
      principalId: writer,
      publishedAt,
      position: 1,
    },
  ])
  return { categoryId, keyArticle, writerArticle }
}

type Shown = { name: string | null; avatar: string | null }
const shown = (name: string | null | undefined, avatar: string | null | undefined): Shown => ({
  name: name ?? null,
  avatar: avatar ?? null,
})

/** The key's article and the teammate's, as every public read shows them. */
async function publicViews(keyPrincipal: PrincipalId) {
  const seeded = await seedArticles(keyPrincipal)
  const [row] = await testDb
    .select({ urlId: helpCenterArticles.urlId, slug: helpCenterArticles.slug })
    .from(helpCenterArticles)
    .where(eq(helpCenterArticles.id, seeded.keyArticle))

  const byUrlId = await getPublicArticleByUrlId(row.urlId)
  const byId = await getPublicArticleById(seeded.keyArticle)
  const bySlug = await getPublicArticleBySlug(row.slug)
  const list = await listPublicArticles({ categoryId: seeded.categoryId, limit: 20 })
  const category = await listPublicArticlesForCategory(seeded.categoryId)
  const categories = await listPublicArticlesForCategories([seeded.categoryId])
  const grouped = categories.get(seeded.categoryId) ?? []

  const listed = (id: KbArticleId) => list.items.find((a) => a.id === id)?.author
  const inCategory = (rows: typeof category, id: KbArticleId) => rows.find((a) => a.id === id)

  return {
    seeded,
    key: {
      byUrlId: shown(byUrlId.author?.name, byUrlId.author?.avatarUrl),
      byId: shown(byId.author?.name, byId.author?.avatarUrl),
      bySlug: shown(bySlug.author?.name, bySlug.author?.avatarUrl),
      list: shown(listed(seeded.keyArticle)?.name, listed(seeded.keyArticle)?.avatarUrl),
      category: shown(
        inCategory(category, seeded.keyArticle)?.authorName,
        inCategory(category, seeded.keyArticle)?.authorAvatarUrl
      ),
      categories: shown(
        inCategory(grouped, seeded.keyArticle)?.authorName,
        inCategory(grouped, seeded.keyArticle)?.authorAvatarUrl
      ),
    },
    writer: {
      list: shown(listed(seeded.writerArticle)?.name, listed(seeded.writerArticle)?.avatarUrl),
      category: shown(
        inCategory(category, seeded.writerArticle)?.authorName,
        inCategory(category, seeded.writerArticle)?.authorAvatarUrl
      ),
      categories: shown(
        inCategory(grouped, seeded.writerArticle)?.authorName,
        inCategory(grouped, seeded.writerArticle)?.authorAvatarUrl
      ),
    },
    // The rows reach the browser as they were: nothing added for this.
    categoryKeys: Object.keys(inCategory(category, seeded.keyArticle) ?? {}).sort(),
    categoriesKeys: Object.keys(inCategory(grouped, seeded.keyArticle) ?? {}).sort(),
  }
}

function expectEverywhere(views: Awaited<ReturnType<typeof publicViews>>, expected: Shown) {
  expect(views.key).toEqual({
    byUrlId: expected,
    byId: expected,
    bySlug: expected,
    list: expected,
    category: expected,
    categories: expected,
  })
  // A teammate's article keeps its writer's name and avatar.
  const writer = { name: WRITER_NAME, avatar: WRITER_IMAGE }
  expect(views.writer).toEqual({ list: writer, category: writer, categories: writer })
  for (const keys of [views.categoryKeys, views.categoriesKeys]) {
    expect(keys).not.toContain('authorPrincipalId')
    expect(keys).not.toContain('authorIsApiKey')
  }
}

async function teamName(): Promise<string> {
  const name = await getSupportTeamName()
  expect(name).toBeTruthy()
  expect(name).not.toBe(KEY_NAME)
  return name!
}

if (fixture.available) {
  beforeEach(async () => {
    await fixture.begin()
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: `acme_${suffix()}`, createdAt: new Date() })
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('help center articles written through an API key', () => {
  it('a workspace key shows as the support team on the public help center', async () => {
    await setCutoff(anHourAgo())
    const key = await workspaceKey(await seedTeammate(PUBLIC_NAME, CREATOR_IMAGE))
    const views = await publicViews(key)
    expectEverywhere(views, { name: await teamName(), avatar: null })

    // The team's own views keep the key's name.
    const admin = await getArticleById(views.seeded.keyArticle)
    expect(admin.author?.name).toBe(KEY_NAME)
    const adminList = await listArticles({ categoryId: views.seeded.categoryId, limit: 20 })
    expect(adminList.items.find((a) => a.id === views.seeded.keyArticle)?.author?.name).toBe(
      KEY_NAME
    )
  })

  it('a personal key made before the cutoff shows as the support team', async () => {
    await setCutoff(inAnHour())
    const key = await personalKey(await seedTeammate(PUBLIC_NAME, CREATOR_IMAGE))
    const views = await publicViews(key)
    expectEverywhere(views, { name: await teamName(), avatar: null })
    expect((await getArticleById(views.seeded.keyArticle)).author?.name).toBe(KEY_NAME)
  })

  it('a personal key made after the cutoff shows its creator', async () => {
    await setCutoff(anHourAgo())
    const key = await personalKey(await seedTeammate(PUBLIC_NAME, CREATOR_IMAGE))
    const views = await publicViews(key)
    expectEverywhere(views, { name: PUBLIC_NAME, avatar: CREATOR_IMAGE })
  })
})
