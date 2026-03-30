/**
 * API Integration Tests
 *
 * These tests run against a live server and require:
 * 1. Dev server running: `bun run dev`
 * 2. Valid API key in database
 *
 * Run with: API_KEY=qb_xxx bun run test apps/web/src/lib/api/__tests__/api-integration.test.ts
 *
 * To skip these tests (CI without server): SKIP_INTEGRATION=true bun run test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  SKIP_INTEGRATION,
  api,
  createTestState,
  checkServerAndSetup,
  cleanupCreatedResources,
} from './api-integration.helpers'

const state = createTestState()

function skipIfNoServer() {
  return !state.serverAvailable
}

describe.skipIf(SKIP_INTEGRATION)('API Integration Tests', () => {
  beforeAll(async () => {
    state.serverAvailable = await checkServerAndSetup(state)
  })

  afterAll(async () => {
    if (!state.serverAvailable) return
    await cleanupCreatedResources(state.createdIds)
  })

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      if (skipIfNoServer()) return

      const { BASE_URL } = await import('./api-integration.helpers')
      const res = await fetch(`${BASE_URL}/boards`)
      expect(res.status).toBe(401)
    })

    it('should reject invalid API key', async () => {
      if (skipIfNoServer()) return

      const { BASE_URL } = await import('./api-integration.helpers')
      const res = await fetch(`${BASE_URL}/boards`, {
        headers: { Authorization: 'Bearer invalid_key' },
      })
      expect(res.status).toBe(401)
    })

    it('should accept valid API key', async () => {
      if (skipIfNoServer()) return

      const { status } = await api('GET', '/boards')
      expect(status).toBe(200)
    })
  })

  describe('Boards CRUD', () => {
    it('GET /boards returns list', async () => {
      if (skipIfNoServer()) return

      const { status, data } = await api('GET', '/boards')
      expect(status).toBe(200)
      expect((data as { data: unknown[] }).data).toBeInstanceOf(Array)
    })

    it('POST /boards creates board', async () => {
      if (skipIfNoServer()) return

      const { status, data } = await api('POST', '/boards', {
        name: `Test Board ${Date.now()}`,
        slug: `test-board-${Date.now()}`,
      })
      expect(status).toBe(201)
      const boardId = (data as { data: { id: string } }).data.id
      expect(boardId).toBeDefined()
      state.createdIds.boards.push(boardId)
    })

    it('POST /boards with invalid slug returns 400', async () => {
      if (skipIfNoServer()) return

      const { status } = await api('POST', '/boards', {
        name: 'Test Board',
        slug: 'invalid_slug_with_underscores',
      })
      expect(status).toBe(400)
    })

    it('GET /boards/:id returns board', async () => {
      if (skipIfNoServer() || !state.testBoardId) return

      const { status, data } = await api('GET', `/boards/${state.testBoardId}`)
      expect(status).toBe(200)
      expect((data as { data: { id: string } }).data.id).toBe(state.testBoardId)
    })

    it('GET /boards/:id with invalid ID returns 400', async () => {
      if (skipIfNoServer()) return

      const { status } = await api('GET', '/boards/invalid-id')
      expect(status).toBe(400)
    })
  })

  describe('Posts CRUD', () => {
    it('GET /posts returns paginated list', async () => {
      if (skipIfNoServer()) return

      const { status, data } = await api('GET', '/posts')
      expect(status).toBe(200)
      expect((data as { data: unknown[] }).data).toBeInstanceOf(Array)
      expect((data as { meta: { pagination: unknown } }).meta?.pagination).toBeDefined()
    })

    it('POST /posts creates post', async () => {
      if (skipIfNoServer() || !state.testBoardId) return

      const { status, data } = await api('POST', '/posts', {
        boardId: state.testBoardId,
        title: `Test Post ${Date.now()}`,
        content: 'Test content for integration test',
      })
      expect(status).toBe(201)
      const postId = (data as { data: { id: string } }).data.id
      expect(postId).toBeDefined()
      state.createdIds.posts.push(postId)
    })

    it('POST /posts creates post with empty content', async () => {
      if (skipIfNoServer() || !state.testBoardId) return

      const { status, data } = await api('POST', '/posts', {
        boardId: state.testBoardId,
        title: `Title Only Post ${Date.now()}`,
        content: '',
      })
      expect(status).toBe(201)
      const postId = (data as { data: { id: string } }).data.id
      expect(postId).toBeDefined()
      state.createdIds.posts.push(postId)
    })

    it('POST /posts validation error returns 400', async () => {
      if (skipIfNoServer()) return

      const { status, data } = await api('POST', '/posts', {
        title: '', // Empty title
        content: 'Test',
      })
      expect(status).toBe(400)
      expect((data as { error: { code: string } }).error.code).toBe('BAD_REQUEST')
    })

    it('GET /posts/:id returns post', async () => {
      if (skipIfNoServer() || !state.testPostId) return

      const { status, data } = await api('GET', `/posts/${state.testPostId}`)
      expect(status).toBe(200)
      expect((data as { data: { id: string } }).data.id).toBe(state.testPostId)
    })

    it('GET /posts/:id with invalid ID returns 400', async () => {
      if (skipIfNoServer()) return

      const { status } = await api('GET', '/posts/invalid-id')
      expect(status).toBe(400)
    })
  })

  describe('TypeID Validation', () => {
    it('rejects malformed TypeID in path', async () => {
      if (skipIfNoServer()) return

      const { status } = await api('GET', '/posts/post_invalid123')
      expect(status).toBe(400)
    })

    it('rejects wrong prefix in TypeID', async () => {
      if (skipIfNoServer()) return

      // Using a board ID format where post ID is expected
      const { status } = await api('GET', '/posts/board_01kg7a1p2desk9rjpgfjkmxkaa')
      expect(status).toBe(400)
    })

    it('handles invalid filter parameters gracefully', async () => {
      if (skipIfNoServer()) return

      // Invalid boardId in filter should return results (ignoring invalid filter)
      const { status } = await api('GET', '/posts?boardId=invalid')
      expect(status).toBe(200)
    })
  })

  describe('Pagination', () => {
    it('respects limit parameter', async () => {
      if (skipIfNoServer()) return

      const { status, data } = await api('GET', '/posts?limit=5')
      expect(status).toBe(200)
      expect((data as { data: unknown[] }).data.length).toBeLessThanOrEqual(5)
    })

    it('enforces max limit', async () => {
      if (skipIfNoServer()) return

      const { status, data } = await api('GET', '/posts?limit=500')
      expect(status).toBe(200)
      expect((data as { data: unknown[] }).data.length).toBeLessThanOrEqual(100)
    })

    it('cursor pagination works', async () => {
      if (skipIfNoServer()) return

      const { status, data } = await api('GET', '/posts?limit=1')
      expect(status).toBe(200)
      const pagination = (data as { meta: { pagination: { cursor: string | null } } }).meta
        ?.pagination
      if (pagination?.cursor) {
        const { status: nextStatus } = await api(
          'GET',
          `/posts?limit=1&cursor=${pagination.cursor}`
        )
        expect(nextStatus).toBe(200)
      }
    })
  })

  describe('Error Handling', () => {
    it('returns 404 for non-existent resource', async () => {
      if (skipIfNoServer()) return

      const { createId } = await import('@featurepool/ids')
      const fakePostId = createId('post')
      const { status, data } = await api('GET', `/posts/${fakePostId}`)
      expect(status).toBe(404)
      expect((data as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    })

    it('returns proper error structure', async () => {
      if (skipIfNoServer()) return

      const { status, data } = await api('POST', '/posts', {})
      expect(status).toBe(400)
      expect((data as { error: { code: string; message: string } }).error).toMatchObject({
        code: expect.any(String),
        message: expect.any(String),
      })
    })
  })

  describe('Response Format', () => {
    it('list response has data array', async () => {
      if (skipIfNoServer()) return

      const { data } = await api('GET', '/boards')
      expect((data as { data: unknown[] }).data).toBeInstanceOf(Array)
    })

    it('single resource has data object', async () => {
      if (skipIfNoServer() || !state.testBoardId) return

      const { data } = await api('GET', `/boards/${state.testBoardId}`)
      expect((data as { data: Record<string, unknown> }).data).toBeInstanceOf(Object)
      expect(Array.isArray((data as { data: unknown }).data)).toBe(false)
    })

    it('dates are ISO 8601 format', async () => {
      if (skipIfNoServer() || !state.testPostId) return

      const { data } = await api('GET', `/posts/${state.testPostId}`)
      const post = (data as { data: { createdAt: string } }).data
      expect(post.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  describe('Referential Integrity', () => {
    it('cannot create post with non-existent boardId', async () => {
      if (skipIfNoServer()) return

      const { createId } = await import('@featurepool/ids')
      const fakeBoardId = createId('board')
      const { status } = await api('POST', '/posts', {
        boardId: fakeBoardId,
        title: 'Test',
        content: 'Test',
      })
      expect(status).toBe(404)
    })

    it('cannot create post with non-existent statusId', async () => {
      if (skipIfNoServer() || !state.testBoardId) return

      const { createId } = await import('@featurepool/ids')
      const fakeStatusId = createId('status')
      const { status } = await api('POST', '/posts', {
        boardId: state.testBoardId,
        title: 'Test',
        content: 'Test',
        statusId: fakeStatusId,
      })
      expect(status).toBe(404)
    })

    it('cannot create comment on non-existent post', async () => {
      if (skipIfNoServer()) return

      const { createId } = await import('@featurepool/ids')
      const fakePostId = createId('post')
      const { status } = await api('POST', `/posts/${fakePostId}/comments`, {
        content: 'Test comment',
      })
      expect(status).toBe(404)
    })
  })
})
