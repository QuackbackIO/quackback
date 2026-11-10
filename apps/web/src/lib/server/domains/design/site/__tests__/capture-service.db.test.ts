/**
 * The capture service against a real database, with the provider, storage
 * and the site reader faked: what is cached and for how long, what counts
 * against the limits, and what reaches the logs.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, siteCaptureCalls, siteCaptures, user } from '@/lib/server/db'
import type { SiteFacts, SiteRead } from '../types'
import { fakePng } from './capture-fixtures'

const { logMock, s3Mock } = vi.hoisted(() => ({
  logMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  s3Mock: { getS3Object: vi.fn(), uploadObject: vi.fn(), isS3Usable: vi.fn(() => true) },
}))

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => logMock, ...logMock },
}))
vi.mock('@/lib/server/storage/s3', () => s3Mock)

const { getSiteCapture, captureUsage, CAPTURE_FRESH_MS } = await import('../capture-service')

const ACCESS = 'test-access-key-1234567890'
const SECRET = 'test-secret-key-0987654321'
const LIMITS = { userHour: 3, workspaceDay: 5, workspaceMonth: 30, instanceMonth: 90 }
const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 6, 15, 10, 30)

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ host: siteCaptures.host }).from(siteCaptures).limit(0)
  },
})
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  await testDb.delete(siteCaptureCalls)
  await testDb.delete(siteCaptures)
  vi.clearAllMocks()
})
afterEach(async () => {
  await fixture.rollback()
})
afterAll(fixture.close)

function facts(over: Partial<SiteFacts> = {}): SiteFacts {
  return {
    url: 'https://www.acme.test/',
    name: 'Acme',
    nameFrom: 'og:site_name',
    language: 'en-gb',
    description: null,
    themeColour: '#123456',
    favicons: [],
    manifest: null,
    logos: [],
    shareImage: null,
    fonts: { heading: null, body: null, faces: [], hosted: [] },
    colours: [],
    stylesheets: [],
    ...over,
  }
}
function siteRead(over: Partial<SiteRead> = {}): SiteRead {
  return { facts: facts(), favicon: null, logo: null, shareImage: null, failed: null, ...over }
}

async function teammate(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Ada', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return principalId
}

function harness(opts: { now?: number; response?: () => Response; read?: SiteRead } = {}) {
  let now = opts.now ?? NOW
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    opts.response ? opts.response() : new Response(fakePng(1440, 900))
  )
  const readSite = vi.fn(async (_url: string) => opts.read ?? siteRead())
  const store = vi.fn(async (_key: string, _bytes: Uint8Array, _type: string) => {})
  const deps = {
    fetch,
    readSite,
    store,
    now: () => now,
    keys: { accessKey: ACCESS, secretKey: SECRET },
    checkUrl: vi.fn(async () => true),
    canStore: () => true,
    limits: LIMITS,
  }
  return {
    deps,
    fetch,
    readSite,
    store,
    advance: (ms: number) => {
      now += ms
    },
  }
}

function errorResponse(status: number, body: unknown) {
  return () => new Response(JSON.stringify(body), { status })
}

async function callRows() {
  return testDb.select().from(siteCaptureCalls)
}
async function captureRow(host: string) {
  const [row] = await testDb.select().from(siteCaptures).where(eq(siteCaptures.host, host))
  return row
}

describe('getSiteCapture', () => {
  it('refuses an address that is not a website, without reading or capturing', async () => {
    const h = harness()
    const out = await getSiteCapture({ url: 'http://localhost:3000', principalId: null }, h.deps)
    expect(out).toMatchObject({ ok: false, reason: 'invalid_url', host: null, facts: null })
    expect(h.readSite).not.toHaveBeenCalled()
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('refuses a host that resolves somewhere private', async () => {
    const h = harness()
    h.deps.checkUrl.mockResolvedValueOnce(false)
    const out = await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    expect(out).toMatchObject({ ok: false, reason: 'blocked_url', host: 'acme.test' })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('reads the site but captures nothing without an access key', async () => {
    const h = harness()
    const out = await getSiteCapture(
      { url: 'https://www.acme.test/about', principalId: null },
      { ...h.deps, keys: { accessKey: null, secretKey: null } }
    )
    expect(out).toMatchObject({ ok: false, reason: 'not_configured', host: 'acme.test' })
    expect(out.ok ? null : out.facts?.name).toBe('Acme')
    expect(h.readSite).toHaveBeenCalledWith('https://www.acme.test/')
    expect(h.fetch).not.toHaveBeenCalled()
    expect(await callRows()).toHaveLength(0)
    expect(await captureRow('acme.test')).toBeUndefined()
  })

  it('captures, stores and records a new host', async () => {
    const p = await teammate()
    const h = harness()
    const out = await getSiteCapture(
      { url: 'https://www.Acme.test/pricing', principalId: p },
      h.deps
    )
    expect(out).toMatchObject({
      ok: true,
      host: 'acme.test',
      url: 'https://www.acme.test/',
      cached: false,
      capturedAt: new Date(NOW),
      image: { key: `site-captures/acme.test/${NOW}.png`, width: 1440, height: 900 },
      usage: { workspaceDayLeft: 4, userHourLeft: 2, instanceMonthLeft: 29 },
    })
    if (!out.ok) throw new Error('unreachable')
    expect(out.image.png).toBeInstanceOf(Uint8Array)
    expect(out.facts?.name).toBe('Acme')
    expect(h.fetch).toHaveBeenCalledTimes(1)
    const sent = String(h.fetch.mock.calls[0][0])
    expect(sent).toContain('url=https%3A%2F%2Fwww.acme.test%2F')
    expect(sent).toContain('signature=')
    expect(sent).toContain(`headers=${encodeURIComponent('Accept-Language:en-GB,en;q=0.9')}`)
    expect(h.store).toHaveBeenCalledWith(
      `site-captures/acme.test/${NOW}.png`,
      expect.any(Uint8Array),
      'image/png'
    )

    const row = await captureRow('acme.test')
    expect(row).toMatchObject({
      status: 'ok',
      imageKey: `site-captures/acme.test/${NOW}.png`,
      width: 1440,
      height: 900,
      capturedByPrincipalId: p,
    })
    expect(JSON.stringify(row.options)).not.toContain(ACCESS)
    expect(JSON.stringify(row.options)).not.toContain('signature')
    expect(await callRows()).toMatchObject([{ host: 'acme.test', outcome: 'ok', billed: true }])

    expect(logMock.info).toHaveBeenCalledWith(
      { host: 'acme.test', outcome: 'ok', billed: true, monthCount: 1 },
      'site capture'
    )
  })

  it('never puts the keys in a result or a log line', async () => {
    const p = await teammate()
    const h = harness({ response: errorResponse(400, { error_code: 'access_key_invalid' }) })
    const failed = await getSiteCapture({ url: 'nimbus.example', principalId: p }, h.deps)
    const ok = await getSiteCapture({ url: 'acme.test', principalId: p }, harness().deps)
    const logged = JSON.stringify(
      Object.values(logMock).flatMap((fn) => fn.mock.calls),
      (_k, v) => (v instanceof Error ? v.message : v)
    )
    for (const secret of [ACCESS, SECRET]) {
      expect(JSON.stringify(failed)).not.toContain(secret)
      expect(JSON.stringify(ok)).not.toContain(secret)
      expect(logged).not.toContain(secret)
      expect(JSON.stringify(await testDb.select().from(siteCaptures))).not.toContain(secret)
    }
    expect(logged).not.toContain('access_key')
  })

  it('serves a good capture from the cache for 30 days without counting', async () => {
    const p = await teammate()
    const h = harness()
    await getSiteCapture({ url: 'acme.test', principalId: p }, h.deps)
    h.advance(29 * 24 * HOUR)
    const again = await getSiteCapture({ url: 'https://www.acme.test/x', principalId: p }, h.deps)
    expect(again).toMatchObject({ ok: true, cached: true, capturedAt: new Date(NOW) })
    if (!again.ok) throw new Error('unreachable')
    expect(again.image.png).toBeUndefined()
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(h.readSite).toHaveBeenCalledTimes(1)
    expect(await callRows()).toHaveLength(1)

    h.advance(2 * 24 * HOUR)
    const stale = await getSiteCapture({ url: 'acme.test', principalId: p }, h.deps)
    expect(stale).toMatchObject({ ok: true, cached: false })
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(CAPTURE_FRESH_MS).toBe(30 * 24 * HOUR)
  })

  it('loads a cached image when asked', async () => {
    const h = harness()
    await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    s3Mock.getS3Object.mockResolvedValueOnce({
      body: new Response(fakePng(1440, 900)).body,
      contentType: 'image/png',
    })
    const out = await getSiteCapture(
      { url: 'acme.test', principalId: null, loadImage: true },
      h.deps
    )
    expect(s3Mock.getS3Object).toHaveBeenCalledWith(`site-captures/acme.test/${NOW}.png`)
    expect(out.ok && out.image.png?.length).toBe(fakePng(1440, 900).length)
  })

  it('refuses a recapture within a day, then allows one that counts', async () => {
    const p = await teammate()
    const h = harness()
    await getSiteCapture({ url: 'acme.test', principalId: p }, h.deps)
    h.advance(3 * HOUR)
    const soon = await getSiteCapture({ url: 'acme.test', principalId: p, recapture: true }, h.deps)
    expect(soon).toMatchObject({
      ok: false,
      reason: 'recapture_too_soon',
      resetsAt: new Date(NOW + 24 * HOUR),
    })
    expect(h.fetch).toHaveBeenCalledTimes(1)

    h.advance(22 * HOUR)
    const later = await getSiteCapture(
      { url: 'acme.test', principalId: p, recapture: true },
      h.deps
    )
    expect(later).toMatchObject({ ok: true, cached: false, capturedAt: new Date(NOW + 25 * HOUR) })
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(await callRows()).toHaveLength(2)
  })

  it('keeps a good capture when a recapture fails', async () => {
    const h = harness()
    await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    const failing = harness({
      now: NOW + 25 * HOUR,
      response: errorResponse(500, { error_code: 'host_returned_error' }),
    })
    const out = await getSiteCapture(
      { url: 'acme.test', principalId: null, recapture: true },
      failing.deps
    )
    expect(out).toMatchObject({ ok: false, reason: 'capture_failed' })
    expect(await captureRow('acme.test')).toMatchObject({ status: 'ok', capturedAt: new Date(NOW) })
  })

  it('remembers a failure for a day, then tries again', async () => {
    const h = harness({ response: errorResponse(500, { error_code: 'host_returned_error' }) })
    const out = await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    expect(out).toMatchObject({ ok: false, reason: 'capture_failed', host: 'acme.test' })
    if (out.ok) throw new Error('unreachable')
    expect(out.message).not.toMatch(/\u2014/)
    expect(out.facts?.name).toBe('Acme')
    expect(await captureRow('acme.test')).toMatchObject({ status: 'failed', reason: 'host_error' })
    expect(await callRows()).toMatchObject([{ outcome: 'host_error', billed: false }])

    h.advance(23 * HOUR)
    const cached = await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    expect(cached).toMatchObject({ ok: false, reason: 'capture_failed' })
    expect(h.fetch).toHaveBeenCalledTimes(1)

    h.advance(2 * HOUR)
    await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    expect(h.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not call the provider when the site is behind a bot wall', async () => {
    const h = harness({ read: siteRead({ facts: null, failed: 'challenge' }) })
    const out = await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    expect(out).toMatchObject({ ok: false, reason: 'challenge', facts: null })
    expect(h.fetch).not.toHaveBeenCalled()
    expect(await callRows()).toHaveLength(0)
    expect(await captureRow('acme.test')).toMatchObject({ status: 'failed', reason: 'challenge' })

    h.advance(HOUR)
    const again = await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    expect(again).toMatchObject({ ok: false, reason: 'challenge' })
    expect(h.readSite).toHaveBeenCalledTimes(1)
  })

  it('reports the provider quota as used up', async () => {
    const h = harness({
      response: errorResponse(400, {
        is_successful: false,
        error_code: 'screenshots_limit_reached',
        error_message: 'limit',
      }),
    })
    const out = await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    expect(out).toMatchObject({ ok: false, reason: 'quota' })
    if (out.ok) throw new Error('unreachable')
    expect(out.message).toBe(
      "Captures are used up for this month, so this match uses what the site's code says. Paste a screenshot for the look."
    )
    expect(await captureRow('acme.test')).toMatchObject({ status: 'failed', reason: 'quota' })
  })

  it('asks once more for a page that never went quiet, and counts both requests', async () => {
    let n = 0
    const h = harness({
      response: () =>
        n++ === 0
          ? new Response(JSON.stringify({ error_code: 'timeout_error' }), { status: 500 })
          : new Response(fakePng(1440, 900)),
    })
    const out = await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    expect(out).toMatchObject({ ok: true })
    expect(h.fetch).toHaveBeenCalledTimes(2)
    const rows = await callRows()
    expect(rows.map((r) => [r.outcome, r.billed]).sort()).toEqual([
      ['ok', true],
      ['timeout', false],
    ])
  })

  it('rejects a response that is not a PNG, and counts it as billed', async () => {
    const h = harness({ response: () => new Response('<html>a page, not an image</html>') })
    const out = await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    expect(out).toMatchObject({ ok: false, reason: 'capture_failed' })
    expect(h.store).not.toHaveBeenCalled()
    expect(await callRows()).toMatchObject([{ outcome: 'bad_image', billed: true }])
  })

  it('refuses at a limit without calling, recording or caching, and keeps the facts', async () => {
    const p = await teammate()
    for (let i = 0; i < 5; i++) {
      await testDb.insert(siteCaptureCalls).values({
        id: crypto.randomUUID(),
        host: `s${i}.nimbus.example`,
        principalId: null,
        outcome: 'ok',
        billed: true,
        createdAt: new Date(NOW - HOUR),
      })
    }
    const h = harness()
    const out = await getSiteCapture({ url: 'acme.test', principalId: p }, h.deps)
    expect(out).toMatchObject({
      ok: false,
      reason: 'limit',
      limit: 'workspace_day',
      resetsAt: new Date(Date.UTC(2026, 6, 16)),
    })
    if (out.ok) throw new Error('unreachable')
    expect(out.facts?.name).toBe('Acme')
    expect(out.message).toContain("Today's captures are used up")
    expect(h.fetch).not.toHaveBeenCalled()
    expect(await callRows()).toHaveLength(5)
    expect(await captureRow('acme.test')).toBeUndefined()
  })

  it('falls back to the site code once the monthly cap is reached', async () => {
    const limits = { ...LIMITS, instanceMonth: 1 }
    const h = harness()
    await getSiteCapture({ url: 'acme.test', principalId: null }, { ...h.deps, limits })
    const out = await getSiteCapture(
      { url: 'nimbus.example', principalId: null },
      {
        ...h.deps,
        limits,
      }
    )
    expect(out).toMatchObject({ ok: false, reason: 'limit', limit: 'instance_month' })
    if (out.ok) throw new Error('unreachable')
    expect(out.message).toContain('used up for this month')
    expect(out.facts).not.toBeNull()
    expect(h.fetch).toHaveBeenCalledTimes(1)
  })

  it('shares one capture between concurrent requests for a host', async () => {
    const h = harness()
    const [a, b] = await Promise.all([
      getSiteCapture({ url: 'acme.test', principalId: null }, h.deps),
      getSiteCapture({ url: 'https://www.acme.test/', principalId: null }, h.deps),
    ])
    expect(a).toBe(b)
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(h.readSite).toHaveBeenCalledTimes(1)
    expect(await callRows()).toHaveLength(1)
  })

  it('returns the bytes without a key when storage is not usable', async () => {
    const h = harness()
    const out = await getSiteCapture(
      { url: 'acme.test', principalId: null },
      { ...h.deps, canStore: () => false }
    )
    expect(out).toMatchObject({ ok: true, image: { key: null, width: 1440, height: 900 } })
    expect(out.ok && out.image.png).toBeInstanceOf(Uint8Array)
    expect(h.store).not.toHaveBeenCalled()
  })

  it("browses in the site's language", async () => {
    const h = harness({ read: siteRead({ facts: facts({ language: 'de' }) }) })
    await getSiteCapture({ url: 'nimbus.example', principalId: null }, h.deps)
    const sent = String(h.fetch.mock.calls[0][0])
    expect(sent).toContain(`headers=${encodeURIComponent('Accept-Language:de,en;q=0.5')}`)
    expect(sent).toContain('ip_country_code=de')
  })
})

describe('captureUsage', () => {
  it("counts this month's calls", async () => {
    const h = harness({ now: Date.now() })
    await getSiteCapture({ url: 'acme.test', principalId: null }, h.deps)
    const usage = await captureUsage(Date.now(), { limits: LIMITS })
    expect(usage).toMatchObject({ used: 1, limit: 90 })
    expect(usage.month).toMatch(/^\d{4}-\d{2}$/)
  })
})
