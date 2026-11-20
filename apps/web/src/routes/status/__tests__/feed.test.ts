/**
 * The status RSS feed carries what a subscriber needs to know now: every
 * update of open incidents and scheduled or in-progress maintenance alongside
 * resolved history, one item per update, newest first. The gate and the item
 * query live in `listStatusFeedFn` (mocked here); this pins the XML the route
 * builds from its items.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listStatusFeedFn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/functions/status', () => ({ listStatusFeedFn }))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://acme.example.com' } }))
const links = vi.hoisted(() => ({ statusOrigin: 'https://acme.example.com' }))
vi.mock('@/lib/server/domains/settings/section-links', () => ({
  getSectionOrigins: async () => ({
    primary: 'https://acme.example.com',
    feedback: 'https://acme.example.com',
    roadmap: 'https://acme.example.com',
    changelog: 'https://acme.example.com',
    help: 'https://acme.example.com',
    support: 'https://acme.example.com',
    status: links.statusOrigin,
  }),
}))
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
    // No edit of its details since it was created.
    detailsEditedAt: null,
    ...overrides,
  }
}

/** What a feed reader does with a description: decode the XML, then read the
 *  result as HTML. Returns that HTML, with the tags it would render. */
function descriptionHtml(xmlDescription: string | undefined) {
  return (xmlDescription ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function itemsOf(xml: string) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) => ({
    title: /<title>([\s\S]*?)<\/title>/.exec(body)?.[1],
    description: /<description>([\s\S]*?)<\/description>/.exec(body)?.[1],
    guid: /<guid[^>]*>([\s\S]*?)<\/guid>/.exec(body)?.[1],
    pubDate: /<pubDate>([\s\S]*?)<\/pubDate>/.exec(body)?.[1],
  }))
}

beforeEach(() => {
  listStatusFeedFn.mockReset()
  links.statusOrigin = 'https://acme.example.com'
})

describe('GET /status/feed', () => {
  it('gives every update its own item, newest first, so none is missed between polls', async () => {
    listStatusFeedFn.mockResolvedValue([
      item({
        status: 'monitoring',
        updates: [
          {
            id: 'status_update_1',
            status: 'investigating',
            body: 'Elevated error rates.',
            createdAt: '2026-10-10T09:00:00.000Z',
          },
          {
            id: 'status_update_2',
            status: 'identified',
            body: 'Root cause found.',
            createdAt: '2026-10-10T09:30:00.000Z',
          },
          {
            id: 'status_update_3',
            status: 'monitoring',
            body: 'Fix deployed.',
            createdAt: '2026-10-10T10:00:00.000Z',
          },
        ],
      }),
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
            id: 'status_update_4',
            status: 'scheduled',
            body: 'Writes pause briefly.',
            createdAt: '2026-10-09T12:00:00.000Z',
          },
        ],
      }),
      item({
        id: 'status_incident_3',
        title: 'Login delays',
        status: 'resolved',
        resolvedAt: '2026-10-01T10:00:00.000Z',
        updates: [
          {
            id: 'status_update_5',
            status: 'resolved',
            body: 'Fixed.',
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        ],
      }),
    ])

    const res = await GET()
    expect(res.headers.get('content-type')).toContain('application/rss+xml')
    const xml = await res.text()
    expect(listStatusFeedFn).toHaveBeenCalledWith({ data: { limit: 50 } })

    const items = itemsOf(xml)
    // Each item names the incident and the status that update set.
    expect(items.map((i) => i.title)).toEqual([
      'API errors (Monitoring)',
      'API errors (Identified)',
      'API errors (Investigating)',
      'Maintenance: Database upgrade (Scheduled)',
      'Login delays (Resolved)',
    ])
    expect(items.map((i) => i.guid)).toEqual([
      'https://acme.example.com/status/status_incident_1#status_update_3',
      'https://acme.example.com/status/status_incident_1#status_update_2',
      'https://acme.example.com/status/status_incident_1#status_update_1',
      'https://acme.example.com/status/status_incident_2#status_update_4',
      'https://acme.example.com/status/status_incident_3#status_update_5',
    ])
    expect(items[1].pubDate).toBe('Sat, 10 Oct 2026 09:30:00 GMT')
    expect(items[1].description).toBe('Root cause found. · Affected: API')
    expect(items[3].description).toBe(
      'Writes pause briefly. · Window: October 12, 2026 at 02:00 UTC to October 12, 2026 at 04:00 UTC'
    )
    expect(xml).toContain('<lastBuildDate>Sat, 10 Oct 2026 10:00:00 GMT</lastBuildDate>')
  })

  it('caps the feed at the newest 50 items but keeps what is still open', async () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1) + minutes * 60_000).toISOString()
    // Sixty resolved incidents, each newer than the open window's only update.
    const resolved = Array.from({ length: 60 }, (_, n) =>
      item({
        id: `status_incident_r${n}`,
        title: `Resolved ${n}`,
        status: 'resolved',
        resolvedAt: at(100 + n),
        updates: [
          { id: `status_update_r${n}`, status: 'resolved', body: 'Fixed.', createdAt: at(100 + n) },
        ],
      })
    )
    const scheduled = item({
      id: 'status_incident_open',
      kind: 'maintenance',
      title: 'Database upgrade',
      status: 'scheduled',
      scheduledStartAt: '2026-10-20T02:00:00.000Z',
      scheduledEndAt: null,
      updates: [
        { id: 'status_update_open', status: 'scheduled', body: 'Planned.', createdAt: at(0) },
      ],
    })
    listStatusFeedFn.mockResolvedValue([...resolved, scheduled])

    const items = itemsOf(await (await GET()).text())
    expect(items).toHaveLength(50)
    expect(items[0].title).toBe('Resolved 59 (Resolved)')
    expect(items[48].title).toBe('Resolved 11 (Resolved)')
    expect(items[49].title).toBe('Maintenance: Database upgrade (Scheduled)')
  })

  describe('a change made without posting an update', () => {
    const window = (detailsEditedAt: string | null) =>
      item({
        id: 'status_incident_2',
        kind: 'maintenance',
        title: 'Database upgrade',
        status: 'scheduled',
        scheduledStartAt: '2026-10-13T02:00:00.000Z',
        scheduledEndAt: '2026-10-13T04:00:00.000Z',
        updates: [
          {
            id: 'status_update_4',
            status: 'scheduled',
            body: 'Writes pause briefly.',
            createdAt: '2026-10-09T12:00:00.000Z',
          },
        ],
        detailsEditedAt,
      })

    it('reaches readers as a new item carrying the details as they are now', async () => {
      // Rescheduled after its only update: a reader that already read that
      // update learns the new window from a new item.
      listStatusFeedFn.mockResolvedValue([window('2026-10-10T11:00:00.000Z')])
      const xml = await (await GET()).text()
      const items = itemsOf(xml)
      expect(items.map((i) => i.title)).toEqual([
        'Maintenance: Database upgrade (Scheduled)',
        'Maintenance: Database upgrade (Scheduled)',
      ])
      expect(items[0].guid).toBe(
        `https://acme.example.com/status/status_incident_2#edited-${Date.parse('2026-10-10T11:00:00.000Z')}`
      )
      expect(items[0].pubDate).toBe('Sat, 10 Oct 2026 11:00:00 GMT')
      expect(items[0].description).toBe(
        'Details updated · Window: October 13, 2026 at 02:00 UTC to October 13, 2026 at 04:00 UTC · Affected: API'
      )
      expect(items[1].guid).toBe(
        'https://acme.example.com/status/status_incident_2#status_update_4'
      )
      expect(xml).toContain('<lastBuildDate>Sat, 10 Oct 2026 11:00:00 GMT</lastBuildDate>')
    })

    it('reaches readers even when made seconds after an update, like a corrected typo', async () => {
      listStatusFeedFn.mockResolvedValue([window('2026-10-09T12:00:02.000Z')])
      const items = itemsOf(await (await GET()).text())
      expect(items.map((i) => i.guid)).toEqual([
        `https://acme.example.com/status/status_incident_2#edited-${Date.parse('2026-10-09T12:00:02.000Z')}`,
        'https://acme.example.com/status/status_incident_2#status_update_4',
      ])
    })

    it('adds one item for the latest edit, not one per save, and none without an edit', async () => {
      const guids = async (detailsEditedAt: string | null) => {
        listStatusFeedFn.mockResolvedValue([window(detailsEditedAt)])
        return itemsOf(await (await GET()).text()).map((i) => i.guid)
      }
      expect(await guids(null)).toHaveLength(1)
      // An edit made before the latest update is already in that update's item.
      expect(await guids('2026-10-09T11:00:00.000Z')).toHaveLength(1)

      const firstSave = await guids('2026-10-10T11:00:00.000Z')
      const secondSave = await guids('2026-10-10T11:00:05.000Z')
      expect(firstSave).toHaveLength(2)
      expect(secondSave).toHaveLength(2)
      expect(secondSave[0]).not.toBe(firstSave[0])
      expect(secondSave[1]).toBe(firstSave[1])
    })
  })

  it('escapes markup in titles and bodies', async () => {
    listStatusFeedFn.mockResolvedValue([item({ title: 'A & B <outage>' })])
    const xml = await (await GET()).text()
    expect(xml).toContain('<title>A &amp; B &lt;outage&gt; (Investigating)</title>')
  })

  it('shows a plain-text body that looks like markup as the text the admin typed', async () => {
    // Readers render a description as HTML, so the body must reach them as
    // text: "<b>v2</b>" stays those characters, never a bold "v2".
    listStatusFeedFn.mockResolvedValue([
      item({
        updates: [
          {
            id: 'status_update_1',
            status: 'investigating',
            body: 'Calls to <b>v2</b> & <script>x</script> fail',
            createdAt: '2026-10-10T09:00:00.000Z',
          },
        ],
      }),
    ])
    const xml = await (await GET()).text()
    const html = descriptionHtml(itemsOf(xml)[0].description)
    expect(html).toContain(
      'Calls to &lt;b&gt;v2&lt;/b&gt; &amp; &lt;script&gt;x&lt;/script&gt; fail'
    )
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<script>')
  })

  it('shortens a long body but keeps the window and services after it', async () => {
    listStatusFeedFn.mockResolvedValue([
      item({
        kind: 'maintenance',
        title: 'Database upgrade',
        status: 'scheduled',
        scheduledStartAt: '2026-10-13T02:00:00.000Z',
        scheduledEndAt: '2026-10-13T04:00:00.000Z',
        updates: [
          {
            id: 'status_update_1',
            status: 'scheduled',
            body: 'x'.repeat(600),
            createdAt: '2026-10-10T09:00:00.000Z',
          },
        ],
      }),
    ])
    const description = itemsOf(await (await GET()).text())[0].description ?? ''
    expect(description).toContain(`${'x'.repeat(497)}... · Window: October 13, 2026 at 02:00 UTC`)
    expect(description).toMatch(/ · Affected: API$/)
    expect(description).not.toContain('x'.repeat(498))
  })

  it('keeps the line breaks of a body', async () => {
    listStatusFeedFn.mockResolvedValue([
      item({
        updates: [
          {
            id: 'status_update_1',
            status: 'investigating',
            body: 'First line.\nSecond line.\r\nThird line.',
            createdAt: '2026-10-10T09:00:00.000Z',
          },
        ],
      }),
    ])
    const xml = await (await GET()).text()
    expect(descriptionHtml(itemsOf(xml)[0].description)).toContain(
      'First line.<br>Second line.<br>Third line.'
    )
  })

  it('still returns a valid, empty feed when the page is gated out', async () => {
    listStatusFeedFn.mockResolvedValue([])
    const xml = await (await GET()).text()
    expect(xml).toContain('<rss version="2.0"')
    expect(itemsOf(xml)).toEqual([])
  })

  it("links the page and every update at the status page's own host", async () => {
    links.statusOrigin = 'https://status.acme.com'
    listStatusFeedFn.mockResolvedValue([item({})])
    const xml = await (await GET()).text()
    expect(itemsOf(xml)[0].guid).toBe(
      'https://status.acme.com/status/status_incident_1#status_update_1'
    )
    expect(xml).toContain('<link>https://status.acme.com/</link>')
    expect(xml).not.toContain('https://acme.example.com')
  })
})
