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

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api/v1'
const API_KEY = process.env.API_KEY || ''
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION === 'true'

// Test state
let serverAvailable = false
let testBoardId: string | null = null
let testPostId: string | null = null

// Track created resources for cleanup
const createdIds: { posts: string[]; boards: string[]; tags: string[]; roadmaps: string[] } = {
  posts: [],
  boards: [],
  tags: [],
  roadmaps: [],
}

// Helper to make API calls
async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  let data: unknown = null
  if (res.status !== 204) {
    try {
      data = await res.json()
    } catch {
      data = null
    }
  }

  return { status: res.status, data }
}

// Check if server is running
async function checkServerAndSetup(): Promise<boolean> {
  if (!API_KEY) {
    console.warn('⚠️ No API_KEY provided - skipping API integration tests')
    console.warn('   Run with: API_KEY=qb_xxx bun run test api-integration')
    return false
  }

  try {
    const res = await fetch(`${BASE_URL}/boards`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    })
    if (res.status === 401) {
      console.warn('⚠️ Invalid API key - skipping API integration tests')
      return false
    }
    if (res.status !== 200) {
      console.warn('⚠️ Server not responding correctly - skipping API integration tests')
      return false
    }

    // Get test data
    const boardsData = await res.json()
    const boards = (boardsData as { data: Array<{ id: string }> })?.data || []
    if (boards.length > 0) {
      testBoardId = boards[0].id
    }

    const { data: postsData } = await api('GET', '/posts')
    const posts = (postsData as { data: Array<{ id: string }> })?.data || []
    if (posts.length > 0) {
      testPostId = posts[0].id
    }

    return true
  } catch {
    console.warn('⚠️ Server not running - skipping API integration tests')
    console.warn('   Start server with: bun run dev')
    return false
  }
}

// Skip helper - use inside tests
function skipIfNoServer() {
  if (!serverAvailable) {
    return true
  }
  return false
}

describe.skipIf(SKIP_INTEGRATION)('API Integration Tests', () => {
  beforeAll(async () => {
    serverAvailable = await checkServerAndSetup()
  })

  afterAll(async () => {
    if (!serverAvailable) return

    // Cleanup created resources in reverse order
    for (const id of createdIds.posts) {
      await api('DELETE', `/posts/${id}`)
    }
    for (const id of createdIds.tags) {
      await api('DELETE', `/tags/${id}`)
    }
    for (const id of createdIds.roadmaps) {
      await api('DELETE', `/roadmaps/${id}`)
    }
    for (const id of createdIds.boards) {
      await api('DELETE', `/boards/${id}`)
    }
  })

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      if (skipIfNoServer()) return

      const res = await fetch(`${BASE_URL}/boards`)
      expect(res.status).toBe(401)
    })

    it('should reject invalid API key', async () => {
      if (skipIfNoServer()) return

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
      createdIds.boards.push(boardId)
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
      if (skipIfNoServer() || !testBoardId) return

      const { status, data } = await api('GET', `/boards/${testBoardId}`)
      expect(status).toBe(200)
      expect((data as { data: { id: string } }).data.id).toBe(testBoardId)
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
      if (skipIfNoServer() || !testBoardId) return

      const { status, data } = await api('POST', '/posts', {
        boardId: testBoardId,
        title: `Test Post ${Date.now()}`,
        content: 'Test content for integration test',
      })
      expect(status).toBe(201)
      const postId = (data as { data: { id: string } }).data.id
      expect(postId).toBeDefined()
      createdIds.posts.push(postId)
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
      if (skipIfNoServer() || !testPostId) return

      const { status, data } = await api('GET', `/posts/${testPostId}`)
      expect(status).toBe(200)
      expect((data as { data: { id: string } }).data.id).toBe(testPostId)
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

      const { createId } = await import('@quackback/ids')
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
      if (skipIfNoServer() || !testBoardId) return

      const { data } = await api('GET', `/boards/${testBoardId}`)
      expect((data as { data: Record<string, unknown> }).data).toBeInstanceOf(Object)
      expect(Array.isArray((data as { data: unknown }).data)).toBe(false)
    })

    it('dates are ISO 8601 format', async () => {
      if (skipIfNoServer() || !testPostId) return

      const { data } = await api('GET', `/posts/${testPostId}`)
      const post = (data as { data: { createdAt: string } }).data
      expect(post.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  describe('Referential Integrity', () => {
    it('cannot create post with non-existent boardId', async () => {
      if (skipIfNoServer()) return

      const { createId } = await import('@quackback/ids')
      const fakeBoardId = createId('board')
      const { status } = await api('POST', '/posts', {
        boardId: fakeBoardId,
        title: 'Test',
        content: 'Test',
      })
      expect(status).toBe(404)
    })

    it('cannot create post with non-existent statusId', async () => {
      if (skipIfNoServer() || !testBoardId) return

      const { createId } = await import('@quackback/ids')
      const fakeStatusId = createId('status')
      const { status } = await api('POST', '/posts', {
        boardId: testBoardId,
        title: 'Test',
        content: 'Test',
        statusId: fakeStatusId,
      })
      expect(status).toBe(404)
    })

    it('cannot create comment on non-existent post', async () => {
      if (skipIfNoServer()) return

      const { createId } = await import('@quackback/ids')
      const fakePostId = createId('post')
      const { status } = await api('POST', `/posts/${fakePostId}/comments`, {
        content: 'Test comment',
      })
      expect(status).toBe(404)
    })
  })

  describe('Boundary Conditions', () => {
    it('accepts max length title (200 chars)', async () => {
      if (skipIfNoServer() || !testBoardId) return

      const { status, data } = await api('POST', '/posts', {
        boardId: testBoardId,
        title: 'A'.repeat(200),
        content: 'Test content',
      })
      expect(status).toBe(201)
      createdIds.posts.push((data as { data: { id: string } }).data.id)
    })

    it('rejects title exceeding max length', async () => {
      if (skipIfNoServer() || !testBoardId) return

      const { status } = await api('POST', '/posts', {
        boardId: testBoardId,
        title: 'A'.repeat(201),
        content: 'Test content',
      })
      expect(status).toBe(400)
    })

    it('handles unicode in post title', async () => {
      if (skipIfNoServer() || !testBoardId) return

      const { status, data } = await api('POST', '/posts', {
        boardId: testBoardId,
        title: '🎉 Unicode Test 日本語 Ñoño',
        content: 'Testing unicode support',
      })
      expect(status).toBe(201)
      createdIds.posts.push((data as { data: { id: string } }).data.id)
    })
  })
})
