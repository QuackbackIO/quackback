import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: vi.fn(),
}))
vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  listArticles: vi.fn(),
  getArticleById: vi.fn(),
  createArticle: vi.fn(),
  updateArticle: vi.fn(),
  publishArticle: vi.fn(),
  unpublishArticle: vi.fn(),
  deleteArticle: vi.fn(),
  recordArticleFeedback: vi.fn(),
}))
vi.mock('@/lib/server/domains/api/validation', () => ({
  validateTypeId: vi.fn(),
}))
vi.mock('@/lib/server/domains/api/responses', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/server/domains/api/responses')>()
  return {
    ...orig,
    parsePaginationParams: vi.fn(() => ({ cursor: undefined, limit: 20 })),
  }
})
// Mock createFileRoute to avoid TanStack side effects
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: any) => ({ options: opts })),
}))

// --- Imports ---

import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import {
  listArticles,
  getArticleById,
  createArticle,
  updateArticle,
  publishArticle,
  unpublishArticle,
  deleteArticle,
  recordArticleFeedback,
} from '@/lib/server/domains/help-center/help-center.service'
import { validateTypeId } from '@/lib/server/domains/api/validation'

import { Route as ArticlesListRoute } from '../articles/index'
import { Route as ArticleDetailRoute } from '../articles/$articleId'
import { Route as ArticleFeedbackRoute } from '../articles/$articleId.feedback'

const listHandlers = (ArticlesListRoute as any).options.server.handlers
const detailHandlers = (ArticleDetailRoute as any).options.server.handlers
const feedbackHandlers = (ArticleFeedbackRoute as any).options.server.handlers

// --- Helpers ---

function createRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

const mockAuthContext = {
  apiKey: { id: 'key_1', name: 'test' },
  principalId: 'principal_1',
  role: 'admin' as const,
  importMode: false,
}

const mockArticle = {
  id: 'helpcenter_article_1',
  slug: 'how-to-start',
  title: 'How to Get Started',
  content: 'Follow these steps...',
  publishedAt: new Date('2026-01-15'),
  viewCount: 42,
  helpfulCount: 10,
  notHelpfulCount: 2,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-10'),
  category: { id: 'helpcenter_category_1', slug: 'getting-started', name: 'Getting Started' },
  author: { id: 'principal_1', name: 'Admin', avatarUrl: null },
}

// --- Tests ---

describe('GET /api/v1/help-center/articles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(validateTypeId).mockReturnValue(undefined)
  })

  it('returns paginated list with articles', async () => {
    vi.mocked(listArticles).mockResolvedValue({
      items: [mockArticle],
      nextCursor: null,
      hasMore: false,
    })

    const request = createRequest('GET', 'http://localhost/api/v1/help-center/articles')
    const response = await listHandlers.GET({ request })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0].id).toBe('helpcenter_article_1')
    expect(json.data[0].title).toBe('How to Get Started')
    expect(json.data[0].publishedAt).toBe('2026-01-15T00:00:00.000Z')
    expect(json.meta.pagination).toEqual({ cursor: null, hasMore: false })
  })

  it('passes filter params (categoryId, status, search) to service', async () => {
    vi.mocked(listArticles).mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    })

    const request = createRequest(
      'GET',
      'http://localhost/api/v1/help-center/articles?categoryId=cat_1&status=published&search=hello'
    )
    await listHandlers.GET({ request })

    expect(listArticles).toHaveBeenCalledWith({
      categoryId: 'cat_1',
      status: 'published',
      search: 'hello',
      cursor: undefined,
      limit: 20,
    })
  })

  it('returns 404 when feature disabled', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false)

    const request = createRequest('GET', 'http://localhost/api/v1/help-center/articles')
    const response = await listHandlers.GET({ request })

    expect(response.status).toBe(404)
    const json = await response.json()
    expect(json.error.code).toBe('NOT_FOUND')
  })
})

describe('POST /api/v1/help-center/articles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(validateTypeId).mockReturnValue(undefined)
  })

  it('creates article with valid body', async () => {
    vi.mocked(createArticle).mockResolvedValue(mockArticle)

    const body = {
      categoryId: 'helpcenter_category_1',
      title: 'How to Get Started',
      content: 'Follow these steps...',
    }
    const request = createRequest('POST', 'http://localhost/api/v1/help-center/articles', body)
    const response = await listHandlers.POST({ request })

    expect(response.status).toBe(201)
    const json = await response.json()
    expect(json.data.id).toBe('helpcenter_article_1')
    expect(createArticle).toHaveBeenCalledWith(body, 'principal_1')
  })

  it('returns 400 for missing required fields', async () => {
    const body = { title: 'No category or content' }
    const request = createRequest('POST', 'http://localhost/api/v1/help-center/articles', body)
    const response = await listHandlers.POST({ request })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.code).toBe('BAD_REQUEST')
    expect(json.error.details?.errors).toBeDefined()
  })

  it('requires admin role', async () => {
    const forbiddenResponse = new Response(
      JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }),
      { status: 403 }
    )
    vi.mocked(withApiKeyAuth).mockResolvedValue(forbiddenResponse)

    const body = {
      categoryId: 'helpcenter_category_1',
      title: 'Test',
      content: 'Test content',
    }
    const request = createRequest('POST', 'http://localhost/api/v1/help-center/articles', body)
    const response = await listHandlers.POST({ request })

    expect(response.status).toBe(403)
  })
})

describe('GET /api/v1/help-center/articles/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(validateTypeId).mockReturnValue(undefined)
  })

  it('returns single article with category and author', async () => {
    vi.mocked(getArticleById).mockResolvedValue(mockArticle)

    const request = createRequest(
      'GET',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1'
    )
    const response = await detailHandlers.GET({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.id).toBe('helpcenter_article_1')
    expect(json.data.category).toEqual({
      id: 'helpcenter_category_1',
      slug: 'getting-started',
      name: 'Getting Started',
    })
    expect(json.data.author).toEqual({ id: 'principal_1', name: 'Admin', avatarUrl: null })
  })

  it('returns error for invalid ID format', async () => {
    const badIdResponse = new Response(
      JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid article ID format' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
    vi.mocked(validateTypeId).mockReturnValue(badIdResponse)

    const request = createRequest('GET', 'http://localhost/api/v1/help-center/articles/bad-id')
    const response = await detailHandlers.GET({
      request,
      params: { articleId: 'bad-id' },
    })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.code).toBe('BAD_REQUEST')
  })
})

describe('PATCH /api/v1/help-center/articles/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(validateTypeId).mockReturnValue(undefined)
  })

  it('updates article fields', async () => {
    const updatedArticle = { ...mockArticle, title: 'Updated Title' }
    vi.mocked(updateArticle).mockResolvedValue(updatedArticle)

    const body = { title: 'Updated Title' }
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.title).toBe('Updated Title')
    expect(updateArticle).toHaveBeenCalledWith('helpcenter_article_1', { title: 'Updated Title' })
  })

  it('publishes article when publishedAt is a datetime string', async () => {
    vi.mocked(getArticleById).mockResolvedValue(mockArticle)
    vi.mocked(publishArticle).mockResolvedValue(undefined as any)

    const body = { publishedAt: '2026-04-01T00:00:00.000Z' }
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(200)
    expect(publishArticle).toHaveBeenCalledWith('helpcenter_article_1')
    expect(updateArticle).not.toHaveBeenCalled()
  })

  it('unpublishes article when publishedAt is null', async () => {
    vi.mocked(getArticleById).mockResolvedValue(mockArticle)
    vi.mocked(unpublishArticle).mockResolvedValue(undefined as any)

    const body = { publishedAt: null }
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(200)
    expect(unpublishArticle).toHaveBeenCalledWith('helpcenter_article_1')
    expect(updateArticle).not.toHaveBeenCalled()
  })

  it('requires admin role', async () => {
    const forbiddenResponse = new Response(
      JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }),
      { status: 403 }
    )
    vi.mocked(withApiKeyAuth).mockResolvedValue(forbiddenResponse)

    const body = { title: 'Updated' }
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(403)
  })

  it('returns 400 for invalid body', async () => {
    const body = { title: '' } // min length 1
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.code).toBe('BAD_REQUEST')
  })
})

describe('DELETE /api/v1/help-center/articles/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(validateTypeId).mockReturnValue(undefined)
  })

  it('soft deletes and returns 204', async () => {
    vi.mocked(deleteArticle).mockResolvedValue(undefined as any)

    const request = createRequest(
      'DELETE',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1'
    )
    const response = await detailHandlers.DELETE({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(204)
    expect(deleteArticle).toHaveBeenCalledWith('helpcenter_article_1')
  })

  it('requires admin role', async () => {
    const forbiddenResponse = new Response(
      JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }),
      { status: 403 }
    )
    vi.mocked(withApiKeyAuth).mockResolvedValue(forbiddenResponse)

    const request = createRequest(
      'DELETE',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1'
    )
    const response = await detailHandlers.DELETE({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(403)
  })
})

describe('POST /api/v1/help-center/articles/:id/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(validateTypeId).mockReturnValue(undefined)
  })

  it('records helpful=true feedback', async () => {
    vi.mocked(recordArticleFeedback).mockResolvedValue(undefined as any)

    const body = { helpful: true }
    const request = createRequest(
      'POST',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1/feedback',
      body
    )
    const response = await feedbackHandlers.POST({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.success).toBe(true)
    expect(recordArticleFeedback).toHaveBeenCalledWith('helpcenter_article_1', true, 'principal_1')
  })

  it('records helpful=false feedback', async () => {
    vi.mocked(recordArticleFeedback).mockResolvedValue(undefined as any)

    const body = { helpful: false }
    const request = createRequest(
      'POST',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1/feedback',
      body
    )
    const response = await feedbackHandlers.POST({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(200)
    expect(recordArticleFeedback).toHaveBeenCalledWith('helpcenter_article_1', false, 'principal_1')
  })

  it('returns 400 for invalid body (missing helpful field)', async () => {
    const body = { rating: 5 }
    const request = createRequest(
      'POST',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1/feedback',
      body
    )
    const response = await feedbackHandlers.POST({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.code).toBe('BAD_REQUEST')
  })

  it('requires team role', async () => {
    const forbiddenResponse = new Response(
      JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Team access required' } }),
      { status: 403 }
    )
    vi.mocked(withApiKeyAuth).mockResolvedValue(forbiddenResponse)

    const body = { helpful: true }
    const request = createRequest(
      'POST',
      'http://localhost/api/v1/help-center/articles/helpcenter_article_1/feedback',
      body
    )
    const response = await feedbackHandlers.POST({
      request,
      params: { articleId: 'helpcenter_article_1' },
    })

    expect(response.status).toBe(403)
  })
})
