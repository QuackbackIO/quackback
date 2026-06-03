/**
 * G3 regression: POST /api/v1/boards must not accept `audience`.
 *
 * A member-role API key can call this endpoint. If the create schema
 * accepted an `audience` field, that key could silently spin up a board
 * with restricted visibility (or, worse, `{kind:'segments', segmentIds:[]}`
 * — a board no audience could see) without an audit row. Visibility lives
 * with the admin-only updateBoardAccessFn (and emits `board.access.changed`);
 * the REST create path must default to all-anonymous access and refuse to
 * influence visibility.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWithApiKeyAuth = vi.fn()
const mockCreateBoard = vi.fn()
const mockListBoardsWithDetails = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/boards/board.service', () => ({
  createBoard: (...args: unknown[]) => mockCreateBoard(...args),
  listBoardsWithDetails: (...args: unknown[]) => mockListBoardsWithDetails(...args),
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

import { Route } from '../index'

type Handlers = {
  GET: (args: { request: Request }) => Promise<Response>
  POST: (args: { request: Request }) => Promise<Response>
}
type RouteOpts = { server: { handlers: Handlers } }
const { POST } = (Route as unknown as { options: RouteOpts }).options.server.handlers

const CREATED_BOARD = {
  id: 'board_01jz1q2r3s4t5u6v7w8x9y0z1a',
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
  createdAt: new Date(),
  updatedAt: new Date(),
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://test/api/v1/boards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockWithApiKeyAuth.mockReset()
  mockCreateBoard.mockReset()
  mockWithApiKeyAuth.mockResolvedValue({ principalId: 'p_1', role: 'team' })
  mockCreateBoard.mockResolvedValue(CREATED_BOARD)
})

describe('POST /api/v1/boards — audience stripping (G3)', () => {
  it('does not forward audience to createBoard even when supplied in body', async () => {
    const res = await POST({
      request: makeRequest({
        name: 'Internal Roadmap',
      }),
    })

    expect(res.status).toBe(201)
    expect(mockCreateBoard).toHaveBeenCalledTimes(1)
    const args = mockCreateBoard.mock.calls[0][0] as Record<string, unknown>
    expect(args).not.toHaveProperty('audience')
    expect(args).toMatchObject({ name: 'Internal Roadmap' })
  })

  it('does not forward audience even when the value is `{kind:"team"}`', async () => {
    const res = await POST({
      request: makeRequest({ name: 'Hidden Board', audience: { kind: 'team' } }),
    })

    expect(res.status).toBe(201)
    const args = mockCreateBoard.mock.calls[0][0] as Record<string, unknown>
    expect(args).not.toHaveProperty('audience')
  })

  it('still forwards name, slug, description', async () => {
    const res = await POST({
      request: makeRequest({
        name: 'My Board',
        slug: 'my-board',
        description: 'Submit ideas',
      }),
    })

    expect(res.status).toBe(201)
    expect(mockCreateBoard).toHaveBeenCalledWith({
      name: 'My Board',
      slug: 'my-board',
      description: 'Submit ideas',
    })
  })
})
