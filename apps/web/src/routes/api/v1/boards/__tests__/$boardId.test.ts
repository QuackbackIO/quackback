/**
 * G2 regression: PATCH /api/v1/boards/:boardId must not accept audience.
 *
 * A member-role API key can call this endpoint. Before the fix, it accepted
 * an audience field and passed it to updateBoard — silently changing board
 * visibility without an audit event. After the fix, audience is stripped from
 * the input schema, so the PATCH only mutates name/slug/description.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWithApiKeyAuth = vi.fn()
const mockUpdateBoard = vi.fn()
const mockGetBoardById = vi.fn()
const mockDeleteBoard = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/boards/board.service', () => ({
  updateBoard: (...args: unknown[]) => mockUpdateBoard(...args),
  getBoardById: (...args: unknown[]) => mockGetBoardById(...args),
  deleteBoard: (...args: unknown[]) => mockDeleteBoard(...args),
  accessToAudience: (access: {
    view: string
    segments: { view: string[]; comment: string[]; submit: string[] }
  }) => {
    switch (access.view) {
      case 'anonymous':
        return { kind: 'public' }
      case 'authenticated':
        return { kind: 'authenticated' }
      case 'segments':
        return { kind: 'segments', segmentIds: access.segments.view }
      case 'team':
        return { kind: 'team' }
      default:
        return { kind: 'public' }
    }
  },
}))
vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: vi.fn((value: string) => value),
  parseOptionalTypeId: vi.fn((value: unknown) => value),
}))

import { Route } from '../$boardId'

type Handlers = {
  GET: (args: { request: Request; params: Record<string, string> }) => Promise<Response>
  PATCH: (args: { request: Request; params: Record<string, string> }) => Promise<Response>
  DELETE: (args: { request: Request; params: Record<string, string> }) => Promise<Response>
}
type RouteOpts = { server: { handlers: Handlers } }
const { GET, PATCH } = (Route as unknown as { options: RouteOpts }).options.server.handlers

const BOARD_ID = 'board_01jz1q2r3s4t5u6v7w8x9y0z1a'

const BASE_BOARD = {
  id: BOARD_ID,
  name: 'My Board',
  slug: 'my-board',
  description: null,
  access: {
    view: 'anonymous',
    vote: 'anonymous',
    comment: 'anonymous',
    submit: 'anonymous',
    segments: { view: [], vote: [], comment: [], submit: [] },
    moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
  },
  settings: {},
  createdAt: new Date(),
  updatedAt: new Date(),
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request(`http://test/api/v1/boards/${BOARD_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeGetRequest(): Request {
  return new Request(`http://test/api/v1/boards/${BOARD_ID}`, { method: 'GET' })
}

beforeEach(() => {
  mockWithApiKeyAuth.mockReset()
  mockUpdateBoard.mockReset()
  mockGetBoardById.mockReset()
  mockDeleteBoard.mockReset()
  mockWithApiKeyAuth.mockResolvedValue({ principalId: 'p_1', role: 'team' })
  mockUpdateBoard.mockResolvedValue(BASE_BOARD)
  mockGetBoardById.mockResolvedValue(BASE_BOARD)
})

describe('PATCH /api/v1/boards/:boardId — audience stripping (G2)', () => {
  it('does not forward audience to updateBoard even when supplied in body', async () => {
    const res = await PATCH({
      request: makeRequest({ name: 'New Name', audience: { kind: 'team' } }),
      params: { boardId: BOARD_ID },
    })
    expect(res.status).toBe(200)
    // updateBoard must have been called without an audience field
    expect(mockUpdateBoard).toHaveBeenCalledOnce()
    const [, inputArg] = mockUpdateBoard.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(inputArg).not.toHaveProperty('audience')
  })

  it('accepts name/slug/description without audience', async () => {
    const res = await PATCH({
      request: makeRequest({ name: 'Updated', slug: 'updated', description: 'desc' }),
      params: { boardId: BOARD_ID },
    })
    expect(res.status).toBe(200)
    const [, inputArg] = mockUpdateBoard.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(inputArg).toMatchObject({ name: 'Updated', slug: 'updated', description: 'desc' })
    expect(inputArg).not.toHaveProperty('audience')
  })

  it('returns 400 when body is completely invalid', async () => {
    const res = await PATCH({
      request: makeRequest({ name: '' }), // name fails min(1)
      params: { boardId: BOARD_ID },
    })
    expect(res.status).toBe(400)
    expect(mockUpdateBoard).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/boards/:boardId — still returns audience in response', () => {
  it('returns audience field in the response body', async () => {
    const res = await GET({
      request: makeGetRequest(),
      params: { boardId: BOARD_ID },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: typeof BASE_BOARD }
    expect(body.data).toHaveProperty('audience')
  })
})
