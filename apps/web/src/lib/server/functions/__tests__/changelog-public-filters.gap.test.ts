/**
 * Differential-coverage tests for applyWidgetChangelogFilters (exercised through
 * listPublicChangelogsFn) — the category/product filters, the selected_entries
 * mode, and the linked_to_allowed_feedback board/status filtering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data?: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []

const m = vi.hoisted(() => ({
  access: { granted: true },
  context: {} as Record<string, unknown>,
  listPublic: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {
      validator() {
        return chain
      },
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))
vi.mock('../portal-access', () => ({
  resolvePortalAccessForRequest: () => Promise.resolve(m.access),
}))
vi.mock('../auth-helpers', () => ({ requireAuth: vi.fn(), getOptionalAuth: vi.fn() }))
vi.mock('@/lib/server/widget/context', () => ({
  getWidgetRequestContext: () => Promise.resolve(m.context),
}))
vi.mock('@/lib/server/domains/changelog/changelog.public', () => ({
  getPublicChangelogById: vi.fn(),
  listPublicChangelogs: (...a: unknown[]) => m.listPublic(...a),
}))
vi.mock('@/lib/server/domains/changelog/changelog.query', () => ({
  listChangelogs: vi.fn(),
  listChangelogTaxonomy: vi.fn(),
  searchShippedPosts: vi.fn(),
}))
vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({
  createChangelog: vi.fn(),
  updateChangelog: vi.fn(),
  deleteChangelog: vi.fn(),
  getChangelogById: vi.fn(),
}))
vi.mock('@/lib/server/sanitize-tiptap', () => ({ sanitizeTiptapContent: (v: unknown) => v }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn() }) },
}))

await import('../changelog')
const listPublicChangelogsFn = handlers[6]

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'cl_1',
  publishedAt: new Date('2026-01-01T00:00:00Z'),
  category: { id: 'cat_1', slug: 'news' },
  product: { id: 'prod_1', slug: 'core' },
  linkedPosts: [{ boardId: 'b1', boardSlug: 'bugs', statusId: 'done' }],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.access = { granted: true }
})

describe('listPublicChangelogsFn → applyWidgetChangelogFilters', () => {
  it('returns an empty list when portal access is denied', async () => {
    m.access = { granted: false }
    const res = (await listPublicChangelogsFn({ data: { limit: 10 } })) as { items: unknown[] }
    expect(res.items).toEqual([])
  })

  it('applies category + product filters (keeps matching, drops non-matching)', async () => {
    m.context = {
      profileId: 'p1',
      contentFilters: {
        changelog: { mode: 'all_published', categoryIds: ['cat_1'], productIds: ['prod_1'] },
      },
    }
    m.listPublic.mockResolvedValueOnce({
      items: [entry(), entry({ id: 'cl_2', category: { id: 'other', slug: 'x' } })],
      nextCursor: null,
      hasMore: false,
    })
    const res = (await listPublicChangelogsFn({ data: { limit: 10 } })) as {
      items: Array<{ id: string }>
    }
    expect(res.items).toHaveLength(1)
    expect(res.items[0].id).toBe('cl_1')
  })

  it('keeps only selected entries in selected_entries mode', async () => {
    m.context = {
      profileId: 'p1',
      contentFilters: { changelog: { mode: 'selected_entries', entryIds: ['cl_1'] } },
    }
    m.listPublic.mockResolvedValueOnce({
      items: [entry(), entry({ id: 'cl_2' })],
      nextCursor: null,
      hasMore: false,
    })
    const res = (await listPublicChangelogsFn({ data: { limit: 10 } })) as {
      items: Array<{ id: string }>
    }
    expect(res.items).toHaveLength(1)
    expect(res.items[0].id).toBe('cl_1')
  })

  it('filters by linked-post board/status in linked_to_allowed_feedback mode', async () => {
    m.context = {
      profileId: 'p1',
      contentFilters: {
        changelog: { mode: 'linked_to_allowed_feedback' },
        feedback: { boardIds: ['b1'], statusIds: ['done'] },
      },
    }
    m.listPublic.mockResolvedValueOnce({
      items: [
        entry(),
        entry({ id: 'cl_2', linkedPosts: [{ boardId: 'nope', boardSlug: 'z', statusId: 'open' }] }),
      ],
      nextCursor: null,
      hasMore: false,
    })
    const res = (await listPublicChangelogsFn({ data: { limit: 10 } })) as {
      items: Array<{ id: string }>
    }
    expect(res.items).toHaveLength(1)
    expect(res.items[0].id).toBe('cl_1')
  })
})
