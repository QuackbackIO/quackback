/**
 * RSS feed: the category segment gate, plus the portal/audience/product gates
 * that already guarded it.
 *
 * The portal list and detail readers run the category gate, but the feed did
 * not — so an entry restricted to a segment was still readable by anyone who
 * fetched the RSS URL. These tests pin that hole shut.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChangelogId } from '@quackback/ids'

const GATE = { __gate: true }
const PUBLIC_CONDITION = { __public: true }
const ANONYMOUS = { principalType: 'anonymous' }

const mockSelectLimit = vi.fn()
const mockWhere = vi.fn()
const mockCategoryGateCondition = vi.fn((..._args: unknown[]) => GATE)
const mockIsFeatureEnabled = vi.fn(async (..._args: unknown[]) => true)
const mockResolvePortalAccess = vi.fn(async (..._args: unknown[]) => ({ granted: true }))
const mockAudienceGranted = vi.fn(async (..._args: unknown[]) => true)
const mockPolicyActorFromAuth = vi.fn(async (..._args: unknown[]): Promise<unknown> => ANONYMOUS)

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://t.example' },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  db: {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          mockWhere(condition)
          return {
            orderBy: () => ({
              limit: (...args: unknown[]) => mockSelectLimit(...args),
            }),
          }
        },
      }),
    }),
  },
}))

vi.mock('@/lib/server/domains/changelog/changelog.public', () => ({
  publicChangelogConditions: vi.fn(() => [PUBLIC_CONDITION]),
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
  policyActorFromAuth: (...args: unknown[]) => mockPolicyActorFromAuth(...args),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}))

vi.mock('@/lib/server/domains/changelog/changelog-category.service', () => ({
  categoryGateCondition: (...args: unknown[]) => mockCategoryGateCondition(...args),
}))

import { changelogEntries } from '@/lib/server/db'
import { Route } from '../feed'

type Handlers = { GET: (args: { request: Request }) => Promise<Response> }
type RouteOpts = { server: { handlers: Handlers } }
const { GET } = (Route as unknown as { options: RouteOpts }).options.server.handlers

const ENTRY_A = 'changelog_01a' as unknown as ChangelogId

function entryRow(id: ChangelogId) {
  return {
    id,
    title: `Entry ${id}`,
    content: 'Body text',
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    displayDate: null,
  }
}

async function fetchFeed(): Promise<string> {
  const res = await GET({ request: new Request('https://t.example/changelog/feed') })
  return res.text()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockResolvePortalAccess.mockResolvedValue({ granted: true })
  mockAudienceGranted.mockResolvedValue(true)
  mockPolicyActorFromAuth.mockResolvedValue(ANONYMOUS)
  mockSelectLimit.mockResolvedValue([entryRow(ENTRY_A)])
})

describe('changelog RSS feed — segment gate', () => {
  it('applies the category segment gate to the feed query', async () => {
    await fetchFeed()

    expect(mockWhere).toHaveBeenCalledTimes(1)
    expect(mockWhere).toHaveBeenCalledWith({ and: [PUBLIC_CONDITION, GATE] })
  })

  it('gates on the requesting actor and the entry id column', async () => {
    const member = { principalType: 'user', segmentIds: ['segment_vip'] }
    mockPolicyActorFromAuth.mockResolvedValue(member)

    await fetchFeed()

    expect(mockCategoryGateCondition).toHaveBeenCalledWith(member, changelogEntries.id)
  })

  it('gates anonymous fetchers as the anonymous actor', async () => {
    await fetchFeed()

    expect(mockCategoryGateCondition).toHaveBeenCalledWith(ANONYMOUS, changelogEntries.id)
  })

  it('renders the entries the gated query returns', async () => {
    const xml = await fetchFeed()

    expect(xml).toContain(`<title>Entry ${ENTRY_A}</title>`)
  })
})

describe('changelog RSS feed — existing gates still hold', () => {
  it('returns an empty feed when the changelog product is disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    const xml = await fetchFeed()

    expect(xml).not.toContain('<item>')
    expect(xml).toContain('<channel>')
    expect(mockWhere).not.toHaveBeenCalled()
  })

  it('returns an empty feed when portal access is denied', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false })

    const xml = await fetchFeed()

    expect(xml).not.toContain('<item>')
    expect(mockWhere).not.toHaveBeenCalled()
  })

  it('returns an empty feed when the audience gate denies the viewer', async () => {
    mockAudienceGranted.mockResolvedValue(false)

    const xml = await fetchFeed()

    expect(xml).not.toContain('<item>')
    expect(mockWhere).not.toHaveBeenCalled()
  })
})
