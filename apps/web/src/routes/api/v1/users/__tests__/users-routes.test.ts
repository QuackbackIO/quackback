/**
 * GET /api/v1/users and GET /api/v1/users/:principalId: input handling and
 * error copy. The service layer is mocked; these pin what the routes hand it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateId } from '@quackback/ids'
import { encodeCursor } from '@/lib/server/domains/api/responses'

const mockListPortalUsers = vi.fn()
const mockGetPortalUserDetail = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: vi.fn(async () => ({ role: 'admin' })),
}))
vi.mock('@/lib/server/domains/users/user.service', () => ({
  listPortalUsers: (...args: unknown[]) => mockListPortalUsers(...args),
}))
vi.mock('@/lib/server/domains/users/user.detail', () => ({
  getPortalUserDetail: (...args: unknown[]) => mockGetPortalUserDetail(...args),
}))

import { Route as ListRoute } from '../index'
import { Route as DetailRoute } from '../$principalId'

type Get = (args: { request: Request; params?: Record<string, string> }) => Promise<Response>
const handlers = (route: unknown) =>
  (route as { options: { server: { handlers: { GET: Get } } } }).options.server.handlers

const list = (query: string) =>
  handlers(ListRoute).GET({ request: new Request(`http://test/api/v1/users${query}`) })

beforeEach(() => {
  vi.clearAllMocks()
  mockListPortalUsers.mockResolvedValue({ items: [], total: 0, hasMore: false })
})

describe('GET /api/v1/users', () => {
  it('refuses a malformed segmentIds filter with a 400 before querying', async () => {
    const res = await list(`?segmentIds=${generateId('segment')},not-an-id`)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid segment IDs format',
    })
    expect(mockListPortalUsers).not.toHaveBeenCalled()
  })

  it('passes well-formed segmentIds through', async () => {
    const segmentId = generateId('segment')
    await list(`?segmentIds=${segmentId}`)
    expect(mockListPortalUsers).toHaveBeenCalledWith(
      expect.objectContaining({ segmentIds: [segmentId] })
    )
  })

  it('continues from the cursor row offset whatever the new limit', async () => {
    mockListPortalUsers.mockResolvedValue({
      items: [{}, {}, {}].map(() => ({
        principalId: generateId('principal'),
        joinedAt: new Date(),
        metadata: null,
      })),
      total: 6,
      hasMore: true,
    })

    const res = await list(`?limit=3&cursor=${encodeCursor(2)}`)

    expect(mockListPortalUsers).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 2, limit: 3 })
    )
    expect((await res.json()).meta.pagination.cursor).toBe(encodeCursor(5))
  })
})

describe('GET /api/v1/users/:principalId', () => {
  it('says "Portal user not found" for an unknown principal', async () => {
    mockGetPortalUserDetail.mockResolvedValue(null)

    const res = await handlers(DetailRoute).GET({
      request: new Request('http://test/api/v1/users/x'),
      params: { principalId: generateId('principal') },
    })

    expect(res.status).toBe(404)
    expect((await res.json()).error).toEqual({
      code: 'NOT_FOUND',
      message: 'Portal user not found',
    })
  })
})
