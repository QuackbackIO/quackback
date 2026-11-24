/**
 * The widget's public endpoints and their request limits (area CUS-W).
 *
 * Every request carries its own client address in `x-e2e-client-ip`
 * (support.env sets TRUSTED_CLIENT_IP_HEADER), so a per-address limit trips
 * for this test's address alone.
 *
 * The identify limit is per address only, so it runs in the shared shards.
 * The feedback search and legacy image upload limits also count every request
 * in a workspace-wide bucket (`enforceWidgetQuota`,
 * lib/server/widget/public-endpoint.ts), which sits well above one visitor's
 * limit but is shared with every other test. So those tests are `@isolated`:
 * they run only with E2E_SUPPORT_ISOLATED=1, on a database of their own, and
 * clear the buckets they filled. No CI job sets it today.
 */
import { randomInt } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { withSettings } from '../../support/isolated-settings'

const ISOLATED = process.env.E2E_SUPPORT_ISOLATED === '1'
const ISOLATED_SKIP =
  'needs its own database: fills a workspace-wide rate limit (runs in the support-isolated job)'

/** A client address no other test uses (10.x is never loopback). */
function clientIp(): string {
  return `10.${randomInt(1, 255)}.${randomInt(0, 256)}.${randomInt(1, 255)}`
}

/** Fire `count` requests one after another (the limiter counts in order). */
async function fire(count: number, send: () => Promise<APIResponse>): Promise<number[]> {
  const statuses: number[] = []
  for (let i = 0; i < count; i++) statuses.push((await send()).status())
  return statuses
}

async function expectRateLimited(res: APIResponse, message: string) {
  expect(res.status()).toBe(429)
  expect(await res.json()).toEqual({ error: { code: 'RATE_LIMITED', message } })
  expect(Number(res.headers()['retry-after'])).toBeGreaterThan(0)
}

/** Forget the buckets a test filled, so the next test starts from zero. */
async function clearBuckets(prefix: string) {
  await supportDb()`DELETE FROM rate_bucket WHERE key LIKE ${`${prefix}:%`}`
}

test(
  'CUS-W-07 identify refuses an address after 60 attempts in 15 minutes, other addresses unaffected',
  { tag: '@nightly' },
  async ({ request }) => {
    const ip = clientIp()
    const identify = (address: string) =>
      request.post('/api/widget/identify', {
        headers: { 'x-e2e-client-ip': address, 'content-type': 'application/json' },
        data: { notAToken: true },
      })

    // The limit is checked before the body: each of the first 60 bad bodies
    // gets the ordinary validation answer.
    const first = await identify(ip)
    expect(first.status()).toBe(400)
    expect(await first.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(new Set(await fire(59, () => identify(ip)))).toEqual(new Set([400]))

    const limited = await identify(ip)
    expect(limited.status()).toBe(429)
    expect(await limited.json()).toMatchObject({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many identify attempts, please try again later',
      },
    })

    // Another address is counted on its own.
    expect((await identify(clientIp())).status()).toBe(400)
  }
)

test.describe('workspace-wide widget limits', { tag: '@isolated' }, () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!ISOLATED, ISOLATED_SKIP)

  test(
    'CUS-W-53 feedback search answers 429 after 60 searches a minute',
    { tag: '@nightly' },
    async ({ request }) => {
      const ip = clientIp()
      const search = () =>
        request.get('/api/widget/search?q=anything', { headers: { 'x-e2e-client-ip': ip } })
      try {
        await clearBuckets('widget-search')
        expect(new Set(await fire(60, search))).toEqual(new Set([200]))
        await expectRateLimited(await search(), 'Too many searches, slow down')
      } finally {
        await clearBuckets('widget-search')
      }
    }
  )

  test(
    'CUS-W-43 legacy image upload answers 401 signed out and 429 after 20 uploads a minute',
    { tag: '@nightly' },
    async ({ request, playwright, baseURL }) => {
      const ip = clientIp()
      const signedOut = await request.post('/api/widget/upload', {
        headers: { 'x-e2e-client-ip': ip },
        multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('x') } },
      })
      expect(signedOut.status()).toBe(401)

      const visitor = await anonymousVisitor(playwright, baseURL, ip)
      // The limit is checked before the body is read, so an unreadable body
      // counts like an upload without storing anything: 400 until the limit.
      const upload = () =>
        visitor.post('/api/widget/upload', {
          headers: { 'content-type': 'multipart/form-data; boundary=none' },
          data: 'not multipart',
        })
      try {
        await clearBuckets('widget-upload')
        // Since cae1ebdb15 (#1229) an anonymous session uploads only while the
        // workspace takes anonymous posts: refused before the limit counts it.
        const refused = await upload()
        expect(refused.status()).toBe(403)
        expect(await refused.json()).toEqual({ error: 'Anonymous interaction is not enabled' })
        await withSettings({ portal_config: { 'features.allowAnonymous': true } }, async () => {
          const first = await upload()
          expect(first.status()).toBe(400)
          expect(await first.json()).toEqual({ error: 'Invalid request body' })
          expect(new Set(await fire(19, upload))).toEqual(new Set([400]))
          await expectRateLimited(await upload(), 'Too many uploads, slow down')
        })
      } finally {
        await clearBuckets('widget-upload')
        await visitor.dispose()
      }
    }
  )
  test(
    'CUS-W-53 one visitor reaching the search limit leaves other visitors searching',
    // Each signed-out caller is counted by its own address, and the workspace
    // count sits well above one visitor's 60, so one burst refuses only that
    // visitor.
    { tag: '@nightly' },
    async ({ request }) => {
      const noisy = clientIp()
      try {
        await clearBuckets('widget-search')
        await fire(61, () =>
          request.get('/api/widget/search?q=anything', { headers: { 'x-e2e-client-ip': noisy } })
        )
        const other = await request.get('/api/widget/search?q=anything', {
          headers: { 'x-e2e-client-ip': clientIp() },
        })
        expect(other.status()).toBe(200)
      } finally {
        await clearBuckets('widget-search')
      }
    }
  )
})

/** An anonymous widget session (the widget's own mint), as a Bearer request context. */
async function anonymousVisitor(
  playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } },
  baseURL: string | undefined,
  ip: string
): Promise<APIRequestContext> {
  const mint = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-e2e-client-ip': ip },
  })
  const res = await mint.post('/api/auth/sign-in/anonymous', { data: {} })
  expect(res.status(), await res.text()).toBe(200)
  const token = res.headers()['set-auth-token']
  expect(token, 'the anonymous mint returns a bearer token').toBeTruthy()
  await mint.dispose()
  return playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-e2e-client-ip': ip, authorization: `Bearer ${token}` },
  })
}
