/**
 * Download mode: `?download=1[&filename=…]` on a read link always answers as
 * an attachment, under the name asked for (made safe for a header) or the
 * key's own, on the proxy path and through the presigned redirect. It never
 * stands in for the read capability.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = { s3Proxy: false }

const getS3Object = vi.fn(async (_key: string, _range?: string) => ({
  body: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]).stream(),
  contentType: 'application/pdf',
  contentLength: 4,
}))

const generatePresignedGetUrl = vi.fn(
  async (_key: string, _expiresIn?: number, _downloadName?: string, _contentType?: string) =>
    'https://s3.example.com/presigned'
)

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: vi.fn(() => true),
  getStorageSigningSecret: vi.fn(() => 'test-secret'),
  isPublicStorageKey: vi.fn((key: string) => key.startsWith('logos/')),
  hasExpiringReadToken: vi.fn(() => false),
  verifyStorageReadToken: vi.fn(
    (_secret: string, _key: string, sig: string | null) => sig === 'ok'
  ),
  getS3Object,
  generatePresignedGetUrl,
  StorageUnavailableError: class StorageUnavailableError extends Error {},
}))

const { handleStorageGet } = await import('../$')

const KEY = 'attachments/2026/10/3f2b8c1e-1a2b-4c3d-9e8f-0123456789ab-report.pdf'

const get = (path: string) =>
  handleStorageGet({ request: new Request(`https://app.example.com${path}`) })

beforeEach(() => {
  mockConfig.s3Proxy = false
  getS3Object.mockClear()
  generatePresignedGetUrl.mockClear()
})

describe('download mode on the proxy path', () => {
  it('answers a type that would show inline as an attachment under the key name', async () => {
    const res = await get(`/api/storage/${KEY}?read=ok&proxy=1&download=1`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`
    )
    expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
  })

  it('uses the name asked for, made safe for a header', async () => {
    const name = encodeURIComponent('Q3 Réport "final"\r\nSet-Cookie: x=1.pdf')
    const res = await get(`/api/storage/${KEY}?read=ok&proxy=1&download=1&filename=${name}`)
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Q3 R_port finalSet-Cookie: x=1.pdf"; ` +
        `filename*=UTF-8''Q3%20R%C3%A9port%20finalSet-Cookie%3A%20x%3D1.pdf`
    )
  })

  it('drops path separators, bidirectional and invisible characters, and caps the length', async () => {
    const spoof = encodeURIComponent('..\\docs/Invoice‮xcod​.docm')
    const res = await get(`/api/storage/${KEY}?read=ok&proxy=1&download=1&filename=${spoof}`)
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="..docsInvoicexcod.docm"; filename*=UTF-8''..docsInvoicexcod.docm`
    )

    const long = encodeURIComponent('n'.repeat(400) + '.xlsx')
    const capped = await get(`/api/storage/${KEY}?read=ok&proxy=1&download=1&filename=${long}`)
    const ascii = /filename="([^"]*)"/.exec(capped.headers.get('content-disposition')!)![1]!
    expect(ascii).toHaveLength(255)
    expect(ascii.endsWith('.xlsx')).toBe(true)
  })

  it('falls back to the key name when the name asked for has nothing left', async () => {
    const res = await get(
      `/api/storage/${KEY}?read=ok&proxy=1&download=1&filename=${encodeURIComponent('‮/"')}`
    )
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`
    )
  })

  it('keeps the attachment on a cached response', async () => {
    // A key no other test reads: the proxy cache lives for the module.
    const cachedKey = 'attachments/2026/10/9d1e2f3a-1a2b-4c3d-9e8f-0123456789ab-cached.pdf'
    mockConfig.s3Proxy = true
    await get(`/api/storage/${cachedKey}?read=ok`)
    const res = await get(`/api/storage/${cachedKey}?read=ok&download=1`)
    expect(getS3Object).toHaveBeenCalledTimes(1)
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="cached.pdf"; filename*=UTF-8''cached.pdf`
    )
  })

  it('leaves the response inline without download=1', async () => {
    const res = await get(`/api/storage/${KEY}?read=ok&proxy=1&filename=x.pdf`)
    expect(res.headers.get('content-disposition')).toBeNull()
  })
})

describe('download mode on the redirect path', () => {
  it('presigns the attachment with the name asked for', async () => {
    const res = await get(
      `/api/storage/${KEY}?read=ok&download=1&filename=${encodeURIComponent('Q3 Réport.pdf')}`
    )
    expect(res.status).toBe(302)
    expect(generatePresignedGetUrl).toHaveBeenCalledWith(
      KEY,
      172_800,
      'Q3 Réport.pdf',
      'application/pdf'
    )
  })

  it('presigns under the key name without one', async () => {
    await get(`/api/storage/${KEY}?read=ok&download=1`)
    expect(generatePresignedGetUrl).toHaveBeenCalledWith(
      KEY,
      172_800,
      'report.pdf',
      'application/pdf'
    )
  })
})

describe('download mode needs the read capability', () => {
  it('refuses a private key without a valid capability, download or not', async () => {
    const res = await get(`/api/storage/${KEY}?read=bad&proxy=1&download=1&filename=x.pdf`)
    expect(res.status).toBe(403)
    expect(getS3Object).not.toHaveBeenCalled()
  })

  it('ignores download mode on a public key, which carries no capability', async () => {
    const res = await get('/api/storage/logos/2026/10/brand.pdf?proxy=1&download=1&filename=a.exe')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBeNull()
  })
})
