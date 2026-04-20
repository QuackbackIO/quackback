/**
 * Help Center API Integration Tests
 *
 * Run with: API_KEY=qb_xxx bun run test help-center-api
 * To skip: SKIP_INTEGRATION=true bun run test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  SKIP_INTEGRATION,
  api,
  createTestState,
  checkServerAndSetup,
  cleanupCreatedResources,
} from './api-integration.helpers'

interface HCTestState {
  serverAvailable: boolean
  testCategoryId: string | null
  testArticleId: string | null
  testPrincipalId: string | null
  createdIds: { articles: string[]; categories: string[] }
}

function createHCTestState(): HCTestState {
  return {
    serverAvailable: false,
    testCategoryId: null,
    testArticleId: null,
    testPrincipalId: null,
    createdIds: { articles: [], categories: [] },
  }
}

const state = createHCTestState()
const baseState = createTestState()

function skipIfNoServer() {
  return !state.serverAvailable
}

describe.skipIf(SKIP_INTEGRATION)('Help Center Articles API', () => {
  beforeAll(async () => {
    state.serverAvailable = await checkServerAndSetup(baseState)
    if (!state.serverAvailable) return

    // Create a test category
    const { status: catStatus, data: catData } = await api(
      'POST',
      '/help-center/categories',
      { name: `Test Category ${Date.now()}`, slug: `test-cat-${Date.now()}` }
    )
    if (catStatus === 201) {
      state.testCategoryId = (catData as { data: { id: string } }).data.id
      state.createdIds.categories.push(state.testCategoryId)
    }

    // Create a test principal via identify
    const { data: identifyData } = await api('POST', '/users/identify', {
      externalId: `hc-author-test-${Date.now()}`,
      name: 'HC Author Test User',
      email: `hc-author-${Date.now()}@example.com`,
    })
    state.testPrincipalId =
      (identifyData as { data: { principalId: string } })?.data?.principalId ?? null
  })

  afterAll(async () => {
    if (!state.serverAvailable) return
    for (const id of state.createdIds.articles) {
      await api('DELETE', `/help-center/articles/${id}`)
    }
    for (const id of state.createdIds.categories) {
      await api('DELETE', `/help-center/categories/${id}`)
    }
    await cleanupCreatedResources(baseState.createdIds)
  })

  describe('POST /help-center/articles', () => {
    it('is accessible by team members (not admin-only)', async () => {
      if (skipIfNoServer() || !state.testCategoryId) return

      const { status, data } = await api('POST', '/help-center/articles', {
        categoryId: state.testCategoryId,
        title: `Team Member Article ${Date.now()}`,
        content: 'Created by team member',
      })
      expect(status).toBe(201)
      const id = (data as { data: { id: string } }).data.id
      state.testArticleId = id
      state.createdIds.articles.push(id)
    })

    it('creates article attributed to authorId when provided', async () => {
      if (skipIfNoServer() || !state.testCategoryId || !state.testPrincipalId) return

      const { status, data } = await api('POST', '/help-center/articles', {
        categoryId: state.testCategoryId,
        title: `Authored Article ${Date.now()}`,
        content: 'Article with explicit author',
        authorId: state.testPrincipalId,
      })
      expect(status).toBe(201)
      const article = (data as { data: { id: string; author: { id: string } | null } }).data
      expect(article.author?.id).toBe(state.testPrincipalId)
      state.createdIds.articles.push(article.id)
    })

    it('returns 400 for invalid authorId format', async () => {
      if (skipIfNoServer() || !state.testCategoryId) return

      const { status } = await api('POST', '/help-center/articles', {
        categoryId: state.testCategoryId,
        title: 'Bad Author Article',
        content: 'Content',
        authorId: 'not_a_valid_typeid',
      })
      expect(status).toBe(400)
    })

    it('returns 400 for non-existent authorId', async () => {
      if (skipIfNoServer() || !state.testCategoryId) return

      const { status } = await api('POST', '/help-center/articles', {
        categoryId: state.testCategoryId,
        title: 'Ghost Author Article',
        content: 'Content',
        // Valid TypeID format but doesn't exist in DB
        authorId: 'principal_01h455vb4pex5vsknk084sn02q',
      })
      expect(status).toBe(400)
    })
  })

  describe('PATCH /help-center/articles/:articleId', () => {
    it('is accessible by team members (not admin-only)', async () => {
      if (skipIfNoServer() || !state.testArticleId) return

      const { status } = await api('PATCH', `/help-center/articles/${state.testArticleId}`, {
        title: 'Updated by Team Member',
      })
      expect(status).toBe(200)
    })

    it('reassigns author when authorId is provided', async () => {
      if (skipIfNoServer() || !state.testArticleId || !state.testPrincipalId) return

      const { status, data } = await api(
        'PATCH',
        `/help-center/articles/${state.testArticleId}`,
        { authorId: state.testPrincipalId }
      )
      expect(status).toBe(200)
      const article = (data as { data: { author: { id: string } | null } }).data
      expect(article.author?.id).toBe(state.testPrincipalId)
    })

    it('returns 400 for invalid authorId format', async () => {
      if (skipIfNoServer() || !state.testArticleId) return

      const { status } = await api('PATCH', `/help-center/articles/${state.testArticleId}`, {
        authorId: 'not_a_valid_typeid',
      })
      expect(status).toBe(400)
    })

    it('returns 400 for non-existent authorId', async () => {
      if (skipIfNoServer() || !state.testArticleId) return

      const { status } = await api('PATCH', `/help-center/articles/${state.testArticleId}`, {
        authorId: 'principal_01h455vb4pex5vsknk084sn02q',
      })
      expect(status).toBe(400)
    })
  })
})
