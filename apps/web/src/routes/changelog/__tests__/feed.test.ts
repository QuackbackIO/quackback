/**
 * RSS feed: label output and the `?label=` filter, plus the gates that already
 * guarded the feed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChangelogId } from '@quackback/ids'

const mockSelectLimit = vi.fn()
const mockCategoryFilterCondition = vi.fn()
const mockGetCategoriesForEntries = vi.fn()
const mockIsFeatureEnabled = vi.fn(async (..._args: unknown[]) => true)
const mockResolvePortalAccess = vi.fn(async (..._args: unknown[]) => ({ granted: true }))
const mockAudienceGranted = vi.fn(async (..._args: unknown[]) => true)

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://t.example' },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: (...args: unknown[]) => mockSelectLimit(...args),
          }),
        }),
      }),
    }),
  },
}))

vi.mock('@/lib/server/domains/changelog/changelog.public', () => ({
  publicChangelogConditions: vi.fn(() => []),
}))

vi.mock('@/lib/server/settings-utils', () => ({
  getSettingsBrandingData: vi.fn(async () => ({ name: 'Acme' })),
}))

vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: (...args: unknown[]) => mockResolvePortalAccess(...args),
}))

vi.mock('@/lib/server/domains/changelog/changelog.audience', () => ({
  isChangelogAudienceGranted: (...args: unknown[]) => mockAudienceGranted(...args),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: vi.fn(async () => null),
  policyActorFromAuth: vi.fn(async () => ({ principalType: 'anonymous' })),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}))

vi.mock('@/lib/server/domains/changelog/changelog-category.service', () => ({
  categoryFilterCondition: (...args: unknown[]) => mockCategoryFilterCondition(...args),
  getCategoriesForEntries: (...args: unknown[]) => mockGetCategoriesForEntries(...args),
}))

import { Route } from '../feed'

type Handlers = { GET: (args: { request: Request }) => Promise<Response> }
type RouteOpts = { server: { handlers: Handlers } }
const { GET } = (Route as unknown as { options: RouteOpts }).options.server.handlers

const ENTRY_A = 'changelog_01a' as unknown as ChangelogId

function entryRow(id: ChangelogId, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Entry ${id}`,
    content: 'Body text',
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    displayDate: null,
    ...overrides,
  }
}

function category(name: string, segmentIds: string[] = []) {
  return { id: `changelog_category_${name}`, name, color: '#000000', segmentIds }
}

async function fetchFeed(url = 'https://t.example/changelog/feed'): Promise<string> {
  const res = await GET({ request: new Request(url) })
  return res.text()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockResolvePortalAccess.mockResolvedValue({ granted: true })
  mockAudienceGranted.mockResolvedValue(true)
  mockCategoryFilterCondition.mockReturnValue(undefined)
  mockGetCategoriesForEntries.mockResolvedValue(new Map())
})

describe('changelog RSS feed — labels', () => {
  it('renders one <category> element per label', async () => {
    mockSelectLimit.mockResolvedValue([entryRow(ENTRY_A)])
    mockGetCategoriesForEntries.mockResolvedValue(
      new Map([[ENTRY_A, [category('releases'), category('fixes')]]])
    )

    const xml = await fetchFeed()

    expect(xml).toContain('<category>releases</category>')
    expect(xml).toContain('<category>fixes</category>')
  })

  it('emits no <category> elements for an unlabelled entry', async () => {
    mockSelectLimit.mockResolvedValue([entryRow(ENTRY_A)])

    const xml = await fetchFeed()

    expect(xml).toContain('<item>')
    expect(xml).not.toContain('<category>')
  })

  it('escapes label names so a crafted label cannot break the XML', async () => {
    mockSelectLimit.mockResolvedValue([entryRow(ENTRY_A)])
    mockGetCategoriesForEntries.mockResolvedValue(
      new Map([[ENTRY_A, [category('a & b </category><script>')]]])
    )

    const xml = await fetchFeed()

    expect(xml).toContain('<category>a &amp; b &lt;/category&gt;&lt;script&gt;</category>')
    expect(xml).not.toContain('<script>')
  })

  it('passes ?label= through to the filter, comma-separated or repeated', async () => {
    mockSelectLimit.mockResolvedValue([])

    await fetchFeed('https://t.example/changelog/feed?label=releases,fixes')
    expect(mockCategoryFilterCondition).toHaveBeenCalledWith({
      categories: ['releases', 'fixes'],
    })

    mockCategoryFilterCondition.mockClear()
    await fetchFeed('https://t.example/changelog/feed?label=releases&label=fixes')
    expect(mockCategoryFilterCondition).toHaveBeenCalledWith({
      categories: ['releases', 'fixes'],
    })
  })

  it('treats a blank ?label= as no filter rather than an empty-name match', async () => {
    mockSelectLimit.mockResolvedValue([])

    await fetchFeed('https://t.example/changelog/feed?label=%20,')

    expect(mockCategoryFilterCondition).toHaveBeenCalledWith({ categories: undefined })
  })
})

describe('changelog RSS feed — existing gates still hold', () => {
  it('returns an empty feed when the changelog product is disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockSelectLimit.mockResolvedValue([entryRow(ENTRY_A)])

    const xml = await fetchFeed()

    expect(xml).not.toContain('<item>')
    expect(xml).toContain('<channel>')
  })

  it('returns an empty feed when portal access is denied', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false })
    mockSelectLimit.mockResolvedValue([entryRow(ENTRY_A)])

    const xml = await fetchFeed()

    expect(xml).not.toContain('<item>')
  })

  it('returns an empty feed when the audience gate denies anonymous viewers', async () => {
    mockAudienceGranted.mockResolvedValue(false)
    mockSelectLimit.mockResolvedValue([entryRow(ENTRY_A)])

    const xml = await fetchFeed()

    expect(xml).not.toContain('<item>')
  })
})
