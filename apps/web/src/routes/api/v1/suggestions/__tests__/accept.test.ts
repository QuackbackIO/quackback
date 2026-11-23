/**
 * Accepting a merge suggestion over REST merges two posts, so the key needs
 * post.merge as well as suggestion.manage, like POST /posts/:id/merge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockAccept = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/api/auth')>()),
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/merge-suggestions/merge-suggestion.service', () => ({
  acceptMergeSuggestion: (...args: unknown[]) => mockAccept(...args),
}))

import { Route } from '../$suggestionId.accept'

type RouteOpts = { server: { handlers: { POST: (...args: unknown[]) => Promise<Response> } } }
const POST = (Route as unknown as { options: RouteOpts }).options.server.handlers.POST

const keyWith = (permissions: string[]) => ({
  principalId: createId('principal'),
  role: 'member',
  permissions: new Set(permissions),
  apiKey: { scopes: null },
})

function call() {
  const suggestionId = createId('post_merge_suggestion')
  const request = new Request(`http://test/api/v1/suggestions/${suggestionId}/accept`, {
    method: 'POST',
  })
  return POST({ request, params: { suggestionId } })
}

describe('POST /api/v1/suggestions/:id/accept', () => {
  beforeEach(() => {
    mockWithApiKeyAuth.mockReset()
    mockAccept.mockReset()
  })

  it('refuses a key without post.merge and merges nothing', async () => {
    mockWithApiKeyAuth.mockResolvedValue(keyWith(['suggestion.manage']))
    const res = await call()
    expect(res.status).toBe(403)
    expect(mockAccept).not.toHaveBeenCalled()
  })

  it('accepts for a key holding post.merge too', async () => {
    mockWithApiKeyAuth.mockResolvedValue(keyWith(['suggestion.manage', 'post.merge']))
    const res = await call()
    expect(res.status).toBe(200)
    expect(mockAccept).toHaveBeenCalledOnce()
  })
})
