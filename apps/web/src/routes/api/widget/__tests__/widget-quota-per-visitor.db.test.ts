/**
 * Real-Postgres coverage for the widget's public-endpoint limits.
 *
 * Each widget endpoint counts a request against the caller's address, the
 * caller's session and the whole workspace. The workspace count is shared by
 * every visitor, so it must sit well above one visitor's limit: one visitor
 * who searches or uploads in a burst is refused, and everyone else carries on.
 * The real limiter runs against the rate_bucket table inside a rolled-back
 * transaction; only the caller's address and the work behind the limit are
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { sql } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// The caller's address comes from the proxy headers in production; here each
// request names its own.
vi.mock('@/lib/server/domains/api/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/api/rate-limit')>()),
  getClientIp: (source: Request | Headers) =>
    (source instanceof Headers ? source : source.headers).get('x-test-ip') ?? 'unknown',
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: vi.fn(async () => ({ id: 'workspace_quota_test' })),
}))

vi.mock('@/lib/server/widget/widget-viewer', () => ({
  resolveWidgetViewer: vi.fn(async () => ({ type: 'anonymous' })),
}))

vi.mock('@/lib/server/domains/posts/post.public', () => ({
  listPublicPosts: vi.fn(async () => ({ items: [] })),
}))

vi.mock('@/lib/server/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async ({ headers }: { headers: Headers }) =>
        headers.get('authorization')
          ? // A well-formed id with no principal row: an anonymous visitor.
            { user: { id: (await import('@quackback/ids')).createId('user') }, session: {} }
          : null
      ),
    },
  },
}))

vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: () => true,
  uploadMediaFromFormData: vi.fn(async () => Response.json({ url: 'https://cdn.test/file.png' })),
}))

import { handleWidgetSearch } from '../search'
import { handleWidgetUpload } from '../upload'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.execute(sql`select workspace_key, key, count from rate_bucket limit 0`)
  },
})

if (fixture.available) {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

function search(ip: string, token?: string): Promise<Response> {
  return handleWidgetSearch({
    request: new Request('http://localhost/api/widget/search?q=export', {
      headers: { 'x-test-ip': ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }),
  })
}

function upload(ip: string, token: string): Promise<Response> {
  const body = new FormData()
  body.append('file', new File(['x'], 'shot.png', { type: 'image/png' }))
  return handleWidgetUpload({
    request: new Request('http://localhost/api/widget/upload', {
      method: 'POST',
      body,
      headers: { 'x-test-ip': ip, Authorization: `Bearer ${token}` },
    }),
  })
}

describe.skipIf(!fixture.available)('widget public-endpoint limits (real Postgres)', () => {
  beforeEach(async () => {
    await testDb.execute(
      sql`delete from rate_bucket where key like 'widget-search:%' or key like 'widget-upload:%'`
    )
  })

  it('refuses a signed-out visitor past 60 searches and leaves other visitors searching', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await search('198.51.100.1')).status).toBe(200)
    }
    const refused = await search('198.51.100.1')
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toBeTruthy()

    // Another signed-out visitor, and a signed-in one, still search.
    expect((await search('198.51.100.2')).status).toBe(200)
    expect((await search('198.51.100.3', 'visitor-token')).status).toBe(200)
  })

  it('a visitor who keeps searching after being refused never uses up the workspace', async () => {
    // Well past the workspace's 600 a minute, all from one address.
    for (let i = 0; i < 700; i++) await search('198.51.100.1')
    expect((await search('198.51.100.1')).status).toBe(429)

    expect((await search('198.51.100.2')).status).toBe(200)
  })

  it('refuses one widget session past 20 uploads and leaves other visitors uploading', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await upload('198.51.100.1', 'session-a')).status).toBe(200)
    }
    expect((await upload('198.51.100.1', 'session-a')).status).toBe(429)

    expect((await upload('198.51.100.2', 'session-b')).status).toBe(200)
  })

  it('still caps the whole workspace when many visitors search at once', async () => {
    // 600 a minute across the workspace: ten visitors at their own limit.
    for (let visitor = 0; visitor < 10; visitor++) {
      for (let i = 0; i < 60; i++) {
        expect((await search(`203.0.113.${visitor}`)).status).toBe(200)
      }
    }
    expect((await search('203.0.113.200')).status).toBe(429)
  })
})
