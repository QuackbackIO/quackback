/**
 * The changelog RSS feed (/changelog/feed).
 *
 * Journeys: CHG-F-01, CHG-F-02, CHG-F-05 (quarantined), CHG-F-06, CHG-F-07
 * (@isolated), CHG-F-08, CHG-F-09, CHG-F-10, CHG-F-11, CHG-F-12.
 *
 * Entries are announced silently (notify: false), so no subscriber mail; the
 * feed holds the 50 newest entries, so each test only looks for its own.
 */
import type { APIRequestContext } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { withSettings } from '../../support/isolated-settings'
import { callServerFn, personApi } from '../../support/server-fns'
import { mintCustomer, portalContext } from '../../support/widget-portal'
import {
  createEntry,
  createLabel,
  retireChangelog,
  segmentWith,
  updateEntry,
} from '../../product/changelog'

test.afterEach(async () => {
  await retireChangelog()
})

interface Item {
  title: string
  link: string
  guid: string
  description: string
  pubDate: string
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}(?: [^>]*)?>([\\s\\S]*?)</${name}>`))
  return m ? m[1] : ''
}

function items(xml: string): Item[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
    title: tag(m[1], 'title'),
    link: tag(m[1], 'link'),
    guid: tag(m[1], 'guid'),
    description: tag(m[1], 'description'),
    pubDate: tag(m[1], 'pubDate'),
  }))
}

async function feed(api: APIRequestContext): Promise<string> {
  const res = await api.get('/changelog/feed')
  expect(res.status()).toBe(200)
  return res.text()
}

function itemFor(xml: string, id: string): Item | undefined {
  return items(xml).find((i) => i.link.endsWith(`/changelog/${id}`))
}

test(
  'CHG-F-01 the feed is RSS 2.0 with the workspace channel',
  { tag: '@core' },
  async ({ request }) => {
    const [ws] = await supportDb()`SELECT name FROM settings LIMIT 1`
    const res = await request.get('/changelog/feed')
    expect(res.headers()['content-type']).toBe('application/rss+xml; charset=utf-8')
    const xml = await res.text()
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toMatch(/<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/)
    const channel = tag(xml, 'channel')
    expect(tag(channel, 'title')).toBe(`${String(ws.name)} Changelog`)
    expect(tag(channel, 'description')).toBe(`Latest updates and releases from ${String(ws.name)}`)
    expect(tag(channel, 'link')).toMatch(/^https?:\/\/[^<]+\/changelog$/)
    expect(channel).toMatch(
      /<atom:link href="https?:\/\/[^"]+\/changelog\/feed" rel="self" type="application\/rss\+xml"\/>/
    )
    expect(tag(channel, 'lastBuildDate')).toMatch(/GMT$/)
  }
)

test(
  'CHG-F-02 an item: title, permalink guid, a 500-character description and its pubDate',
  { tag: '@core' },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const long = `${marker} ${'word '.repeat(150)}`
    const entry = await createEntry(admin, {
      title: `${marker} feed item`,
      content: long,
      state: 'published',
      notify: false,
    })
    const item = itemFor(await feed(request), entry.id)
    expect(item).toBeDefined()
    expect(item!.title).toBe(entry.title)
    expect(item!.link).toMatch(new RegExp(`^https?://[^<]+/changelog/${entry.id}$`))
    expect(item!.guid).toBe(item!.link)
    expect(item!.description.length).toBeLessThanOrEqual(500)
    expect(item!.description.startsWith(marker)).toBe(true)
    expect(item!.pubDate).toBe(new Date(entry.publishedAt!).toUTCString())
    await admin.dispose()
  }
)

test(
  'CHG-F-05 item descriptions are plain text, not markdown syntax',
  {
    tag: ['@nightly', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'routes/changelog/feed.ts strips HTML from the markdown projection, so markdown syntax reaches readers (see QUARANTINE.md)',
    },
  },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const entry = await createEntry(admin, {
      title: `${marker} markdown`,
      content: `## ${marker} heading\n\nSome **bold** and a [link](https://example.com).`,
      state: 'published',
      notify: false,
    })
    const item = itemFor(await feed(request), entry.id)
    expect(item?.description).toContain('bold')
    expect(item?.description).not.toMatch(/\*\*|##|\]\(/)
    await admin.dispose()
  }
)

test(
  'CHG-F-06 drafts, scheduled, unpublished and deleted entries are not in the feed',
  { tag: '@core' },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const live = await createEntry(admin, {
      title: `${marker} live`,
      state: 'published',
      notify: false,
    })
    const draft = await createEntry(admin, { title: `${marker} draft` })
    const scheduled = await createEntry(admin, {
      title: `${marker} later`,
      state: { type: 'scheduled', publishAt: new Date(Date.now() + 86_400_000).toISOString() },
    })
    const unpublished = await createEntry(admin, {
      title: `${marker} withdrawn`,
      state: 'published',
      notify: false,
    })
    await updateEntry(admin, unpublished.id, { publishState: { type: 'draft' } })
    const deleted = await createEntry(admin, {
      title: `${marker} deleted`,
      state: 'published',
      notify: false,
    })
    expect((await callServerFn(admin, 'deleteChangelogFn', { id: deleted.id })).ok).toBe(true)

    const xml = await feed(request)
    expect(itemFor(xml, live.id)).toBeDefined()
    for (const e of [draft, scheduled, unpublished, deleted]) {
      expect(itemFor(xml, e.id), e.title).toBeUndefined()
    }
    await admin.dispose()
  }
)

test(
  'CHG-F-07 a valid, empty feed when the product is off, the portal private or the audience signed-in only',
  { tag: ['@core', '@isolated'] },
  async ({ playwright, request, marker }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const admin = await personApi(playwright, 'admin')
    const entry = await createEntry(admin, {
      title: `${marker} gated feed`,
      state: 'published',
      notify: false,
    })
    await withSettings(
      { feature_flags: { changelog: true }, portal_config: { 'access.visibility': 'public' } },
      async () => {
        expect(itemFor(await feed(request), entry.id)).toBeDefined()
      }
    )
    for (const patch of [
      { feature_flags: { changelog: false } },
      { portal_config: { 'access.visibility': 'private' } },
      { metadata: { 'changelogSettings.audience': 'authenticated' } },
    ]) {
      await withSettings(patch, async () => {
        const xml = await feed(request)
        expect(xml, JSON.stringify(patch)).toContain('<rss version="2.0"')
        expect(items(xml), JSON.stringify(patch)).toHaveLength(0)
      })
    }
    await admin.dispose()
  }
)

test(
  'CHG-F-08 entries with a segment-gated label are left out for readers outside the segment',
  { tag: '@core' },
  async ({ playwright, browser, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const member = await mintCustomer({ email: `${marker}-in@customers.example` })
    const segment = await segmentWith(marker, [member.principalUuid])
    const label = await createLabel(admin, `${marker.slice(-30)} vip`, [segment])
    const gated = await createEntry(admin, {
      title: `${marker} gated`,
      state: 'published',
      notify: false,
      categoryIds: [label.id],
    })
    const open = await createEntry(admin, {
      title: `${marker} open`,
      state: 'published',
      notify: false,
    })

    const anon = await feed(request)
    expect(itemFor(anon, open.id)).toBeDefined()
    expect(itemFor(anon, gated.id)).toBeUndefined()
    const memberCtx = await portalContext(browser, member)
    expect(itemFor(await feed(memberCtx.request), gated.id)).toBeDefined()
    await memberCtx.close()
    expect(itemFor(await feed(admin), gated.id)).toBeDefined()
    await admin.dispose()
  }
)

test(
  'CHG-F-09 the feed is privately cached for five minutes and varies by cookie',
  { tag: '@nightly' },
  async ({ request }) => {
    const res = await request.get('/changelog/feed')
    expect(res.headers()['cache-control']).toBe('private, max-age=300')
    expect(res.headers()['vary']).toMatch(/Cookie/)
  }
)

test(
  'CHG-F-10 /changelog/rss and /changelog/rss.xml redirect to the feed',
  { tag: '@nightly' },
  async ({ request }) => {
    for (const path of ['/changelog/rss', '/changelog/rss.xml']) {
      const res = await request.get(path, { maxRedirects: 0 })
      expect(res.status(), path).toBeGreaterThanOrEqual(301)
      expect(res.status(), path).toBeLessThanOrEqual(308)
      expect(res.headers()['location'], path).toMatch(/\/changelog\/feed$/)
    }
  }
)

test(
  'CHG-F-11 pubDate follows the display date',
  { tag: '@nightly' },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const shown = new Date(Date.UTC(2025, 2, 14, 12)).toISOString()
    const entry = await createEntry(admin, {
      title: `${marker} backdated`,
      state: 'published',
      notify: false,
      displayDate: shown,
    })
    const [row] = await supportDb()`SELECT display_date FROM changelog_entries
      WHERE id = ${toUuid(entry.id as `changelog_${string}`)}`
    const item = itemFor(await feed(request), entry.id)
    expect(item?.pubDate).toBe((row.display_date as Date).toUTCString())
    expect((row.display_date as Date).toISOString().slice(0, 10)).toBe('2025-03-14')
    await admin.dispose()
  }
)

test(
  'CHG-F-12 the feed says en-us and carries no labels or images',
  { tag: '@nightly' },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const label = await createLabel(admin, `${marker.slice(-30)} lbl`)
    const entry = await createEntry(admin, {
      title: `${marker} plain`,
      state: 'published',
      notify: false,
      categoryIds: [label.id],
    })
    const xml = await feed(request)
    expect(tag(xml, 'language')).toBe('en-us')
    const raw =
      xml.match(new RegExp(`<item>(?:(?!</item>)[\\s\\S])*${entry.id}[\\s\\S]*?</item>`))?.[0] ?? ''
    expect(raw).not.toBe('')
    expect(raw).not.toContain('<category')
    expect(raw).not.toContain('<enclosure')
    expect(raw).not.toContain(label.name)
    await admin.dispose()
  }
)
