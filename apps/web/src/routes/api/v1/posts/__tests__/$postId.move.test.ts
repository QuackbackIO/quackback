import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardId, PostId, PrincipalId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockChangeBoard = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/posts/post.board', () => ({
  changeBoard: (...args: unknown[]) => mockChangeBoard(...args),
}))

import { PERMISSIONS } from '@/lib/shared/permissions'
import { Route } from '../$postId.move'

type RouteOpts = {
  server: {
    handlers: {
      POST: (args: { request: Request; params: { postId: string } }) => Promise<Response>
    }
  }
}
const POST = (Route as unknown as { options: RouteOpts }).options.server.handlers.POST

const POST_ID = 'post_01kqhxq697fvgat0h1abc12345' as unknown as PostId
const BOARD_ID = 'board_01kqhxq697fvgat0h1abc12346' as unknown as BoardId
const PRINCIPAL_ID = 'principal_01kqhxq697fvgat0fn8rr1r7ew' as unknown as PrincipalId

function makeRequest(body?: unknown, raw?: string): Request {
  return new Request(`http://test/api/v1/posts/${POST_ID}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(raw !== undefined
      ? { body: raw }
      : body === undefined
        ? {}
        : { body: JSON.stringify(body) }),
  })
}

describe('POST /api/v1/posts/:postId/move', () => {
  beforeEach(() => {
    mockWithApiKeyAuth.mockReset()
    mockChangeBoard.mockReset()
    mockWithApiKeyAuth.mockResolvedValue({
      principalId: PRINCIPAL_ID,
      role: 'member',
      apiKey: { name: 'Triage key' },
      importMode: false,
    })
    mockChangeBoard.mockResolvedValue({ id: POST_ID, boardId: BOARD_ID })
  })

  it('moves the post and returns its id and new board', async () => {
    const res = await POST({
      request: makeRequest({ boardId: BOARD_ID }),
      params: { postId: POST_ID },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { id: POST_ID, boardId: BOARD_ID } })
    expect(mockChangeBoard).toHaveBeenCalledWith(POST_ID, BOARD_ID, {
      principalId: PRINCIPAL_ID,
      displayName: 'Triage key',
    })
  })

  it('requires the post.set_board permission', async () => {
    await POST({ request: makeRequest({ boardId: BOARD_ID }), params: { postId: POST_ID } })

    expect(mockWithApiKeyAuth).toHaveBeenCalledWith(expect.any(Request), {
      permission: PERMISSIONS.POST_SET_BOARD,
    })
  })

  it.each([
    ['a missing body', makeRequest()],
    ['malformed JSON', makeRequest(undefined, '{')],
    ['an object without boardId', makeRequest({})],
    ['an empty boardId', makeRequest({ boardId: '' })],
    ['a non-object body', makeRequest(BOARD_ID)],
  ])('returns 400 for %s', async (_label, request) => {
    const res = await POST({ request, params: { postId: POST_ID } })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: 'Invalid request body' },
    })
    expect(mockChangeBoard).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed post ID', async () => {
    const res = await POST({
      request: makeRequest({ boardId: BOARD_ID }),
      params: { postId: 'not-a-typeid' },
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
    expect(mockChangeBoard).not.toHaveBeenCalled()
  })

  it('returns 400 when boardId is not a board TypeID', async () => {
    const res = await POST({
      request: makeRequest({ boardId: POST_ID }),
      params: { postId: POST_ID },
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
    expect(mockChangeBoard).not.toHaveBeenCalled()
  })

  it('propagates authentication failures without moving anything', async () => {
    const { UnauthorizedError } = await import('@/lib/shared/errors')
    mockWithApiKeyAuth.mockRejectedValue(
      new UnauthorizedError('API_UNAUTHORIZED', 'Invalid API key')
    )

    const res = await POST({
      request: makeRequest({ boardId: BOARD_ID }),
      params: { postId: POST_ID },
    })

    expect(res.status).toBe(401)
    expect(mockChangeBoard).not.toHaveBeenCalled()
  })

  it('propagates a missing permission without moving anything', async () => {
    const { ForbiddenError } = await import('@/lib/shared/errors')
    mockWithApiKeyAuth.mockRejectedValue(new ForbiddenError('FORBIDDEN', 'Missing permission'))

    const res = await POST({
      request: makeRequest({ boardId: BOARD_ID }),
      params: { postId: POST_ID },
    })

    expect(res.status).toBe(403)
    expect(mockChangeBoard).not.toHaveBeenCalled()
  })

  it.each(['POST_NOT_FOUND', 'BOARD_NOT_FOUND'])('returns 404 for %s', async (code) => {
    const { NotFoundError } = await import('@/lib/shared/errors')
    mockChangeBoard.mockRejectedValue(new NotFoundError(code, 'missing'))

    const res = await POST({
      request: makeRequest({ boardId: BOARD_ID }),
      params: { postId: POST_ID },
    })

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })
})
