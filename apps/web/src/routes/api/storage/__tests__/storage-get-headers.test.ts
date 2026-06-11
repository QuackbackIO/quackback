/**
 * Proxied storage responses carry caller-influenced Content-Types (the upload
 * path stores the declared multipart type), so every proxy response must send
 * X-Content-Type-Options: nosniff — including the in-memory cache hit and the
 * ?email=1 forced-proxy path, which is reachable on every deployment
 * regardless of S3_PROXY.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = { s3Proxy: false }

const getS3Object = vi.fn(async (_key: string) => ({
  body: new Blob([new Uint8Array([0x47, 0x49, 0x46])]).stream(),
  contentType: 'image/gif',
}))

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Configured: vi.fn(() => true),
  getS3Object,
  generatePresignedGetUrl: vi.fn(async () => 'https://s3.example.com/presigned'),
}))

const { handleStorageGet } = await import('../$')

const get = (path: string) =>
  handleStorageGet({ request: new Request(`https://app.example.com${path}`) })

beforeEach(() => {
  mockConfig.s3Proxy = false
  getS3Object.mockClear()
})

describe('handleStorageGet — proxy response headers', () => {
  it('sends nosniff on proxied responses (S3_PROXY=true)', async () => {
    mockConfig.s3Proxy = true
    const res = await get('/api/storage/widget-images/fresh-proxy.gif')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('sends nosniff on the in-memory cache hit', async () => {
    mockConfig.s3Proxy = true
    await get('/api/storage/widget-images/cached.gif')
    const res = await get('/api/storage/widget-images/cached.gif')
    expect(getS3Object).toHaveBeenCalledTimes(1)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('sends nosniff on the ?email=1 forced-proxy path even without S3_PROXY', async () => {
    const res = await get('/api/storage/widget-images/email-embed.gif?email=1')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('still redirects to the presigned URL when not proxying', async () => {
    const res = await get('/api/storage/widget-images/redirect.gif')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://s3.example.com/presigned')
  })
})
