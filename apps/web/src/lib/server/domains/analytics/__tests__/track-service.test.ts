// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockValues = vi.fn().mockResolvedValue(undefined)
const mockInsert = vi.fn(() => ({ values: mockValues }))
vi.mock('@/lib/server/db', () => ({
  db: { insert: mockInsert },
  pageViews: {},
}))

const mockIncrementBucket = vi.fn()
vi.mock('@/lib/server/utils/redis-rate-bucket', () => ({
  incrementBucket: mockIncrementBucket,
}))

const mockGetDailySalt = vi.fn()
vi.mock('../visitor-hash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../visitor-hash')>()
  return { ...actual, getDailySalt: mockGetDailySalt }
})

const mockIsFeatureEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

const { recordPageView } = await import('../track.service')

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
  ua: string | null = CHROME_UA
): Request {
  const h = new Headers(headers)
  if (ua) h.set('user-agent', ua)
  return new Request('http://localhost:3000/api/track', {
    method: 'POST',
    headers: h,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const validBeacon = {
  url: 'https://feedback.example.com/roadmap?utm_ignore=1',
  referrer: 'https://news.ycombinator.com/item?id=1',
  surface: 'portal',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockIncrementBucket.mockResolvedValue({ count: 1 })
  mockGetDailySalt.mockResolvedValue('test-salt')
})

describe('recordPageView', () => {
  it('inserts a derived row for a valid beacon and never raw identifiers', async () => {
    await recordPageView(makeRequest(validBeacon, { 'cf-ipcountry': 'DE' }))

    expect(mockValues).toHaveBeenCalledTimes(1)
    const row = mockValues.mock.calls[0][0]
    expect(row).toMatchObject({
      siteOrigin: 'https://feedback.example.com',
      surface: 'portal',
      path: '/roadmap',
      source: 'news.ycombinator.com',
      country: 'DE',
      device: 'desktop',
      browser: 'Chrome',
      os: 'Windows',
      deviceId: null,
    })
    expect(row.visitorHash).toMatch(/^[0-9a-f]{64}$/)
    const persisted = JSON.stringify(row)
    expect(persisted).not.toContain(CHROME_UA)
    expect(persisted).not.toContain('Mozilla')
  })

  it('prefers utm_source over the referrer for source', async () => {
    await recordPageView(
      makeRequest({
        ...validBeacon,
        url: 'https://feedback.example.com/?utm_source=newsletter',
      })
    )
    expect(mockValues.mock.calls[0][0].source).toBe('newsletter')
  })

  it('treats same-origin referrers as direct (null source)', async () => {
    await recordPageView(
      makeRequest({
        ...validBeacon,
        referrer: 'https://feedback.example.com/other',
      })
    )
    expect(mockValues.mock.calls[0][0].source).toBeNull()
  })

  it('drops bot traffic before touching Redis', async () => {
    await recordPageView(
      makeRequest(validBeacon, {}, 'Googlebot/2.1 (+http://www.google.com/bot.html)')
    )
    expect(mockIncrementBucket).not.toHaveBeenCalled()
    expect(mockValues).not.toHaveBeenCalled()
  })

  it('drops when UA is missing', async () => {
    await recordPageView(makeRequest(validBeacon, {}, null))
    expect(mockValues).not.toHaveBeenCalled()
  })

  it('honors DNT and GPC before reading anything', async () => {
    await recordPageView(makeRequest(validBeacon, { dnt: '1' }))
    await recordPageView(makeRequest(validBeacon, { 'sec-gpc': '1' }))
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
    expect(mockValues).not.toHaveBeenCalled()
  })

  it('drops when the visitorAnalytics flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    await recordPageView(makeRequest(validBeacon))
    expect(mockValues).not.toHaveBeenCalled()
  })

  it('drops when rate limited but proceeds when Redis fails open', async () => {
    mockIncrementBucket.mockResolvedValue({ count: 121 })
    await recordPageView(makeRequest(validBeacon))
    expect(mockValues).not.toHaveBeenCalled()

    mockIncrementBucket.mockResolvedValue({ count: null })
    await recordPageView(makeRequest(validBeacon))
    expect(mockValues).toHaveBeenCalledTimes(1)
  })

  it('drops invalid payloads silently', async () => {
    await recordPageView(makeRequest('not json'))
    await recordPageView(makeRequest({ ...validBeacon, url: 'notaurl' }))
    await recordPageView(makeRequest({ ...validBeacon, url: 'ftp://x.com/a' }))
    await recordPageView(makeRequest({ ...validBeacon, surface: 'email' }))
    await recordPageView(makeRequest('x'.repeat(3000)))
    expect(mockValues).not.toHaveBeenCalled()
  })

  it('drops when no salt is available (Redis down)', async () => {
    mockGetDailySalt.mockResolvedValue(null)
    await recordPageView(makeRequest(validBeacon))
    expect(mockValues).not.toHaveBeenCalled()
  })

  it('caps the device id and passes it through', async () => {
    await recordPageView(makeRequest({ ...validBeacon, deviceId: 'dev-123' }))
    expect(mockValues.mock.calls[0][0].deviceId).toBe('dev-123')

    mockValues.mockClear()
    await recordPageView(makeRequest({ ...validBeacon, deviceId: 'x'.repeat(200) }))
    expect(mockValues).not.toHaveBeenCalled()
  })

  it('swallows insert failures (missing partition) without throwing', async () => {
    mockValues.mockRejectedValueOnce(new Error('no partition for 2026-07-01'))
    await expect(recordPageView(makeRequest(validBeacon))).resolves.toBeUndefined()
  })
})
