/**
 * Proxied storage responses carry caller-influenced Content-Types (the upload
 * path stores the declared multipart type), so every proxy response must send
 * X-Content-Type-Options: nosniff — including the in-memory cache hit and the
 * ?email=1 forced-proxy path, which is reachable on every deployment
 * regardless of S3_PROXY.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = { s3Proxy: false }

const getS3Object = vi.fn(
  async (
    _key: string,
    _range?: string
  ): Promise<{
    body: ReadableStream<Uint8Array>
    contentType: string
    contentLength?: number
    contentRange?: string
    acceptRanges?: string
  }> => ({
    body: new Blob([new Uint8Array([0x47, 0x49, 0x46])]).stream(),
    contentType: 'image/gif',
  })
)

const generatePresignedGetUrl = vi.fn(
  async (_key: string, _expiresIn?: number, _downloadName?: string, _contentType?: string) =>
    'https://s3.example.com/presigned'
)

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: vi.fn(() => true),
  getStorageSigningSecret: vi.fn(() => 'test-secret'),
  isPublicStorageKey: vi.fn((key: string) => key.startsWith('logos/')),
  verifyStorageReadToken: vi.fn(
    (_secret: string, _key: string, sig: string | null) => sig === 'ok'
  ),
  getS3Object,
  generatePresignedGetUrl,
  StorageUnavailableError: class StorageUnavailableError extends Error {},
}))

const { handleStorageGet } = await import('../$')

const get = (path: string) =>
  handleStorageGet({ request: new Request(`https://app.example.com${path}`) })

beforeEach(() => {
  mockConfig.s3Proxy = false
  getS3Object.mockClear()
  generatePresignedGetUrl.mockClear()
})

describe('handleStorageGet — a key that will not decode', () => {
  it('answers 400 rather than 500 for a malformed percent escape', async () => {
    // `decodeURIComponent` throws URIError on `%c0%ae`, and the decode sits
    // OUTSIDE this route's try/catch, so a caller-controlled path produced a
    // 500. It also meant the storage boundary's own "malformed
    // percent-encoding" refusal was unreachable from the one route that
    // decodes — the refusal existed and nothing could ever reach it.
    for (const path of ['/api/storage/%c0%ae', '/api/storage/logos/%', '/api/storage/logos/%2']) {
      const res = await get(path)
      expect(res.status, path).toBe(400)
      await expect(res.json(), path).resolves.toEqual({ error: 'Invalid storage key' })
    }
    expect(getS3Object).not.toHaveBeenCalled()
  })

  it('still serves a key that decodes', async () => {
    // The positive control: without it the assertion above passes against a
    // route that 400s on everything.
    mockConfig.s3Proxy = true
    const res = await get('/api/storage/logos/decodes%20fine.gif')
    expect(res.status).toBe(200)
    expect(getS3Object).toHaveBeenCalledWith('logos/decodes fine.gif')
  })
})

describe('handleStorageGet — proxy response headers', () => {
  it('sends nosniff on proxied responses (S3_PROXY=true)', async () => {
    mockConfig.s3Proxy = true
    const res = await get('/api/storage/logos/fresh-proxy.gif')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('sends nosniff on the in-memory cache hit', async () => {
    mockConfig.s3Proxy = true
    await get('/api/storage/logos/cached.gif')
    const res = await get('/api/storage/logos/cached.gif')
    expect(getS3Object).toHaveBeenCalledTimes(1)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('sends nosniff on the ?email=1 forced-proxy path even without S3_PROXY', async () => {
    const res = await get('/api/storage/logos/email-embed.gif?email=1')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('still redirects to the presigned URL when not proxying', async () => {
    const res = await get('/api/storage/logos/redirect.gif')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://s3.example.com/presigned')
  })

  it('streams byte ranges for native video playback and seeking', async () => {
    mockConfig.s3Proxy = true
    getS3Object.mockResolvedValueOnce({
      body: new Blob([new Uint8Array([1, 2, 3, 4])]).stream(),
      contentType: 'video/mp4',
      contentLength: 4,
      contentRange: 'bytes 0-3/40',
      acceptRanges: 'bytes',
    })
    const res = await handleStorageGet({
      request: new Request('https://app.example.com/api/storage/logos/recording.mp4', {
        headers: { Range: 'bytes=0-3' },
      }),
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 0-3/40')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(getS3Object).toHaveBeenCalledWith('logos/recording.mp4', 'bytes=0-3')
  })

  it('rejects multipart byte ranges instead of buffering them', async () => {
    mockConfig.s3Proxy = true
    const res = await handleStorageGet({
      request: new Request('https://app.example.com/api/storage/logos/recording.mp4', {
        headers: { Range: 'bytes=0-3,8-11' },
      }),
    })
    expect(res.status).toBe(416)
    expect(getS3Object).not.toHaveBeenCalled()
  })

  it('rejects a private object when only its key is known', async () => {
    const res = await get('/api/storage/chat-images/private.gif')
    expect(res.status).toBe(403)
    expect(getS3Object).not.toHaveBeenCalled()
  })

  it('serves a private object carrying a valid read capability', async () => {
    mockConfig.s3Proxy = true
    const res = await get('/api/storage/chat-images/private.gif?read=ok')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('private')
  })
})

describe('handleStorageGet — the three states a caller must tell apart', () => {
  it('answers 404 for an object that is not there, not 500', async () => {
    getS3Object.mockRejectedValueOnce(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }))
    mockConfig.s3Proxy = true
    const res = await handleStorageGet({
      request: new Request('http://localhost/api/storage/logos/missing.png'),
    })
    expect(res.status).toBe(404)
  })

  it('still answers 500 for a fault that is not a missing object', async () => {
    // The discriminator. Without this the 404 branch could swallow everything
    // and the test above would pass for the wrong reason.
    getS3Object.mockRejectedValueOnce(new Error('connection reset'))
    mockConfig.s3Proxy = true
    const res = await handleStorageGet({
      request: new Request('http://localhost/api/storage/logos/broken.png'),
    })
    expect(res.status).toBe(500)
  })
})

describe('handleStorageGet: what a stored file may do when opened', () => {
  // A stored file's Content-Type comes from whoever sent it (an inbound email
  // declares its own). Proxied, it is served from this origin, so anything a
  // browser could run is a download, sandboxed, never a page.
  // Each test names its own key: the proxy cache lives for the module.
  const htmlKey = (name: string) => `chat-files/2026/09/3f2b8c1e-1a2b-4c3d-9e8f-0123456789ab-${name}.html`
  const HTML_KEY = htmlKey('invoice')
  const htmlObject = () => ({
    body: new Blob(['<script>alert(1)</script>']).stream(),
    contentType: 'text/html',
  })

  it('serves a proxied HTML file as a sandboxed download', async () => {
    mockConfig.s3Proxy = true
    getS3Object.mockImplementationOnce(async () => htmlObject())

    const res = await get(`/api/storage/${HTML_KEY}?read=ok`)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="invoice.html"')
    expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('keeps it a download when served from the proxy cache', async () => {
    mockConfig.s3Proxy = true
    const key = htmlKey('cached')
    getS3Object.mockImplementationOnce(async () => htmlObject())
    await get(`/api/storage/${key}?read=ok`)

    const cached = await get(`/api/storage/${key}?read=ok`)

    expect(getS3Object).toHaveBeenCalledTimes(1)
    expect(cached.headers.get('content-disposition')).toBe('attachment; filename="cached.html"')
    expect(cached.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
  })

  it('keeps it a download on a range request', async () => {
    mockConfig.s3Proxy = true
    getS3Object.mockImplementationOnce(async () => ({ ...htmlObject(), contentRange: 'bytes 0-9/26' }))

    const res = await new Promise<Response>((resolve) =>
      resolve(
        handleStorageGet({
          request: new Request(`https://app.example.com/api/storage/${htmlKey('ranged')}?read=ok`, {
            headers: { range: 'bytes=0-9' },
          }),
        })
      )
    )

    expect(res.headers.get('content-disposition')).toBe('attachment; filename="ranged.html"')
    expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
  })

  it('keeps it a download on the forced email proxy, whatever S3_PROXY says', async () => {
    getS3Object.mockImplementationOnce(async () => htmlObject())
    const res = await get(`/api/storage/${htmlKey('emailed')}?read=ok&email=1`)
    expect(getS3Object).toHaveBeenCalledTimes(1)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="emailed.html"')
  })

  it('still shows a proxied image inline', async () => {
    mockConfig.s3Proxy = true
    const res = await get('/api/storage/logos/2026/09/brand-inline.gif')
    expect(res.headers.get('content-type')).toBe('image/gif')
    expect(res.headers.get('content-disposition')).toBeNull()
  })

  it('redirects a non-media file to a download', async () => {
    const res = await get(`/api/storage/${HTML_KEY}?read=ok`)
    expect(res.status).toBe(302)
    expect(generatePresignedGetUrl).toHaveBeenCalledWith(HTML_KEY, undefined, 'invoice.html', undefined)
  })

  it('redirects a media file with its type forced from the extension', async () => {
    const key = 'chat-files/2026/09/3f2b8c1e-1a2b-4c3d-9e8f-0123456789ab-report.pdf'
    await get(`/api/storage/${key}?read=ok`)
    expect(generatePresignedGetUrl).toHaveBeenCalledWith(key, undefined, undefined, 'application/pdf')
  })
})
