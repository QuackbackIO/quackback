import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizeCannyExport } from '../canny/adapter'
import { parseCsvCamelCase } from '../camel-case-csv'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

describe('normalizeCannyExport', () => {
  it('fetches boards/posts/votes and builds the canonical CSV + real voter map', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}

      if (path === '/api/v1/boards/list') {
        return jsonResponse({ boards: [{ id: 'board_1', name: 'Feature Requests' }] })
      }
      if (path === '/api/v1/posts/list') {
        if ((body.skip as number) > 0) return jsonResponse({ posts: [], hasMore: false })
        return jsonResponse({
          posts: [
            {
              id: 'post_1',
              title: 'Dark mode',
              details: 'Please add it',
              status: 'under review',
              score: 3,
              created: '2026-01-01T00:00:00.000Z',
              board: { id: 'board_1', name: 'Feature Requests' },
              category: null,
              tags: [{ id: 'tag_1', name: 'ui' }],
              author: { id: 'a1', email: 'alice@example.com', name: 'Alice', isAdmin: false },
              imageURLs: [],
            },
          ],
          hasMore: false,
        })
      }
      if (path === '/api/v1/votes/list') {
        if ((body.skip as number) > 0) return jsonResponse({ votes: [], hasMore: false })
        return jsonResponse({
          votes: [
            {
              id: 'vote_1',
              post: { id: 'post_1' },
              voter: { id: 'a1', email: 'alice@example.com', name: 'Alice', isAdmin: false },
              created: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'vote_2',
              post: { id: 'post_1' },
              voter: { id: 'b1', email: 'bob@example.com', name: 'Bob', isAdmin: false },
              created: '2026-01-02T00:00:00.000Z',
            },
          ],
          hasMore: false,
        })
      }
      return Promise.reject(new Error(`Unexpected Canny call: ${path}`))
    })

    const result = await normalizeCannyExport({ apiKey: 'test-key', delayMs: 0 })

    const { rows } = parseCsvCamelCase(result.csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      title: 'Dark mode',
      content: 'Please add it',
      board: 'Feature Requests',
      status: 'Under Review',
      tags: 'ui',
      authorEmail: 'alice@example.com',
      sourceId: 'post_1',
    })

    expect(result.voters['post_1']).toHaveLength(2)
    expect(result.voters['post_1'].map((v) => v.email).sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
    ])
    expect(result.caveats).toEqual([])
  })
})
