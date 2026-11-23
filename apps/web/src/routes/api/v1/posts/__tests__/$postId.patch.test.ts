import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId, PrincipalId } from '@quackback/ids'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const mockWithApiKeyAuth = vi.fn()
const mockUpdatePost = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/api/auth')>()),
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/posts/post.service', () => ({
  updatePost: (...args: unknown[]) => mockUpdatePost(...args),
}))

import { Route } from '../$postId'

type RouteOpts = { server: { handlers: { PATCH: (...args: unknown[]) => Promise<Response> } } }
const PATCH = (Route as unknown as { options: RouteOpts }).options.server.handlers.PATCH

const POST_ID = 'post_01kqhxq697fvgat0h1abc12345' as unknown as PostId
const KEY_PRINCIPAL = 'principal_01kqhxq697fvgat0fn8rr1r7ew' as unknown as PrincipalId
const ALL_POST_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.POST_VIEW_PRIVATE,
  PERMISSIONS.POST_EDIT,
  PERMISSIONS.POST_SET_STATUS,
  PERMISSIONS.POST_SET_TAGS,
  PERMISSIONS.POST_SET_OWNER,
]

function keyAuth(scopes: string[] | null, permissions = ALL_POST_PERMISSIONS) {
  return {
    principalId: KEY_PRINCIPAL,
    role: 'admin',
    importMode: false,
    permissions: new Set(permissions),
    apiKey: { name: 'Key', scopes },
  }
}

function patch(body: unknown) {
  return PATCH({
    request: new Request(`http://test/api/v1/posts/${POST_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: { postId: POST_ID },
  })
}

const post = {
  id: POST_ID,
  title: 'A secret idea',
  content: '',
  contentJson: null,
  voteCount: 1,
  boardId: 'board_01kqhxq697fvgat0h1abc12345',
  statusId: null,
  ownerPrincipalId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('PATCH /api/v1/posts/:postId', () => {
  beforeEach(() => {
    mockWithApiKeyAuth.mockReset()
    mockUpdatePost.mockReset()
    mockUpdatePost.mockResolvedValue(post)
  })

  it.each([[{}], [{ boardId: 'board_01kqhxq697fvgat0h1abc12345' }]])(
    'refuses a key without the feedback scopes a body with no field (%j) and returns no post',
    async (body) => {
      mockWithApiKeyAuth.mockResolvedValue(keyAuth(['read:chat']))
      const res = await patch(body)
      expect(res.status).toBe(403)
      expect(await res.text()).not.toContain('A secret idea')
      expect(mockUpdatePost).not.toHaveBeenCalled()
    }
  )

  it('refuses a read-only key a body with no field', async () => {
    mockWithApiKeyAuth.mockResolvedValue(keyAuth(['read:feedback']))
    const res = await patch({})
    expect(res.status).toBe(403)
    expect(mockUpdatePost).not.toHaveBeenCalled()
  })

  it('answers a writer a body with no field as a bad request, not the post', async () => {
    mockWithApiKeyAuth.mockResolvedValue(keyAuth(['write:feedback']))
    const res = await patch({})
    expect(res.status).toBe(400)
    expect(await res.text()).not.toContain('A secret idea')
    expect(mockUpdatePost).not.toHaveBeenCalled()
  })

  it('refuses a caller who can set a status but cannot read the post', async () => {
    mockWithApiKeyAuth.mockResolvedValue(
      keyAuth(null, [PERMISSIONS.POST_SET_STATUS, PERMISSIONS.POST_SET_TAGS])
    )
    const res = await patch({ tagIds: [] })
    expect(res.status).toBe(403)
    expect(mockUpdatePost).not.toHaveBeenCalled()
  })

  it('names the field permission first when the caller lacks it', async () => {
    mockWithApiKeyAuth.mockResolvedValue(keyAuth(['read:feedback']))
    const res = await patch({ tagIds: [] })
    expect(res.status).toBe(403)
    expect((await res.json()).error.message).toBe(
      "This API key is missing the 'write:feedback' scope required by 'post.set_tags'"
    )
  })

  it('updates and returns the post for a writer', async () => {
    mockWithApiKeyAuth.mockResolvedValue(keyAuth(['write:feedback']))
    const res = await patch({ title: 'Renamed' })
    expect(res.status).toBe(200)
    expect((await res.json()).data.id).toBe(POST_ID)
    expect(mockUpdatePost).toHaveBeenCalledOnce()
  })
})
