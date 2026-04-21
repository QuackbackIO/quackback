import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks must be before imports
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: vi.fn(),
}))
vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  listCategories: vi.fn(),
  getCategoryById: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))
vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: vi.fn(),
}))
// Mock createFileRoute to avoid TanStack side effects
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import type { ApiAuthContext } from '@/lib/server/domains/api/auth'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from '@/lib/server/domains/help-center/help-center.service'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import type { HelpCenterCategoryId, PrincipalId, ApiKeyId } from '@quackback/ids'
import type {
  HelpCenterCategory,
  HelpCenterCategoryWithCount,
} from '@/lib/server/domains/help-center/help-center.types'

// Import routes (createFileRoute is mocked, so this returns { options: { server: { handlers } } })
import { Route } from '../categories/index'
import { Route as CategoryDetailRoute } from '../categories/$categoryId'

type MockedHandler = (ctx: { request: Request; params?: Record<string, string> }) => Promise<Response>
type MockedRouteShape = { options: { server: { handlers: Record<string, MockedHandler> } } }

// Access handlers
const handlers = (Route as unknown as MockedRouteShape).options.server.handlers
const detailHandlers = (CategoryDetailRoute as unknown as MockedRouteShape).options.server.handlers

// Helpers
function createRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

async function parseJson(response: Response) {
  return response.json()
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

const mockTeamAuthContext: ApiAuthContext = {
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
  role: 'team',
  importMode: false,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// =============================================================================
// categories/index.ts -- GET (list) + POST (create)
// =============================================================================

describe('GET /api/v1/help-center/categories', () => {
  it('returns list of categories with article counts', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockTeamAuthContext)
    const mockCategory: HelpCenterCategoryWithCount = {
      id: 'category_01jk0000000000000000000001' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started',
      description: 'Intro guides',
      icon: '\u{1F4DA}',
      parentId: null,
      isPublic: true,
      position: 0,
      articleCount: 5,
      publishedArticleCount: 5,
      recursiveArticleCount: 5,
      recursivePublishedArticleCount: 5,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    }
    vi.mocked(listCategories).mockResolvedValue([mockCategory])

    const request = createRequest('GET', 'http://localhost/api/v1/help-center/categories')
    const response = await handlers.GET({ request })
    const json = await parseJson(response)

    expect(response.status).toBe(200)
    expect(json.data).toHaveLength(1)
    expect(json.data[0]).toMatchObject({
      id: 'category_01jk0000000000000000000001',
      name: 'Getting Started',
      icon: '\u{1F4DA}',
      parentId: null,
      articleCount: 5,
    })
  })

  it('returns categories with null icon and parentId', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockTeamAuthContext)
    const mockCategory: HelpCenterCategoryWithCount = {
      id: 'category_01jk0000000000000000000002' as HelpCenterCategoryId,
      slug: 'faq',
      name: 'FAQ',
      description: null,
      icon: null,
      parentId: null,
      isPublic: true,
      position: 1,
      articleCount: 0,
      publishedArticleCount: 0,
      recursiveArticleCount: 0,
      recursivePublishedArticleCount: 0,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }
    vi.mocked(listCategories).mockResolvedValue([mockCategory])

    const request = createRequest('GET', 'http://localhost/api/v1/help-center/categories')
    const response = await handlers.GET({ request })
    const json = await parseJson(response)

    expect(response.status).toBe(200)
    expect(json.data[0].icon).toBeNull()
    expect(json.data[0].parentId).toBeNull()
  })

  it('returns 404 when help center feature is disabled', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false)
    const request = createRequest('GET', 'http://localhost/api/v1/help-center/categories')
    const response = await handlers.GET({ request })
    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/help-center/categories', () => {
  it('creates a category with icon and parentId', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    const newCategory: HelpCenterCategory = {
      id: 'category_01jk0000000000000000000003' as HelpCenterCategoryId,
      slug: 'billing',
      name: 'Billing',
      description: null,
      icon: '\u{1F4B0}',
      parentId: 'category_01jk0000000000000000000001' as HelpCenterCategoryId,
      isPublic: true,
      position: 0,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }
    vi.mocked(createCategory).mockResolvedValue(newCategory)

    const request = createRequest('POST', 'http://localhost/api/v1/help-center/categories', {
      name: 'Billing',
      icon: '\u{1F4B0}',
      parentId: 'category_01jk0000000000000000000001',
    })
    const response = await handlers.POST({ request })
    const json = await parseJson(response)

    expect(response.status).toBe(201)
    expect(json.data.name).toBe('Billing')
    expect(json.data.icon).toBe('\u{1F4B0}')
    expect(json.data.parentId).toBe('category_01jk0000000000000000000001')
    expect(createCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Billing',
        icon: '\u{1F4B0}',
        parentId: 'category_01jk0000000000000000000001',
      })
    )
  })

  it('creates a category without optional icon (defaults to null in response)', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    const newCategory: HelpCenterCategory = {
      id: 'category_01jk0000000000000000000004' as HelpCenterCategoryId,
      slug: 'general',
      name: 'General',
      description: null,
      icon: null,
      parentId: null,
      isPublic: true,
      position: 0,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }
    vi.mocked(createCategory).mockResolvedValue(newCategory)

    const request = createRequest('POST', 'http://localhost/api/v1/help-center/categories', {
      name: 'General',
    })
    const response = await handlers.POST({ request })
    const json = await parseJson(response)

    expect(response.status).toBe(201)
    expect(json.data.icon).toBeNull()
    expect(json.data.parentId).toBeNull()
  })

  it('returns 400 for missing name', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)

    const request = createRequest('POST', 'http://localhost/api/v1/help-center/categories', {})
    const response = await handlers.POST({ request })
    expect(response.status).toBe(400)
  })

  it('returns 403 when auth fails (non-admin)', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockRejectedValue(
      new ForbiddenError('FORBIDDEN', 'Admin required')
    )

    const request = createRequest('POST', 'http://localhost/api/v1/help-center/categories', {
      name: 'Test',
    })
    const response = await handlers.POST({ request })
    expect(response.status).toBe(403)
  })
})

// =============================================================================
// categories/$categoryId.ts -- GET (single) + PATCH (update) + DELETE
// =============================================================================

describe('GET /api/v1/help-center/categories/:categoryId', () => {
  it('returns a single category with icon and parentId', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockTeamAuthContext)
    vi.mocked(parseTypeId).mockImplementation((v) => v as string)
    const mockCategory: HelpCenterCategory = {
      id: 'category_01jk0000000000000000000001' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started',
      description: 'Intro guides',
      icon: '\u{1F680}',
      parentId: null,
      isPublic: true,
      position: 0,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    }
    vi.mocked(getCategoryById).mockResolvedValue(mockCategory)

    const request = createRequest(
      'GET',
      'http://localhost/api/v1/help-center/categories/category_01jk0000000000000000000001'
    )
    const response = await detailHandlers.GET({
      request,
      params: { categoryId: 'category_01jk0000000000000000000001' },
    })
    const json = await parseJson(response)

    expect(response.status).toBe(200)
    expect(json.data).toMatchObject({
      id: 'category_01jk0000000000000000000001',
      name: 'Getting Started',
      icon: '\u{1F680}',
      parentId: null,
    })
  })

  it('returns 404 when feature is disabled', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false)
    const request = createRequest(
      'GET',
      'http://localhost/api/v1/help-center/categories/category_01jk0000000000000000000001'
    )
    const response = await detailHandlers.GET({
      request,
      params: { categoryId: 'category_01jk0000000000000000000001' },
    })
    expect(response.status).toBe(404)
  })

  it('returns 400 for invalid category ID format', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockTeamAuthContext)
    vi.mocked(parseTypeId).mockImplementation(() => {
      throw new ValidationError('VALIDATION_ERROR', 'Invalid category ID format')
    })

    const request = createRequest(
      'GET',
      'http://localhost/api/v1/help-center/categories/invalid-id'
    )
    const response = await detailHandlers.GET({
      request,
      params: { categoryId: 'invalid-id' },
    })
    expect(response.status).toBe(400)
  })
})

describe('PATCH /api/v1/help-center/categories/:categoryId', () => {
  it('updates a category with icon', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(parseTypeId).mockImplementation((v) => v as string)
    const updatedCategory: HelpCenterCategory = {
      id: 'category_01jk0000000000000000000001' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started',
      description: 'Intro guides',
      icon: '\u{2728}',
      parentId: null,
      isPublic: true,
      position: 0,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-03'),
    }
    vi.mocked(updateCategory).mockResolvedValue(updatedCategory)

    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/categories/category_01jk0000000000000000000001',
      { icon: '\u{2728}' }
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { categoryId: 'category_01jk0000000000000000000001' },
    })
    const json = await parseJson(response)

    expect(response.status).toBe(200)
    expect(json.data.icon).toBe('\u{2728}')
    expect(updateCategory).toHaveBeenCalledWith(
      'category_01jk0000000000000000000001',
      expect.objectContaining({ icon: '\u{2728}' })
    )
  })

  it('updates a category with parentId', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(parseTypeId).mockImplementation((v) => v as string)
    const updatedCategory: HelpCenterCategory = {
      id: 'category_01jk0000000000000000000001' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started',
      description: null,
      icon: null,
      parentId: 'category_01jk0000000000000000000002' as HelpCenterCategoryId,
      isPublic: true,
      position: 0,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-03'),
    }
    vi.mocked(updateCategory).mockResolvedValue(updatedCategory)

    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/categories/category_01jk0000000000000000000001',
      { parentId: 'category_01jk0000000000000000000002' }
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { categoryId: 'category_01jk0000000000000000000001' },
    })
    const json = await parseJson(response)

    expect(response.status).toBe(200)
    expect(json.data.parentId).toBe('category_01jk0000000000000000000002')
    expect(updateCategory).toHaveBeenCalledWith(
      'category_01jk0000000000000000000001',
      expect.objectContaining({
        parentId: 'category_01jk0000000000000000000002',
      })
    )
  })

  it('clears icon by setting to null', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(parseTypeId).mockImplementation((v) => v as string)
    const updatedCategory: HelpCenterCategory = {
      id: 'category_01jk0000000000000000000001' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started',
      description: null,
      icon: null,
      parentId: null,
      isPublic: true,
      position: 0,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-03'),
    }
    vi.mocked(updateCategory).mockResolvedValue(updatedCategory)

    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/categories/category_01jk0000000000000000000001',
      { icon: null }
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { categoryId: 'category_01jk0000000000000000000001' },
    })
    const json = await parseJson(response)

    expect(response.status).toBe(200)
    expect(json.data.icon).toBeNull()
    expect(updateCategory).toHaveBeenCalledWith(
      'category_01jk0000000000000000000001',
      expect.objectContaining({ icon: null })
    )
  })

  it('returns 403 when auth fails (non-admin)', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockRejectedValue(
      new ForbiddenError('FORBIDDEN', 'Admin required')
    )

    const request = createRequest(
      'PATCH',
      'http://localhost/api/v1/help-center/categories/category_01jk0000000000000000000001',
      { name: 'Updated' }
    )
    const response = await detailHandlers.PATCH({
      request,
      params: { categoryId: 'category_01jk0000000000000000000001' },
    })
    expect(response.status).toBe(403)
  })
})

describe('DELETE /api/v1/help-center/categories/:categoryId', () => {
  it('deletes a category and returns 204', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(parseTypeId).mockImplementation((v) => v as string)
    vi.mocked(deleteCategory).mockResolvedValue(undefined)

    const request = createRequest(
      'DELETE',
      'http://localhost/api/v1/help-center/categories/category_01jk0000000000000000000001'
    )
    const response = await detailHandlers.DELETE({
      request,
      params: { categoryId: 'category_01jk0000000000000000000001' },
    })

    expect(response.status).toBe(204)
    expect(deleteCategory).toHaveBeenCalledWith('category_01jk0000000000000000000001')
  })

  it('returns 403 when auth fails (non-admin)', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockRejectedValue(
      new ForbiddenError('FORBIDDEN', 'Admin required')
    )

    const request = createRequest(
      'DELETE',
      'http://localhost/api/v1/help-center/categories/category_01jk0000000000000000000001'
    )
    const response = await detailHandlers.DELETE({
      request,
      params: { categoryId: 'category_01jk0000000000000000000001' },
    })
    expect(response.status).toBe(403)
  })

  it('returns 400 for invalid category ID format', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(withApiKeyAuth).mockResolvedValue(mockAuthContext)
    vi.mocked(parseTypeId).mockImplementation(() => {
      throw new ValidationError('VALIDATION_ERROR', 'Invalid category ID format')
    })

    const request = createRequest('DELETE', 'http://localhost/api/v1/help-center/categories/bad-id')
    const response = await detailHandlers.DELETE({
      request,
      params: { categoryId: 'bad-id' },
    })
    expect(response.status).toBe(400)
  })
})
