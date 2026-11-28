/**
 * Who may read what over the help center REST reads.
 *
 * Any valid key may read the published, public help center. Drafts, private
 * categories and segment-gated content are team material: they need a key that
 * holds `help_center.manage`, including the scope that permission maps to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/domains/help-center/help-center-translation-api', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/help-center/help-center-translation-api')
  >()),
  listArticleTranslationSummaries: async () => [],
}))
vi.mock('@/lib/server/domains/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/api/auth')>()),
  withApiKeyAuth: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: vi.fn(),
}))
vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  listArticles: vi.fn(),
  listPublicArticles: vi.fn(),
  getArticleById: vi.fn(),
  getPublicArticleById: vi.fn(),
  listCategories: vi.fn(),
  listPublicCategories: vi.fn(),
  getCategoryById: vi.fn(),
  getPublicCategoryById: vi.fn(),
  recordArticleFeedback: vi.fn(),
}))
vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: vi.fn((v: string) => v),
  parseOptionalTypeId: vi.fn((v: string | null) => v ?? undefined),
}))
vi.mock('@/lib/server/domains/api/responses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/api/responses')>()),
  parsePaginationParams: vi.fn(() => ({ cursor: undefined, limit: 20 })),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

import { withApiKeyAuth, type ApiAuthContext } from '@/lib/server/domains/api/auth'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import {
  listArticles,
  listPublicArticles,
  getArticleById,
  getPublicArticleById,
  listCategories,
  listPublicCategories,
  getCategoryById,
  getPublicCategoryById,
  recordArticleFeedback,
} from '@/lib/server/domains/help-center/help-center.service'
import { NotFoundError } from '@/lib/shared/errors'
import { SYSTEM_ROLE_PERMISSIONS } from '@/lib/shared/permissions'
import type { ApiKeyId } from '@/lib/server/domains/api-keys'
import type {
  HelpCenterArticleWithCategory,
  HelpCenterCategory,
  HelpCenterCategoryWithCount,
} from '@/lib/server/domains/help-center/help-center.types'
import type { KbArticleId, KbCategoryId, PrincipalId } from '@quackback/ids'

import { Route as ArticlesListRoute } from '../articles/index'
import { Route as ArticleDetailRoute } from '../articles/$articleId'
import { Route as CategoriesListRoute } from '../categories/index'
import { Route as CategoryDetailRoute } from '../categories/$categoryId'
import { Route as ArticleFeedbackRoute } from '../articles/$articleId.feedback'

type Handler = (ctx: { request: Request; params?: Record<string, string> }) => Promise<Response>
type RouteShape = { options: { server: { handlers: Record<string, Handler> } } }
const handlers = (route: unknown) => (route as RouteShape).options.server.handlers

function keyFor(
  role: 'owner' | 'contributor',
  scopes: ApiAuthContext['apiKey']['scopes'] = null
): ApiAuthContext {
  return {
    apiKey: {
      id: 'api_key_test' as ApiKeyId,
      name: 'test',
      kind: 'personal' as const,
      keyPrefix: 'qb_',
      createdById: null,
      principalId: 'principal_1' as PrincipalId,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date('2026-01-01'),
      revokedAt: null,
      scopes,
    },
    principalId: 'principal_1' as PrincipalId,
    role: role === 'owner' ? 'admin' : 'member',
    permissions: new Set(SYSTEM_ROLE_PERMISSIONS[role]),
    principal: null,
    importMode: false,
  }
}

const contributor = keyFor('contributor')
const owner = keyFor('owner')
/** An owner's key narrowed to reading: it does not carry help_center.manage. */
const readOnlyOwner = keyFor('owner', ['read:article'])

const draft: HelpCenterArticleWithCategory = {
  id: 'kb_article_1' as KbArticleId,
  categoryId: 'kb_category_1' as KbCategoryId,
  slug: 'secret',
  locale: 'en',
  textRevision: 1,
  title: 'Secret plan',
  description: null,
  position: null,
  content: 'Unreleased',
  contentJson: null,
  principalId: 'principal_1' as PrincipalId,
  segmentIds: [],
  publishedAt: null,
  viewCount: 0,
  helpfulCount: 0,
  notHelpfulCount: 0,
  urlId: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  category: { id: 'kb_category_1' as KbCategoryId, urlId: 1, slug: 'hidden', name: 'Hidden' },
  author: null,
}

const hiddenCategory: HelpCenterCategory = {
  id: 'kb_category_1' as KbCategoryId,
  urlId: 1,
  slug: 'hidden',
  locale: 'en',
  name: 'Hidden things',
  description: null,
  icon: null,
  parentId: null,
  isPublic: false,
  segmentIds: [],
  position: 0,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
} as HelpCenterCategory

const counted = (cat: HelpCenterCategory, n: number): HelpCenterCategoryWithCount => ({
  ...cat,
  articleCount: n,
  publishedArticleCount: n,
  recursiveArticleCount: n,
  recursivePublishedArticleCount: n,
})

const get = (url: string) => new Request(url, { method: 'GET' })
const vote = () =>
  handlers(ArticleFeedbackRoute).POST({
    request: new Request('http://localhost/api/v1/help-center/articles/kb_article_1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: true }),
    }),
    params: { articleId: 'kb_article_1' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isFeatureEnabled).mockResolvedValue(true)
  vi.mocked(getArticleById).mockResolvedValue(draft)
  vi.mocked(getPublicArticleById).mockRejectedValue(
    new NotFoundError('ARTICLE_NOT_FOUND', 'Article not found')
  )
  vi.mocked(getCategoryById).mockResolvedValue(hiddenCategory)
  vi.mocked(getPublicCategoryById).mockRejectedValue(
    new NotFoundError('CATEGORY_NOT_FOUND', 'Category not found')
  )
  const empty = { items: [], nextCursor: null, hasMore: false }
  vi.mocked(listArticles).mockResolvedValue({ ...empty, items: [draft] })
  vi.mocked(listPublicArticles).mockResolvedValue(empty)
  vi.mocked(listCategories).mockResolvedValue([counted(hiddenCategory, 1)])
  vi.mocked(listPublicCategories).mockResolvedValue([])
})

describe('a key without help_center.manage', () => {
  for (const [label, auth] of [
    ['a contributor key', contributor],
    ['a read-scoped owner key', readOnlyOwner],
  ] as const) {
    it(`${label} is refused a draft article and never sees its title`, async () => {
      vi.mocked(withApiKeyAuth).mockResolvedValue(auth)
      const res = await handlers(ArticleDetailRoute).GET({
        request: get('http://localhost/api/v1/help-center/articles/kb_article_1'),
        params: { articleId: 'kb_article_1' },
      })
      expect(res.status).toBe(403)
      expect(await res.text()).not.toContain('Secret plan')
    })

    it(`${label} lists only the published public slice, whatever status it asks for`, async () => {
      vi.mocked(withApiKeyAuth).mockResolvedValue(auth)
      const res = await handlers(ArticlesListRoute).GET({
        request: get(
          'http://localhost/api/v1/help-center/articles?status=draft&categoryId=kb_category_1'
        ),
      })
      expect(res.status).toBe(200)
      expect(await res.text()).not.toContain('Secret plan')
      expect(listArticles).not.toHaveBeenCalled()
      expect(listPublicArticles).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: 'kb_category_1' })
      )
    })

    it(`${label} lists only public categories`, async () => {
      vi.mocked(withApiKeyAuth).mockResolvedValue(auth)
      const res = await handlers(CategoriesListRoute).GET({
        request: get('http://localhost/api/v1/help-center/categories'),
      })
      expect(res.status).toBe(200)
      expect(await res.text()).not.toContain('Hidden things')
      expect(listCategories).not.toHaveBeenCalled()
      expect(listPublicCategories).toHaveBeenCalled()
    })

    it(`${label} is refused a private category and never sees its name`, async () => {
      vi.mocked(withApiKeyAuth).mockResolvedValue(auth)
      const res = await handlers(CategoryDetailRoute).GET({
        request: get('http://localhost/api/v1/help-center/categories/kb_category_1'),
        params: { categoryId: 'kb_category_1' },
      })
      expect(res.status).toBe(403)
      expect(await res.text()).not.toContain('Hidden things')
    })
  }

  it('still reads a published public article', async () => {
    vi.mocked(withApiKeyAuth).mockResolvedValue(contributor)
    const published = { ...draft, title: 'Getting started', publishedAt: new Date('2026-01-02') }
    vi.mocked(getArticleById).mockResolvedValue(published)
    vi.mocked(getPublicArticleById).mockResolvedValue(published)
    const res = await handlers(ArticleDetailRoute).GET({
      request: get('http://localhost/api/v1/help-center/articles/kb_article_1'),
      params: { articleId: 'kb_article_1' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Getting started')
  })

  it('gets a 404, not a 403, for an article that does not exist', async () => {
    vi.mocked(withApiKeyAuth).mockResolvedValue(contributor)
    vi.mocked(getArticleById).mockRejectedValue(
      new NotFoundError('ARTICLE_NOT_FOUND', 'Article not found')
    )
    const res = await handlers(ArticleDetailRoute).GET({
      request: get('http://localhost/api/v1/help-center/articles/kb_article_1'),
      params: { articleId: 'kb_article_1' },
    })
    expect(res.status).toBe(404)
  })
})

describe('voting over REST', () => {
  it('refuses a vote on a draft from a key without help_center.manage', async () => {
    vi.mocked(withApiKeyAuth).mockResolvedValue(contributor)
    const res = await vote()
    expect(res.status).toBe(403)
    expect(recordArticleFeedback).not.toHaveBeenCalled()
  })

  it('answers 404, not 403, for an article that does not exist', async () => {
    vi.mocked(withApiKeyAuth).mockResolvedValue(contributor)
    vi.mocked(getArticleById).mockRejectedValue(
      new NotFoundError('ARTICLE_NOT_FOUND', 'Article not found')
    )
    const res = await vote()
    expect(res.status).toBe(404)
    expect(recordArticleFeedback).not.toHaveBeenCalled()
  })

  it('records a vote on a published public article', async () => {
    vi.mocked(withApiKeyAuth).mockResolvedValue(contributor)
    vi.mocked(getPublicArticleById).mockResolvedValue({ ...draft, publishedAt: new Date() })
    const res = await vote()
    expect(res.status).toBe(200)
    expect(recordArticleFeedback).toHaveBeenCalledWith('kb_article_1', true, 'principal_1')
  })

  it('lets a key with help_center.manage vote on a draft', async () => {
    vi.mocked(withApiKeyAuth).mockResolvedValue(owner)
    expect((await vote()).status).toBe(200)
  })
})

describe('the read:article scope', () => {
  /** An owner's key scoped to feedback only: no help center reads at all. */
  const feedbackOnly = keyFor('owner', ['read:feedback', 'write:feedback'])

  it('is required for every help center read and vote', async () => {
    vi.mocked(withApiKeyAuth).mockResolvedValue(feedbackOnly)
    vi.mocked(getPublicArticleById).mockResolvedValue({ ...draft, publishedAt: new Date() })
    const responses = [
      await handlers(ArticlesListRoute).GET({
        request: get('http://localhost/api/v1/help-center/articles'),
      }),
      await handlers(ArticleDetailRoute).GET({
        request: get('http://localhost/api/v1/help-center/articles/kb_article_1'),
        params: { articleId: 'kb_article_1' },
      }),
      await handlers(CategoriesListRoute).GET({
        request: get('http://localhost/api/v1/help-center/categories'),
      }),
      await handlers(CategoryDetailRoute).GET({
        request: get('http://localhost/api/v1/help-center/categories/kb_category_1'),
        params: { categoryId: 'kb_category_1' },
      }),
      await vote(),
    ]
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403, 403])
    expect(listPublicArticles).not.toHaveBeenCalled()
    expect(recordArticleFeedback).not.toHaveBeenCalled()
  })

  it('is enough on its own to read the public help center', async () => {
    vi.mocked(withApiKeyAuth).mockResolvedValue(readOnlyOwner)
    const res = await handlers(ArticlesListRoute).GET({
      request: get('http://localhost/api/v1/help-center/articles'),
    })
    expect(res.status).toBe(200)
  })
})

describe('a key with help_center.manage', () => {
  beforeEach(() => vi.mocked(withApiKeyAuth).mockResolvedValue(owner))

  it('reads a draft article', async () => {
    const res = await handlers(ArticleDetailRoute).GET({
      request: get('http://localhost/api/v1/help-center/articles/kb_article_1'),
      params: { articleId: 'kb_article_1' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Secret plan')
    expect(getPublicArticleById).not.toHaveBeenCalled()
  })

  it('lists drafts and private categories', async () => {
    const articles = await handlers(ArticlesListRoute).GET({
      request: get('http://localhost/api/v1/help-center/articles?status=draft'),
    })
    expect(await articles.text()).toContain('Secret plan')
    expect(listArticles).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }))

    const categories = await handlers(CategoriesListRoute).GET({
      request: get('http://localhost/api/v1/help-center/categories'),
    })
    expect(await categories.text()).toContain('Hidden things')
  })

  it('reads a private category', async () => {
    const res = await handlers(CategoryDetailRoute).GET({
      request: get('http://localhost/api/v1/help-center/categories/kb_category_1'),
      params: { categoryId: 'kb_category_1' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Hidden things')
  })
})
