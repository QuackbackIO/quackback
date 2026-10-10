/**
 * The status RSS feed carries what a subscriber needs to know now: open
 * incidents and scheduled or in-progress maintenance alongside resolved
 * history, each titled with its current state, newest activity first. The
 * gate and the item query live in `listStatusFeedFn` (mocked here); this
 * pins the XML the route builds from its items.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listStatusFeedFn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/functions/status', () => ({ listStatusFeedFn }))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://acme.example.com' } }))
vi.mock('@/lib/server/settings-utils', () => ({
  getSettingsBrandingData: vi.fn().mockResolvedValue({ name: 'Acme' }),
}))

const { Route } = await import('../feed')

type Handler = () => Promise<Response>
const GET = (Route.options.server!.handlers as unknown as { GET: Handler }).GET

function item(overrides: Record<string, unknown>) {
  return {
    id: 'status_incident_1',
    kind: 'incident',
    title: 'API errors',
    status: 'investigating',
    impact: 'major',
    scheduledStartAt: null,
    scheduledEndAt: null,
    startedAt: '2026-10-10T09:00:00.000Z',
    resolvedAt: null,
    affectedComponents: [
      { id: 'status_component_1', name: 'API', componentStatus: 'partial_outage' },
    ],
    updates: [
      {
        id: 'status_update_1',
        status: 'investigating',
        body: 'Elevated error rates.',
        createdAt: '2026-10-10T09:00:00.000Z',
      },
    ],
    lastActivityAt: '2026-10-10T09:00:00.000Z',
    ...overrides,
  }
}

function itemsOf(xml: string) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) => ({
    title: /<title>([\s\S]*?)<\/title>/.exec(body)?.[1],
    description: /<description>([\s\S]*?)<\/description>/.exec(body)?.[1],
    guid: /<guid[^>]*>([\s\S]*?)<\/guid>/.exec(body)?.[1],
    pubDate: /<pubDate>([\s\S]*?)<\/pubDate>/.exec(body)?.[1],
  }))
}

beforeEach(() => listStatusFeedFn.mockReset())

describe('GET /status/feed', () => {
  it('lists open incidents and maintenance with their current state, in the given order', async () => {
    listStatusFeedFn.mockResolvedValue([
      item({}),
      item({
        id: 'status_incident_2',
        kind: 'maintenance',
        title: 'Database upgrade',
        status: 'scheduled',
        scheduledStartAt: '2026-10-12T02:00:00.000Z',
        scheduledEndAt: '2026-10-12T04:00:00.000Z',
        affectedComponents: [],
        updates: [
          {
            id: 'status_update_2',
            status: 'scheduled',
            body: 'Writes pause briefly.',
            createdAt: '2026-10-09T12:00:00.000Z',
          },
        ],
        lastActivityAt: '2026-10-09T12:00:00.000Z',
      }),
      item({
        id: 'status_incident_3',
        title: 'Login delays',
        status: 'resolved',
        resolvedAt: '2026-10-01T10:00:00.000Z',
        updates: [
          {
            id: 'status_update_3',
            status: 'resolved',
            body: 'Fixed.',
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        ],
        lastActivityAt: '2026-10-01T10:00:00.000Z',
      }),
    ])

    const res = await GET()
    expect(res.headers.get('content-type')).toContain('application/rss+xml')
    const xml = await res.text()
    expect(listStatusFeedFn).toHaveBeenCalledWith({ data: { limit: 50 } })

    const items = itemsOf(xml)
    expect(items.map((i) => i.title)).toEqual([
      'API errors (Investigating)',
      'Maintenance: Database upgrade (Scheduled)',
      'Login delays (Resolved)',
    ])
    expect(items[0].description).toBe('Investigating: Elevated error rates. · Affected: API')
    expect(items[1].description).toBe(
      'Scheduled: Writes pause briefly. · Window: October 12, 2026 at 02:00 UTC to October 12, 2026 at 04:00 UTC'
    )
    expect(items[1].pubDate).toBe('Fri, 09 Oct 2026 12:00:00 GMT')
    // Each update is a new item for a reader, so a resolution is not missed.
    expect(items[0].guid).toBe('https://acme.example.com/status/status_incident_1#status_update_1')
    expect(xml).toContain('<lastBuildDate>Sat, 10 Oct 2026 09:00:00 GMT</lastBuildDate>')
  })

  it('escapes markup in titles and bodies', async () => {
    listStatusFeedFn.mockResolvedValue([item({ title: 'A & B <outage>' })])
    const xml = await (await GET()).text()
    expect(xml).toContain('<title>A &amp; B &lt;outage&gt; (Investigating)</title>')
  })

  it('keeps text in a plain-text body that looks like markup', async () => {
    // Bodies are plain text: what the admin typed is what the page shows.
    listStatusFeedFn.mockResolvedValue([
      item({
        updates: [
          {
            id: 'status_update_1',
            status: 'investigating',
            body: 'Calls to <b>v2</b> fail',
            createdAt: '2026-10-10T09:00:00.000Z',
          },
        ],
      }),
    ])
    const xml = await (await GET()).text()
    expect(itemsOf(xml)[0].description).toContain('Calls to &lt;b&gt;v2&lt;/b&gt; fail')
  })

  it('still returns a valid, empty feed when the page is gated out', async () => {
    listStatusFeedFn.mockResolvedValue([])
    const xml = await (await GET()).text()
    expect(xml).toContain('<rss version="2.0"')
    expect(itemsOf(xml)).toEqual([])
  })
})
