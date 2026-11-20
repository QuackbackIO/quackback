/**
 * The public status RSS feed (/status/feed).
 *
 * Journeys: STA-P-20, STA-P-21. The cap, escaping and section-host journeys
 * (STA-P-22, STA-P-24, STA-P-25) are proved by src/routes/status/__tests__/feed.test.ts.
 *
 * The feed is workspace-wide and capped at 50 items: each test reads it right
 * after writing and finds its own items by marker.
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { personApi } from '../../support/server-fns'
import { supportEnv } from '../../support/env'
import {
  createIncident,
  createService,
  must,
  postUpdate,
  scheduleWindow,
  deleteMadeIncidents,
} from '../../product/status'

let admin: APIRequestContext
let reader: APIRequestContext

test.beforeEach(async ({ playwright }) => {
  admin = await personApi(playwright, 'admin')
  reader = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
})
test.afterEach(async () => {
  await deleteMadeIncidents(admin)
  await admin.dispose()
  await reader.dispose()
})

interface FeedItem {
  title: string
  link: string
  guid: string
  description: string
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

async function readFeed(): Promise<{
  xml: string
  items: FeedItem[]
  headers: Record<string, string>
}> {
  const res = await reader.get('/status/feed')
  expect(res.status()).toBe(200)
  const xml = await res.text()
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) => {
    const pick = (tag: string) =>
      decode(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(body)?.[1] ?? '')
    return {
      title: pick('title'),
      link: pick('link'),
      guid: pick('guid'),
      description: pick('description'),
    }
  })
  return { xml, items, headers: res.headers() }
}

test('STA-P-20 the RSS feed lists every update', { tag: '@core' }, async ({ marker }) => {
  const a = await createService(admin, `${marker} Alpha`)
  const b = await createService(admin, `${marker} Beta`)
  const inc = await createIncident(admin, {
    title: `${marker} feed incident`,
    services: [
      [a.id, 'major_outage'],
      [b.id, 'degraded_performance'],
    ],
    body: `${marker} first update`,
  })
  await postUpdate(admin, inc.id, 'identified', `${marker} second update`)
  const w = await scheduleWindow(admin, {
    title: `${marker} feed window`,
    services: [[a.id, 'under_maintenance']],
    body: `${marker} window plan`,
  })

  const { xml, items, headers } = await readFeed()
  expect(headers['content-type']).toBe('application/rss+xml; charset=utf-8')
  expect(headers['cache-control']).toBe('private, max-age=300')
  expect(headers['vary']).toMatch(/Cookie/)
  expect(xml).toMatch(/<channel>\s*<title>.+ Status<\/title>/)
  expect(xml).toMatch(/<description>Incidents and maintenance for .+<\/description>/)
  expect(xml).toMatch(
    /<atom:link[^>]*href="[^"]*\/status\/feed"[^>]*rel="self"|<atom:link[^>]*rel="self"[^>]*href="[^"]*\/status\/feed"/
  )
  expect(xml).toContain('<language>en-us</language>')

  const mine = items.filter((i) => i.title.includes(marker))
  expect(mine.map((i) => i.title)).toEqual([
    `Maintenance: ${marker} feed window (Scheduled)`,
    `${marker} feed incident (Identified)`,
    `${marker} feed incident (Investigating)`,
  ])
  const [windowItem, second, first] = mine
  expect(first.link).toMatch(new RegExp(`/status/${inc.id}$`))
  expect(first.guid).toMatch(new RegExp(`^.*/status/${inc.id}#status_update_`))
  expect(second.guid).not.toBe(first.guid)
  expect(first.description).toContain(`${marker} first update`)
  // Services are listed in page order (Alpha was created first).
  const affected = / · Affected: (.+)$/.exec(first.description)?.[1].split(', ') ?? []
  expect(affected).toEqual([`${marker} Alpha`, `${marker} Beta`])
  expect(windowItem.link).toMatch(new RegExp(`/status/${w.id}$`))
  expect(windowItem.description).toMatch(/Window: .+ to .+ UTC/)
  expect(xml).toMatch(/<guid isPermaLink="false">/)
})

test(
  'STA-P-21 the feed announces a details edit made after the latest update',
  { tag: '@nightly' },
  async ({ marker }) => {
    const svc = await createService(admin, `${marker} Edited`)
    const inc = await createIncident(admin, {
      title: `${marker} before`,
      services: [[svc.id, 'degraded_performance']],
    })
    // An impact-only change adds nothing.
    await must(admin, 'updateStatusIncidentFn', {
      id: inc.id,
      impact: 'major',
      impactOverride: true,
    })
    let mine = (await readFeed()).items.filter((i) => i.link.endsWith(inc.id))
    expect(mine.filter((i) => i.guid.includes('#edited-'))).toEqual([])

    await must(admin, 'updateStatusIncidentFn', { id: inc.id, title: `${marker} renamed once` })
    mine = (await readFeed()).items.filter((i) => i.link.endsWith(inc.id))
    const edits = mine.filter((i) => i.guid.includes('#edited-'))
    expect(edits).toHaveLength(1)
    expect(edits[0].title).toBe(`${marker} renamed once (Investigating)`)
    expect(edits[0].description).toMatch(/^Details updated/)

    await new Promise((r) => setTimeout(r, 20))
    await must(admin, 'updateStatusIncidentFn', { id: inc.id, title: `${marker} renamed twice` })
    mine = (await readFeed()).items.filter((i) => i.link.endsWith(inc.id))
    const latest = mine.filter((i) => i.guid.includes('#edited-'))
    expect(latest).toHaveLength(1)
    expect(latest[0].title).toBe(`${marker} renamed twice (Investigating)`)
    expect(latest[0].guid).not.toBe(edits[0].guid)

    // An update posted after the edit supersedes it.
    await postUpdate(admin, inc.id, 'identified', 'found it')
    mine = (await readFeed()).items.filter((i) => i.link.endsWith(inc.id))
    expect(mine.filter((i) => i.guid.includes('#edited-'))).toEqual([])
  }
)
