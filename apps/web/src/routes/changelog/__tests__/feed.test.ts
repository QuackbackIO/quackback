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

const links = vi.hoisted(() => ({ changelogOrigin: 'https://t.example' }))
vi.mock('@/lib/server/domains/settings/section-links', () => ({
  getSectionOrigins: async () => ({
    primary: 'https://t.example',
    feedback: 'https://t.example',
    roadmap: 'https://t.example',
    changelog: links.changelogOrigin,
    help: 'https://t.example',
    support: 'https://t.example',
    status: 'https://t.example',
  }),
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
  categoryFilterCondition: () => undefined,
  getCategoriesForEntries: async () => new Map(),
}))

import { changelogEntries } from '@/lib/server/db'
import { getSettingsBrandingData } from '@/lib/server/settings-utils'
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
  links.changelogOrigin = 'https://t.example'
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

describe('changelog RSS feed links', () => {
  it("links the changelog and each entry at the changelog's own host", async () => {
    links.changelogOrigin = 'https://news.acme.com'
    const xml = await fetchFeed()
    expect(xml).toContain('<link>https://news.acme.com/</link>')
    expect(xml).toContain(`https://news.acme.com/changelog/${ENTRY_A}`)
    expect(xml).not.toContain('https://t.example')
  })
})

describe('changelog RSS feed escaping', () => {
  it('CHG-F-04 escapes XML-significant characters in titles, descriptions and the channel', async () => {
    const title = `Fix <b> & "quotes" 'apos'`
    const content = `1 < 2 & "q" 'a' > 0`
    vi.mocked(getSettingsBrandingData).mockResolvedValueOnce({
      name: `Tom & Jerry's <Co>`,
    } as Awaited<ReturnType<typeof getSettingsBrandingData>>)
    mockSelectLimit.mockResolvedValueOnce([{ ...entryRow(ENTRY_A), title, content }])

    const xml = await fetchFeed()

    expect(xml).toContain('<title>Fix &lt;b&gt; &amp; &quot;quotes&quot; &apos;apos&apos;</title>')
    expect(xml).toContain(
      '<description>1 &lt; 2 &amp; &quot;q&quot; &apos;a&apos; &gt; 0</description>'
    )
    expect(xml).toContain('<title>Tom &amp; Jerry&apos;s &lt;Co&gt; Changelog</title>')
    expect(xml).not.toContain(title)
    expect(xml).not.toContain(content)
  })
})

describe('changelog RSS feed descriptions', () => {
  const MARKDOWN = '## Heading\n\nSome **bold** and a [link](https://example.com).'

  it('CHG-F-05 describes an entry in plain text from its document, not markdown syntax', async () => {
    mockSelectLimit.mockResolvedValueOnce([
      {
        ...entryRow(ENTRY_A),
        content: MARKDOWN,
        contentJson: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Some ' },
                { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
                { type: 'text', text: ' and a ' },
                {
                  type: 'text',
                  text: 'link',
                  marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                },
                { type: 'text', text: '. 1 < 2 & 3' },
              ],
            },
          ],
        },
      },
    ])

    const xml = await fetchFeed()

    expect(xml).toContain(
      '<description>Heading Some bold and a link. 1 &lt; 2 &amp; 3</description>'
    )
  })

  it('CHG-F-05 strips markdown syntax when an entry has no document', async () => {
    mockSelectLimit.mockResolvedValueOnce([
      { ...entryRow(ENTRY_A), content: MARKDOWN, contentJson: null },
    ])

    const xml = await fetchFeed()

    expect(xml).toContain('<description>Heading Some bold and a link.</description>')
  })

  it('CHG-F-05 drops images and old HTML when an entry has no document', async () => {
    mockSelectLimit.mockResolvedValueOnce([
      {
        ...entryRow(ENTRY_A),
        content: '<p>Old <b>html</b></p> ![shot](https://x.test/a.png) done',
        contentJson: null,
      },
    ])

    const xml = await fetchFeed()

    expect(xml).toContain('<description>Old html done</description>')
  })
})
