/**
 * The visitor analytics beacon (/api/track) and what the Visitors section
 * reads from it.
 *
 * Journeys: INT-AN-09, INT-AN-10, INT-AN-12.
 *
 * Every beacon uses a path unique to the test and its own client address
 * (x-e2e-client-ip, the suite's trusted client IP header), so rows are found
 * by path and the per-address rate limit is never shared.
 */
import { randomBytes } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { callServerFn } from '../../support/server-fns'
import { asPersonApi, runAnalyticsRefresh } from '../../product/platform-admin'

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

function clientIp(): string {
  const b = randomBytes(3)
  return `10.${b[0]}.${b[1]}.${b[2]}`
}

async function beacon(
  request: APIRequestContext,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; cors: string | undefined }> {
  const res = await request.post('/api/track', {
    headers: {
      'content-type': 'text/plain',
      'user-agent': BROWSER_UA,
      'x-e2e-client-ip': clientIp(),
      ...headers,
    },
    data: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: res.status(), cors: res.headers()['access-control-allow-origin'] }
}

interface PageViewRow {
  site_origin: string
  path: string
  surface: string
  source: string | null
  visitor_hash: string
}

async function viewsAt(path: string): Promise<PageViewRow[]> {
  return supportDb()<PageViewRow[]>`
    SELECT site_origin, path, surface, source, visitor_hash FROM page_views WHERE path = ${path}`
}

test(
  'INT-AN-09 a beacon records one page view: origin, path only, source, hashed visitor',
  { tag: '@core' },
  async ({ request, marker }) => {
    const path = `/e2e/${marker}`
    const ip = clientIp()
    const res = await beacon(
      request,
      {
        url: `https://shop.example${path}?utm_source=newsletter&secret=1`,
        referrer: 'https://news.example/item',
        surface: 'widget',
      },
      { 'x-e2e-client-ip': ip }
    )
    expect(res.status).toBe(204)
    expect(res.cors).toBe('*')
    const rows = await viewsAt(path)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      site_origin: 'https://shop.example',
      path,
      surface: 'widget',
      source: 'newsletter',
    })
    // The visitor is a hash, never the raw address or browser string.
    expect(rows[0].visitor_hash).toMatch(/^[0-9a-f]{16,}$/)
    expect(JSON.stringify(rows[0])).not.toContain(ip)

    // Same address, browser and origin the same day: the same visitor.
    await beacon(
      request,
      { url: `https://shop.example${path}`, surface: 'widget' },
      { 'x-e2e-client-ip': ip }
    )
    // Another origin: another visitor.
    await beacon(
      request,
      { url: `https://other.example${path}`, surface: 'portal' },
      { 'x-e2e-client-ip': ip }
    )
    const all = await viewsAt(path)
    expect(all).toHaveLength(3)
    const shop = all.filter((r) => r.site_origin === 'https://shop.example')
    expect(new Set(shop.map((r) => r.visitor_hash)).size).toBe(1)
    const other = all.find((r) => r.site_origin === 'https://other.example')!
    expect(other.visitor_hash).not.toBe(shop[0].visitor_hash)
    // Without a campaign or an outside referrer the visit is direct (no source).
    expect(shop.map((r) => r.source ?? 'direct').sort()).toEqual(['direct', 'newsletter'])
  }
)

test(
  'INT-AN-10 refused beacons are silent: opt-outs, bots, bad bodies, bad schemes, rate limit',
  { tag: '@core' },
  async ({ request, marker }) => {
    const path = `/e2e/${marker}`
    const url = `https://shop.example${path}`
    const good = { url, surface: 'portal' }
    const cases: Array<[string, unknown, Record<string, string>]> = [
      ['do not track', good, { dnt: '1' }],
      ['global privacy control', good, { 'sec-gpc': '1' }],
      ['a bot', good, { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' }],
      ['no user agent', good, { 'user-agent': '' }],
      ['oversize', { ...good, referrer: 'x'.repeat(2100) }, {}],
      ['not JSON', 'hello', {}],
      ['unknown surface', { url, surface: 'email' }, {}],
      ['a javascript URL', { url: `javascript:alert(1)//${path}`, surface: 'portal' }, {}],
      ['a ftp URL', { url: `ftp://shop.example${path}`, surface: 'portal' }, {}],
    ]
    for (const [what, body, headers] of cases) {
      const res = await beacon(request, body, headers)
      expect(res.status, what).toBe(204)
      expect(await viewsAt(path), what).toHaveLength(0)
    }

    // The 121st beacon in a minute from one address is dropped.
    const ip = clientIp()
    const limited = `${path}-limit`
    for (let i = 0; i < 121; i++) {
      const res = await beacon(
        request,
        { url: `https://shop.example${limited}`, surface: 'portal' },
        { 'x-e2e-client-ip': ip }
      )
      expect(res.status).toBe(204)
    }
    expect(await viewsAt(limited)).toHaveLength(120)
  }
)

test(
  'INT-AN-12 the Visitors section counts the beacons after the rollup',
  { tag: '@core' },
  async ({ request, playwright, marker }) => {
    // A surface filter and the rollup are workspace-wide: assert only growth.
    const read = () =>
      asPersonApi(playwright, 'admin', (api) =>
        callServerFn<{ enabled: boolean; pageviews: { current: number } }>(
          api,
          'getVisitorAnalyticsData',
          { period: '7d', surface: 'widget' },
          { method: 'GET' }
        )
      )
    await runAnalyticsRefresh(request)
    const before = await read()
    expect(before.ok, before.error).toBe(true)
    expect(before.data.enabled).toBe(true)

    for (let i = 0; i < 3; i++) {
      await beacon(request, { url: `https://shop.example/e2e/${marker}/${i}`, surface: 'widget' })
    }
    await runAnalyticsRefresh(request)
    const after = await read()
    expect(after.data.pageviews.current - before.data.pageviews.current).toBeGreaterThanOrEqual(3)
  }
)
