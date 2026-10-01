/**
 * The storage route end to end for pipeline files: links minted by the real
 * signer are served, the non-expiring token is refused for `files/` keys, an
 * expired link is refused, and a proxied response is never cached privately
 * for longer than the link stays valid. Only the object store is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

const mockConfig = vi.hoisted(() => ({
  s3Bucket: 'env-bucket',
  s3Region: 'env-region',
  s3AccessKeyId: 'env-access-key',
  s3SecretAccessKey: 'fixture-secret',
  s3ForcePathStyle: true,
  s3Proxy: false,
  baseUrl: 'https://app.example.com',
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const getS3Object = vi.hoisted(() =>
  vi.fn(async (_key: string, _range?: string) => ({
    body: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]).stream(),
    contentType: 'application/pdf',
    contentLength: 4,
  }))
)
vi.mock('@/lib/server/storage/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/storage/s3')>()),
  getS3Object,
  generatePresignedGetUrl: vi.fn(async () => 'https://bucket.example.com/presigned'),
}))

const { getPublicUrlOrNull } = await import('@/lib/server/storage/s3')
const { handleStorageGet } = await import('../$')

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 1, 9, 30)
const FILE_KEY = 'files/2026/10/0b5c3f43-8d0a-4c4e-9a59-2f1d1f6c1a11-report.pdf'
const LEGACY_KEY = 'attachments/2026/08/contract.pdf'

const get = (path: string) =>
  handleStorageGet({ request: new Request(`https://app.example.com${path}`) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  getS3Object.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/storage/files/… read links', () => {
  it('serves a minted link', async () => {
    const res = await get(`${getPublicUrlOrNull(FILE_KEY)}&proxy=1`)
    expect(res.status).toBe(200)
    expect(getS3Object).toHaveBeenCalledWith(FILE_KEY)
  })

  it('refuses the non-expiring token for a files/ key', async () => {
    const legacy = createHmac('sha256', 'fixture-secret')
      .update(`read|${FILE_KEY}`)
      .digest('hex')
      .slice(0, 32)
    const res = await get(`/api/storage/${FILE_KEY}?read=${legacy}&proxy=1`)
    expect(res.status).toBe(403)
    expect(getS3Object).not.toHaveBeenCalled()
  })

  it('refuses a link once it has expired', async () => {
    const url = getPublicUrlOrNull(FILE_KEY)!
    vi.setSystemTime(NOW + 32 * DAY)
    const res = await get(`${url}&proxy=1`)
    expect(res.status).toBe(403)
    expect(getS3Object).not.toHaveBeenCalled()
  })

  it('refuses a link whose exp was moved', async () => {
    const url = getPublicUrlOrNull(FILE_KEY)!
    const exp = new URL(url, 'https://x.invalid').searchParams.get('exp')!
    const res = await get(`${url.replace(`exp=${exp}`, `exp=${Number(exp) + DAY}`)}&proxy=1`)
    expect(res.status).toBe(403)
  })

  it('caches privately for an hour while the link has longer left', async () => {
    const res = await get(`${getPublicUrlOrNull(FILE_KEY)}&proxy=1`)
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600, immutable')
  })

  it('never caches past the moment the link expires', async () => {
    const url = getPublicUrlOrNull(FILE_KEY)!
    const exp = Number(new URL(url, 'https://x.invalid').searchParams.get('exp'))
    vi.setSystemTime(exp - 600_500)
    const res = await get(`${url}&proxy=1`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=600, immutable')
  })

  it('keeps the redirect uncached', async () => {
    const res = await get(getPublicUrlOrNull(FILE_KEY)!)
    expect(res.status).toBe(302)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('GET /api/storage for other private prefixes', () => {
  it('keeps the non-expiring token and the hour-long private cache', async () => {
    const url = getPublicUrlOrNull(LEGACY_KEY)!
    expect(url).not.toContain('exp=')
    vi.setSystemTime(NOW + 400 * DAY)
    const res = await get(`${url}&proxy=1`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600, immutable')
  })
})
