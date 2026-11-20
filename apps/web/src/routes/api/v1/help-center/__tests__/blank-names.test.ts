/**
 * A PATCH may not blank an article title or a category name: a value of only
 * spaces is refused with 400 and nothing reaches the service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: vi.fn(async () => ({ principalId: 'principal_1' })),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: vi.fn(async () => true),
}))
vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  getArticleById: vi.fn(),
  updateArticle: vi.fn(),
  publishArticle: vi.fn(),
  unpublishArticle: vi.fn(),
  deleteArticle: vi.fn(),
  getCategoryById: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))
vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: vi.fn((v: string) => v),
  parseOptionalTypeId: vi.fn(() => undefined),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

import { updateArticle, updateCategory } from '@/lib/server/domains/help-center/help-center.service'
import { Route as ArticleDetailRoute } from '../articles/$articleId'
import { Route as CategoryDetailRoute } from '../categories/$categoryId'

type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>
type RouteShape = { options: { server: { handlers: Record<string, Handler> } } }

const articlePatch = (ArticleDetailRoute as unknown as RouteShape).options.server.handlers.PATCH
const categoryPatch = (CategoryDetailRoute as unknown as RouteShape).options.server.handlers.PATCH

function patch(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH with a blank name', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses a whitespace-only article title', async () => {
    const res = await articlePatch({
      request: patch('http://localhost/api/v1/help-center/articles/article_1', { title: '   ' }),
      params: { articleId: 'article_1' },
    })
    expect(res.status).toBe(400)
    expect(updateArticle).not.toHaveBeenCalled()
  })

  it('refuses a whitespace-only category name', async () => {
    const res = await categoryPatch({
      request: patch('http://localhost/api/v1/help-center/categories/category_1', { name: '   ' }),
      params: { categoryId: 'category_1' },
    })
    expect(res.status).toBe(400)
    expect(updateCategory).not.toHaveBeenCalled()
  })
})
