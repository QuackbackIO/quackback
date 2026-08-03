import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  principalFindFirstMock: vi.fn(),
  listChangelogsMock: vi.fn(),
  createChangelogMock: vi.fn(),
  getChangelogByIdMock: vi.fn(),
  updateChangelogMock: vi.fn(),
  deleteChangelogMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => hoisted.withApiKeyAuthMock(...args),
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      principal: {
        findFirst: (...args: unknown[]) => hoisted.principalFindFirstMock(...args),
      },
    },
  },
  principal: { id: 'principal.id' },
  eq: vi.fn((column, value) => ({ kind: 'eq', column, value })),
}))

vi.mock('@/lib/server/domains/changelog/changelog.query', () => ({
  listChangelogs: (...args: unknown[]) => hoisted.listChangelogsMock(...args),
}))

vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({
  createChangelog: (...args: unknown[]) => hoisted.createChangelogMock(...args),
  getChangelogById: (...args: unknown[]) => hoisted.getChangelogByIdMock(...args),
  updateChangelog: (...args: unknown[]) => hoisted.updateChangelogMock(...args),
  deleteChangelog: (...args: unknown[]) => hoisted.deleteChangelogMock(...args),
}))

import { Route as DetailRoute } from '../$entryId'
import { Route as IndexRoute } from '../index'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const indexHandlers = (IndexRoute as unknown as RouteWithHandlers).options.server.handlers
const detailHandlers = (DetailRoute as unknown as RouteWithHandlers).options.server.handlers

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  params: Record<string, string> = {},
  request = new Request('http://test/api/v1/changelog')
) {
  return { request, params }
}

async function json(response: Response) {
  return response.json() as Promise<{ data: unknown; meta?: unknown }>
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'changelog_entry_123',
    title: 'Release notes',
    content: 'Shipped the thing',
    contentJson: null,
    principalId: 'principal_admin',
    categoryId: 'cat_release',
    productId: 'prod_web',
    publishedAt: new Date('2026-01-02T10:00:00.000Z'),
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    updatedAt: new Date('2026-01-01T11:00:00.000Z'),
    author: { id: 'principal_admin', name: 'Ada', avatarUrl: null },
    category: { id: 'cat_release', name: 'Release', slug: 'release', color: '#123456' },
    product: { id: 'prod_web', name: 'Web', slug: 'web' },
    linkedPosts: [],
    status: 'published',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: 'principal_admin',
    role: 'team',
  })
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
  hoisted.principalFindFirstMock.mockResolvedValue({ displayName: 'Ada Admin' })
  hoisted.listChangelogsMock.mockResolvedValue({
    items: [],
    nextCursor: null,
    hasMore: false,
  })
  hoisted.createChangelogMock.mockResolvedValue(entry())
  hoisted.getChangelogByIdMock.mockResolvedValue(entry())
  hoisted.updateChangelogMock.mockResolvedValue(entry())
  hoisted.deleteChangelogMock.mockResolvedValue(undefined)
})

describe('/api/v1/changelog', () => {
  it('lists changelog entries and maps published query filters to domain statuses', async () => {
    const listedEntry = entry()
    hoisted.listChangelogsMock.mockResolvedValue({
      items: [listedEntry],
      nextCursor: 'changelog_entry_next',
      hasMore: true,
    })

    const publishedResponse = await indexHandlers.GET(
      args({}, new Request('http://test/api/v1/changelog?published=true&cursor=abc&limit=200'))
    )
    expect(publishedResponse.status).toBe(200)
    expect(hoisted.listChangelogsMock).toHaveBeenCalledWith({
      status: 'published',
      cursor: 'abc',
      limit: 100,
    })
    const publishedJson = await json(publishedResponse)
    expect(publishedJson.data).toEqual([
      {
        id: listedEntry.id,
        title: listedEntry.title,
        content: listedEntry.content,
        category: listedEntry.category,
        product: listedEntry.product,
        publishedAt: '2026-01-02T10:00:00.000Z',
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-01T11:00:00.000Z',
      },
    ])
    expect(publishedJson.meta).toEqual({
      pagination: { cursor: 'changelog_entry_next', hasMore: true },
    })

    await indexHandlers.GET(args({}, new Request('http://test/api/v1/changelog?published=false')))
    expect(hoisted.listChangelogsMock).toHaveBeenLastCalledWith({
      status: 'draft',
      cursor: undefined,
      limit: 20,
    })

    await indexHandlers.GET(args({}, new Request('http://test/api/v1/changelog')))
    expect(hoisted.listChangelogsMock).toHaveBeenLastCalledWith({
      status: 'all',
      cursor: undefined,
      limit: 20,
    })
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
  })

  it('creates a changelog entry with author display name, taxonomy names, publish state, and linked posts', async () => {
    const response = await indexHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/changelog', 'POST', {
          title: '  Launch  ',
          content: 'Details',
          publishedAt: '2026-01-02T10:00:00.000Z',
          categoryName: 'Release',
          productName: 'Web',
          linkedPostIds: ['post_1', 'post_2'],
        })
      )
    )

    expect(response.status).toBe(201)
    expect(hoisted.createChangelogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '  Launch  ',
        content: 'Details',
        categoryName: 'Release',
        productName: 'Web',
        linkedPostIds: ['post_1', 'post_2'],
        publishState: expect.objectContaining({ type: expect.any(String) }),
      }),
      { principalId: 'principal_admin', name: 'Ada Admin' }
    )
    expect((await json(response)).data).toMatchObject({
      id: 'changelog_entry_123',
      publishedAt: '2026-01-02T10:00:00.000Z',
    })
  })

  it('uses API as the fallback author name and rejects invalid create bodies before DB lookup', async () => {
    hoisted.principalFindFirstMock.mockResolvedValueOnce(null)
    await indexHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/changelog', 'POST', {
          title: 'Launch',
          content: 'Details',
        })
      )
    )
    expect(hoisted.createChangelogMock).toHaveBeenCalledWith(expect.any(Object), {
      principalId: 'principal_admin',
      name: 'API',
    })

    vi.clearAllMocks()
    hoisted.withApiKeyAuthMock.mockResolvedValue({ principalId: 'principal_admin', role: 'team' })
    const invalidResponse = await indexHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/changelog', 'POST', { title: '', content: '' }))
    )

    expect(invalidResponse.status).toBe(400)
    expect(hoisted.principalFindFirstMock).not.toHaveBeenCalled()
    expect(hoisted.createChangelogMock).not.toHaveBeenCalled()
  })
})

describe('/api/v1/changelog/:entryId', () => {
  it('gets and deletes a changelog entry with parsed TypeIDs', async () => {
    hoisted.parseTypeIdMock.mockReturnValue('changelog_entry_123')

    const getResponse = await detailHandlers.GET(
      args(
        { entryId: 'changelog_entry_123' },
        new Request('http://test/api/v1/changelog/changelog_entry_123')
      )
    )
    expect(getResponse.status).toBe(200)
    expect(hoisted.getChangelogByIdMock).toHaveBeenCalledWith('changelog_entry_123')
    expect((await json(getResponse)).data).toMatchObject({
      id: 'changelog_entry_123',
      category: expect.any(Object),
      product: expect.any(Object),
    })

    const deleteResponse = await detailHandlers.DELETE(
      args(
        { entryId: 'changelog_entry_123' },
        new Request('http://test/api/v1/changelog/changelog_entry_123')
      )
    )
    expect(deleteResponse.status).toBe(204)
    expect(hoisted.deleteChangelogMock).toHaveBeenCalledWith('changelog_entry_123')
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(
      'changelog_entry_123',
      'changelog',
      'changelog entry ID'
    )
  })

  it('serializes changelog entries without taxonomy or publish date as nulls', async () => {
    hoisted.getChangelogByIdMock.mockResolvedValueOnce(
      entry({ category: null, product: null, publishedAt: null })
    )

    const response = await detailHandlers.GET(
      args(
        { entryId: 'changelog_entry_123' },
        new Request('http://test/api/v1/changelog/changelog_entry_123')
      )
    )

    expect(response.status).toBe(200)
    expect((await json(response)).data).toMatchObject({
      category: null,
      product: null,
      publishedAt: null,
    })
  })

  it('patches title/content/taxonomy and converts publishedAt into draft, scheduled, and published states', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'))
    hoisted.parseTypeIdMock.mockReturnValue('changelog_entry_123')

    try {
      const draftResponse = await detailHandlers.PATCH(
        args(
          { entryId: 'changelog_entry_123' },
          jsonRequest('http://test/api/v1/changelog/changelog_entry_123', 'PATCH', {
            title: 'Draft title',
            content: 'Draft content',
            categoryName: null,
            productName: null,
            publishedAt: null,
          })
        )
      )
      expect(draftResponse.status).toBe(200)
      expect(hoisted.updateChangelogMock).toHaveBeenLastCalledWith(
        'changelog_entry_123',
        expect.objectContaining({
          title: 'Draft title',
          content: 'Draft content',
          categoryName: null,
          productName: null,
          publishState: { type: 'draft' },
        })
      )

      await detailHandlers.PATCH(
        args(
          { entryId: 'changelog_entry_123' },
          jsonRequest('http://test/api/v1/changelog/changelog_entry_123', 'PATCH', {
            publishedAt: '2026-01-02T10:00:00.000Z',
          })
        )
      )
      expect(hoisted.updateChangelogMock).toHaveBeenLastCalledWith(
        'changelog_entry_123',
        expect.objectContaining({
          publishState: {
            type: 'scheduled',
            publishAt: new Date('2026-01-02T10:00:00.000Z'),
          },
        })
      )

      await detailHandlers.PATCH(
        args(
          { entryId: 'changelog_entry_123' },
          jsonRequest('http://test/api/v1/changelog/changelog_entry_123', 'PATCH', {
            publishedAt: '2025-12-31T10:00:00.000Z',
          })
        )
      )
      expect(hoisted.updateChangelogMock).toHaveBeenLastCalledWith(
        'changelog_entry_123',
        expect.objectContaining({
          publishState: {
            type: 'published',
            publishAt: new Date('2025-12-31T10:00:00.000Z'),
          },
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects invalid patch bodies before mutating', async () => {
    const response = await detailHandlers.PATCH(
      args(
        { entryId: 'changelog_entry_123' },
        jsonRequest('http://test/api/v1/changelog/changelog_entry_123', 'PATCH', {
          title: '',
          publishedAt: 'not-a-date',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.updateChangelogMock).not.toHaveBeenCalled()
  })
})
