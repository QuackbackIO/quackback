/**
 * Advanced API Integration Tests (boundary conditions and proxy voting)
 *
 * These tests run against a live server and require:
 * 1. Dev server running: `bun run dev`
 * 2. Valid API key in database
 *
 * Run with: API_KEY=qb_xxx bun run test apps/web/src/lib/api/__tests__/api-integration-advanced.test.ts
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

describe.skipIf(SKIP_INTEGRATION)('API Integration Tests - Advanced', () => {
  beforeAll(async () => {
    state.serverAvailable = await checkServerAndSetup(state)
  })

  afterAll(async () => {
    if (!state.serverAvailable) return
    await cleanupCreatedResources(state.createdIds)
  })

  describe('Boundary Conditions', () => {
    it('accepts max length title (200 chars)', async () => {
      if (skipIfNoServer() || !state.testBoardId) return

      const { status, data } = await api('POST', '/posts', {
        boardId: state.testBoardId,
        title: 'A'.repeat(200),
        content: 'Test content',
      })
      expect(status).toBe(201)
      state.createdIds.posts.push((data as { data: { id: string } }).data.id)
    })

    it('rejects title exceeding max length', async () => {
      if (skipIfNoServer() || !state.testBoardId) return

      const { status } = await api('POST', '/posts', {
        boardId: state.testBoardId,
        title: 'A'.repeat(201),
        content: 'Test content',
      })
      expect(status).toBe(400)
    })

    it('handles unicode in post title', async () => {
      if (skipIfNoServer() || !state.testBoardId) return

      const { status, data } = await api('POST', '/posts', {
        boardId: state.testBoardId,
        title: '🎉 Unicode Test 日本語 Ñoño',
        content: 'Testing unicode support',
      })
      expect(status).toBe(201)
      state.createdIds.posts.push((data as { data: { id: string } }).data.id)
    })
  })

  describe('Proxy Voting', () => {
    let voterPrincipalId: string | null = null

    it('POST /posts/:postId/vote/proxy requires voterPrincipalId', async () => {
      if (skipIfNoServer() || !state.testPostId) return

      const { status } = await api('POST', `/posts/${state.testPostId}/vote/proxy`, {})
      expect(status).toBe(400)
    })

    it('POST /posts/:postId/vote/proxy rejects invalid post ID', async () => {
      if (skipIfNoServer()) return

      const { status } = await api('POST', '/posts/invalid_id/vote/proxy', {
        voterPrincipalId: 'principal_01h455vb4pex5vsknk084sn02q',
      })
      expect(status).toBe(400)
    })

    it('POST /posts/:postId/vote/proxy adds a proxy vote', async () => {
      if (skipIfNoServer() || !state.testPostId) return

      // Create a voter via identify endpoint
      const { data: identifyData } = await api('POST', '/users/identify', {
        externalId: `proxy-vote-test-${Date.now()}`,
        name: 'Proxy Vote Test User',
        email: `proxy-test-${Date.now()}@example.com`,
      })
      voterPrincipalId =
        (identifyData as { data: { principalId: string } })?.data?.principalId ?? null
      if (!voterPrincipalId) return

      const { status, data } = await api('POST', `/posts/${state.testPostId}/vote/proxy`, {
        voterPrincipalId,
      })
      expect(status).toBe(200)
      const result = (data as { data: { voted: boolean; voteCount: number } }).data
      expect(result).toHaveProperty('voted')
      expect(result).toHaveProperty('voteCount')
      expect(typeof result.voteCount).toBe('number')
    })

    it('POST /posts/:postId/vote/proxy is idempotent', async () => {
      if (skipIfNoServer() || !state.testPostId || !voterPrincipalId) return

      const { status, data } = await api('POST', `/posts/${state.testPostId}/vote/proxy`, {
        voterPrincipalId,
      })
      expect(status).toBe(200)
      const result = (data as { data: { voted: boolean } }).data
      expect(result.voted).toBe(false) // Already voted, no-op
    })

    it('DELETE /posts/:postId/vote/proxy removes the proxy vote', async () => {
      if (skipIfNoServer() || !state.testPostId || !voterPrincipalId) return

      const { status } = await api('DELETE', `/posts/${state.testPostId}/vote/proxy`, {
        voterPrincipalId,
      })
      expect(status).toBe(204)
    })

    it('DELETE /posts/:postId/vote/proxy is safe when no vote exists', async () => {
      if (skipIfNoServer() || !state.testPostId || !voterPrincipalId) return

      // Deleting again after already removed
      const { status } = await api('DELETE', `/posts/${state.testPostId}/vote/proxy`, {
        voterPrincipalId,
      })
      expect(status).toBe(204)
    })

    it('DELETE /posts/:postId/vote/proxy requires voterPrincipalId', async () => {
      if (skipIfNoServer() || !state.testPostId) return

      const { status } = await api('DELETE', `/posts/${state.testPostId}/vote/proxy`, {})
      expect(status).toBe(400)
    })
  })
})
