import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiAuthContext } from '@/lib/server/domains/api/auth'
import type { ApiKeyId } from '@/lib/server/domains/api-keys'
import type { HelpCenterArticleWithCategory } from '@/lib/server/domains/help-center/help-center.types'
import type { HelpCenterArticleId, HelpCenterCategoryId, PrincipalId } from '@quackback/ids'

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
  parseTypeId: vi.fn(),
  parseOptionalTypeId: vi.fn(),
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
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
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
import { parseTypeId, parseOptionalTypeId } from '@/lib/server/domains/api/validation'
import { ValidationError, ForbiddenError } from '@/lib/shared/errors'

import { Route as ArticlesListRoute } from '../articles/index'
import { Route as ArticleDetailRoute } from '../articles/$articleId'
import { Route as ArticleFeedbackRoute } from '../articles/$articleId.feedback'

type MockedHandler = (ctx: { request: Request; params?: Record<string, string> }) => Promise<Response>
type MockedRouteShape = { options: { server: { handlers: Record<string, MockedHandler> } } }

const listHandlers = (ArticlesListRoute as unknown as MockedRouteShape).options.server.handlers
const detailHandlers = (ArticleDetailRoute as unknown as MockedRouteShape).options.server.handlers
const feedbackHandlers = (ArticleFeedbackRoute as unknown as MockedRouteShape).options.server.handlers

// --- Helpers ---

function createRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

const mockAuthContext: ApiAuthContext = {
  apiKey: {
    id: 'api_key_test' as ApiKeyId,
    name: 'test',
    keyPrefix: 'qb_',
    createdById: null,
    principalId: 'principal_1' as PrincipalId,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: new Date('2026-01-01'),
    revokedAt: null,
  },
  principalId: 'principal_1' as PrincipalId,
  role: 'admin',
  importMode: false,
}

const mockArticle: HelpCenterArticleWithCategory = {
  id: 'article_1' as HelpCenterArticleId,
  categoryId: 'category_1' as HelpCenterCategoryId,
  slug: 'how-to-start',
  title: 'How to Get Started',
  description: null,
  position: null,
  content: 'Follow these steps...',
  contentJson: null,
  principalId: 'principal_1' as PrincipalId,
  publishedAt: new Date('2026-01-15'),
  viewCount: 42,
  helpfulCount: 10,
  notHelpfulCount: 2,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-10'),
  deletedAt: null,
  category: { id: 'category_1' as HelpCenterCategoryId, slug: 'getting-started', name: 'Getting Started' },
  author: { id: 'principal_1' as PrincipalId, name: 'Admin', avatarUrl: null },
}

// --- Tests ---

describe('GET /api/v1/help-center/articles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(parseTypeId).mockImplementation((v) => v as string)
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
    expect(json.data[0].id).toBe('article_1')
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
    vi.mocked(parseTypeId).mockImplementation((v) => v as string)
    vi.mocked(parseOptionalTypeId).mockReturnValue(undefined)
  })

  it('creates article with valid body', async () => {
    vi.mocked(createArticle).mockResolvedValue(mockArticle)

    const body = {
      categoryId: 'category_1',
      title: 'How to Get Started',
      content: 'Follow these steps...',
    }
    const request = createRequest('POST', 'http://localhost/api/v1/help-center/articles', body)
    const response = await listHandlers.POST({ request })

    expect(response.status).toBe(201)
    const json = await response.json()
    expect(json.data.id).toBe('article_1')
    expect(createArticle).toHaveBeenCalledWith(body, 'principal_1', undefined)
  })

  it('creates article attributed to authorId when provided', async () => {
    vi.mocked(createArticle).mockResolvedValue(mockArticle)
    vi.mocked(parseOptionalTypeId).mockReturnValue('principal_2' as PrincipalId)

    const body = {
      categoryId: 'category_1',
      title: 'Authored Article',
      content: 'Content',
      authorId: 'principal_2',
    }
    const request = createRequest('POST', 'http://localhost/api/v1/help-center/articles', body)
    const response = await listHandlers.POST({ request })

    expect(response.status).toBe(201)
    expect(createArticle).toHaveBeenCalledWith(
      { categoryId: 'category_1', title: 'Authored Article', content: 'Content' },
      'principal_1',
      'principal_2'
    )
  })

  it('returns 400 when authorId format is invalid', async () => {
    vi.mocked(parseOptionalTypeId).mockImplementation(() => {
      throw new ValidationError('VALIDATION_ERROR', 'Invalid author ID format')
    })

    const body = {
      categoryId: 'category_1',
      title: 'Test',
      content: 'Content',
      authorId: 'not-a-valid-id',
    }
    const request = createRequest('POST', 'http://localhost/api/v1/help-center/articles', body)
    const response = await listHandlers.POST({ request })

    expect(response.status).toBe(400)
  })

  it('returns 400 when authorId does not exist', async () => {
    vi.mocked(createArticle).mockRejectedValue(
      new ValidationError('VALIDATION_ERROR', 'Author not found')
    )

    const body = {
      categoryId: 'category_1',
      title: 'Test',
      content: 'Content',
      authorId: 'principal_ghost',
    }
    const request = createRequest('POST', 'http://localhost/api/v1/help-center/articles', body)
    const response = await listHandlers.POST({ request })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.message).toMatch(/author not found/i)
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

  it('requires team role', async () => {
    vi.mocked(withApiKeyAuth).mockRejectedValue(
      new ForbiddenError('FORBIDDEN', 'Team access required')
    )

    const body = {
      categoryId: 'category_1',
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
    vi.mocked(parseTypeId).mockImplementation((v) => v as string)
  })

  it('returns single article with category and author', async () => {
    vi.mocked(getArticleById).mockResolvedValue(mockArticle)

    const request = createRequest('GET', 'http://localhost/api/v1/help-center/articles/article_1')
    const response = await detailHandlers.GET({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.id).toBe('article_1')
    expect(json.data.category).toEqual({
      id: 'category_1',
      slug: 'getting-started',
      name: 'Getting Started',
    })
    expect(json.data.author).toEqual({ id: 'principal_1', name: 'Admin', avatarUrl: null })
  })

  it('returns error for invalid ID format', async () => {
    vi.mocked(parseTypeId).mockImplementation(() => {
      throw new ValidationError('VALIDATION_ERROR', 'Invalid article ID format')
    })

    const request = createRequest('GET', 'http://localhost/api/v1/help-center/articles/bad-id')
    const response = await detailHandlers.GET({
      request,
      params: { articleId: 'bad-id' },
    })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('PATCH /api/v1/help-center/articles/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(parseTypeId).mockImplementation((v) => v as string)
    vi.mocked(parseOptionalTypeId).mockReturnValue(undefined)
  })

  it('updates article fields', async () => {
    const updatedArticle = { ...mockArticle, title: 'Updated Title' }
    vi.mocked(updateArticle).mockResolvedValue(updatedArticle)

    const body = { title: 'Updated Title' }
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.title).toBe('Updated Title')
    expect(updateArticle).toHaveBeenCalledWith('article_1', { title: 'Updated Title' }, undefined)
  })

  it('reassigns author when authorId is provided', async () => {
    const updatedArticle = { ...mockArticle, author: { id: 'principal_2' as PrincipalId, name: 'Other', avatarUrl: null } }
    vi.mocked(updateArticle).mockResolvedValue(updatedArticle)
    vi.mocked(parseOptionalTypeId).mockReturnValue('principal_2' as PrincipalId)

    const body = { authorId: 'principal_2' }
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(200)
    expect(updateArticle).toHaveBeenCalledWith('article_1', {}, 'principal_2')
  })

  it('returns 400 when authorId format is invalid', async () => {
    vi.mocked(parseOptionalTypeId).mockImplementation(() => {
      throw new ValidationError('VALIDATION_ERROR', 'Invalid author ID format')
    })

    const body = { authorId: 'not-a-valid-id' }
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(400)
  })

  it('returns 400 when authorId does not exist', async () => {
    vi.mocked(parseOptionalTypeId).mockReturnValue('principal_ghost' as PrincipalId)
    vi.mocked(updateArticle).mockRejectedValue(
      new ValidationError('VALIDATION_ERROR', 'Author not found')
    )

    const body = { authorId: 'principal_ghost' }
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.message).toMatch(/author not found/i)
  })

  it('publishes article when publishedAt is a datetime string', async () => {
    vi.mocked(getArticleById).mockResolvedValue(mockArticle)
    vi.mocked(publishArticle).mockResolvedValue(mockArticle)

    const body = { publishedAt: '2026-04-01T00:00:00.000Z' }
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(200)
    expect(publishArticle).toHaveBeenCalledWith('article_1')
    expect(updateArticle).not.toHaveBeenCalled()
  })

  it('unpublishes article when publishedAt is null', async () => {
    vi.mocked(getArticleById).mockResolvedValue(mockArticle)
    vi.mocked(unpublishArticle).mockResolvedValue(mockArticle)

    const body = { publishedAt: null }
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(200)
    expect(unpublishArticle).toHaveBeenCalledWith('article_1')
    expect(updateArticle).not.toHaveBeenCalled()
  })

  it('requires team role', async () => {
    vi.mocked(withApiKeyAuth).mockRejectedValue(
      new ForbiddenError('FORBIDDEN', 'Team access required')
    )

    const body = { title: 'Updated' }
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(403)
  })

  it('returns 400 for invalid body', async () => {
    const body = { title: '' } // min length 1
    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/articles/article_1',
      body
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { articleId: 'article_1' },
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
    vi.mocked(parseTypeId).mockImplementation((v) => v as string)
  })

  it('soft deletes and returns 204', async () => {
    vi.mocked(deleteArticle).mockResolvedValue(undefined)

    const request = createRequest(
      'DELETE',
      'http://localhost/api/v1/help-center/articles/article_1'
    )
    const response = await detailHandlers.DELETE({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(204)
    expect(deleteArticle).toHaveBeenCalledWith('article_1')
  })

  it('requires admin role', async () => {
    vi.mocked(withApiKeyAuth).mockRejectedValue(
      new ForbiddenError('FORBIDDEN', 'Admin access required')
    )

    const request = createRequest(
      'DELETE',
      'http://localhost/api/v1/help-center/articles/article_1'
    )
    const response = await detailHandlers.DELETE({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(403)
  })
})

describe('POST /api/v1/help-center/articles/:id/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(parseTypeId).mockImplementation((v) => v as string)
  })

  it('records helpful=true feedback', async () => {
    vi.mocked(recordArticleFeedback).mockResolvedValue(undefined)

    const body = { helpful: true }
    const request = createRequest(
      'POST',
      'http://localhost/api/v1/help-center/articles/article_1/feedback',
      body
    )
    const response = await feedbackHandlers.POST({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.success).toBe(true)
    expect(recordArticleFeedback).toHaveBeenCalledWith('article_1', true, 'principal_1')
  })

  it('records helpful=false feedback', async () => {
    vi.mocked(recordArticleFeedback).mockResolvedValue(undefined)

    const body = { helpful: false }
    const request = createRequest(
      'POST',
      'http://localhost/api/v1/help-center/articles/article_1/feedback',
      body
    )
    const response = await feedbackHandlers.POST({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(200)
    expect(recordArticleFeedback).toHaveBeenCalledWith('article_1', false, 'principal_1')
  })

  it('returns 400 for invalid body (missing helpful field)', async () => {
    const body = { rating: 5 }
    const request = createRequest(
      'POST',
      'http://localhost/api/v1/help-center/articles/article_1/feedback',
      body
    )
    const response = await feedbackHandlers.POST({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error.code).toBe('BAD_REQUEST')
  })

  it('requires team role', async () => {
    vi.mocked(withApiKeyAuth).mockRejectedValue(
      new ForbiddenError('FORBIDDEN', 'Team access required')
    )

    const body = { helpful: true }
    const request = createRequest(
      'POST',
      'http://localhost/api/v1/help-center/articles/article_1/feedback',
      body
    )
    const response = await feedbackHandlers.POST({
      request,
      params: { articleId: 'article_1' },
    })

    expect(response.status).toBe(403)
  })
})
