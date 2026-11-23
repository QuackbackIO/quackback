import { describe, it, expect, vi, beforeEach } from 'vitest'

const MAX_FILE_SIZE = 5 * 1024 * 1024

const mockIsS3Usable = vi.fn(() => true)
const mockGetStorageSigningSecret = vi.fn(() => 'test-secret')
const mockUploadObject = vi.fn(async () => {})
const mockVerifyProxyUploadToken = vi.fn(() => true)

vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: mockIsS3Usable,
  getStorageSigningSecret: mockGetStorageSigningSecret,
  uploadObject: mockUploadObject,
  verifyProxyUploadToken: mockVerifyProxyUploadToken,
  isAllowedImageType: (t: string) =>
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'].includes(t),
  MAX_FILE_SIZE,
}))

const { handleProxyUpload } = await import('../$.js')

const KEY = 'avatars/2024/01/abc123-photo.png'
const CT = 'image/png'
// Bodies must carry real magic bytes — the handler sniffs them against `ct`.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function makeUrl(key = KEY, ct = CT) {
  const url = new URL(`http://localhost/api/storage/${key}`)
  url.searchParams.set('ct', ct)
  url.searchParams.set('exp', String(Date.now() + 60_000))
  url.searchParams.set('sig', 'mock-sig')
  return url.toString()
}

function makeRequest(
  options: { key?: string; body?: BodyInit; ct?: string; urlOverride?: string } = {}
): Request {
  const url = options.urlOverride ?? makeUrl(options.key, options.ct)
  return new Request(url, {
    method: 'PUT',
    body: options.body ?? PNG_BYTES,
    headers: { 'Content-Type': options.ct ?? CT },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsS3Usable.mockReturnValue(true)
  mockGetStorageSigningSecret.mockReturnValue('test-secret')
  mockVerifyProxyUploadToken.mockReturnValue(true)
  mockUploadObject.mockResolvedValue(undefined)
})

describe('PUT /api/storage/* (proxy upload)', () => {
  it('returns 503 when this workspace’s storage is not usable', async () => {
    // 503, not 403. "This deployment does not do proxy uploads" is a permanent
    // policy answer; "this workspace's storage credentials do not resolve" is a
    // configuration outage an operator can fix, and reporting the second as the
    // first tells the caller to stop asking.
    mockIsS3Usable.mockReturnValue(false)
    const res = await handleProxyUpload({ request: makeRequest() })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Storage not configured' })
  })

  it('returns 400 when content-type is missing', async () => {
    const url = new URL(`http://localhost/api/storage/${KEY}`)
    url.searchParams.set('exp', String(Date.now() + 60_000))
    url.searchParams.set('sig', 'mock-sig')
    const res = await handleProxyUpload({ request: makeRequest({ urlOverride: url.toString() }) })
    expect(res.status).toBe(400)
  })

  it('returns 400 for a path-traversal key', async () => {
    const url = `http://localhost/api/storage/..%2F..%2Fetc%2Fpasswd`
    const res = await handleProxyUpload({ request: makeRequest({ urlOverride: url }) })
    expect(res.status).toBe(400)
  })

  it('returns 401 when token verification fails', async () => {
    mockVerifyProxyUploadToken.mockReturnValue(false)
    const res = await handleProxyUpload({ request: makeRequest() })
    expect(res.status).toBe(401)
  })

  it('returns 413 when body exceeds MAX_FILE_SIZE without buffering the full payload', async () => {
    // Stream is cancelled as soon as the byte count exceeds the limit,
    // so the handler never holds more than MAX_FILE_SIZE bytes in memory.
    const oversized = new Uint8Array(MAX_FILE_SIZE + 1)
    const res = await handleProxyUpload({ request: makeRequest({ body: oversized }) })
    expect(res.status).toBe(413)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  it('uploads to the correct key and returns 200', async () => {
    const res = await handleProxyUpload({ request: makeRequest() })
    expect(res.status).toBe(200)
    expect(mockUploadObject).toHaveBeenCalledWith(KEY, expect.any(Uint8Array), CT)
  })

  it('rejects bytes that do not match the signed image content-type', async () => {
    // The token authenticates (key, ct), not the bytes — HTML under an
    // image/png label must not reach storage.
    const html = new Uint8Array([...'<html><script>x</script>'].map((c) => c.charCodeAt(0)))
    const res = await handleProxyUpload({ request: makeRequest({ body: html }) })
    expect(res.status).toBe(400)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  it('rejects a non-image signed content-type outright', async () => {
    const res = await handleProxyUpload({ request: makeRequest({ ct: 'text/html' }) })
    expect(res.status).toBe(400)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })

  it('passes the narrowed signing secret to verifyProxyUploadToken', async () => {
    // The route used to take `getS3Config()` and read one field off it, which
    // handed an unauthenticated surface a bucket name and a credential for the
    // sake of an HMAC. It now receives the secret and nothing else.
    mockGetStorageSigningSecret.mockReturnValue('my-secret')
    await handleProxyUpload({ request: makeRequest() })
    expect(mockVerifyProxyUploadToken).toHaveBeenCalledWith(
      'my-secret',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String)
    )
  })

  describe('portal fonts', () => {
    const FONT_KEY = 'fonts/2026/10/abc-brand.woff2'
    const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0])
    const font = (over: { key?: string; ct?: string; body?: Uint8Array } = {}) =>
      handleProxyUpload({
        request: makeRequest({
          key: over.key ?? FONT_KEY,
          ct: over.ct ?? 'font/woff2',
          body: (over.body ?? WOFF2) as BodyInit,
        }),
      })

    it('stores a font whose name, type and signature agree', async () => {
      const res = await font()
      expect(res.status).toBe(200)
      expect(mockUploadObject).toHaveBeenCalledTimes(1)
    })

    it('rejects a font type whose bytes are something else', async () => {
      expect((await font({ body: PNG_BYTES })).status).toBe(400)
      expect(mockUploadObject).not.toHaveBeenCalled()
    })

    it('rejects a font outside fonts/ or with another extension', async () => {
      expect((await font({ key: 'avatars/2026/10/abc-brand.woff2' })).status).toBe(400)
      expect((await font({ key: 'fonts/2026/10/abc-brand.ttf' })).status).toBe(400)
      expect(mockUploadObject).not.toHaveBeenCalled()
    })

    it('rejects a font over its format cap', async () => {
      const big = new Uint8Array(400 * 1024 + 1)
      big.set(WOFF2)
      expect((await font({ body: big })).status).toBe(413)
      expect(mockUploadObject).not.toHaveBeenCalled()
    })
  })
})

describe('PUT /api/storage/* (an SVG wide logo)', () => {
  const SVG_KEY = 'header-logos/2026/11/abc-wordmark.svg'
  const SVG_CT = 'image/svg+xml'
  const encode = (text: string) => new TextEncoder().encode(text)
  const hostile =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 10" onload="alert(1)">' +
    '<script>alert(2)</script><foreignObject><div>x</div></foreignObject>' +
    '<image href="https://evil.test/x.png"/><path d="M0 0h40v10H0z" fill="#123456"/></svg>'

  const stored = () => {
    const call = mockUploadObject.mock.calls[0] as unknown as [string, Uint8Array, string]
    return { key: call[0], text: new TextDecoder().decode(call[1]), ct: call[2] }
  }

  it('stores the sanitised markup, not the bytes sent', async () => {
    const res = await handleProxyUpload({
      request: makeRequest({ key: SVG_KEY, ct: SVG_CT, body: encode(hostile) }),
    })
    expect(res.status).toBe(200)
    const { key, text, ct } = stored()
    expect(key).toBe(SVG_KEY)
    expect(ct).toBe(SVG_CT)
    expect(text).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 10"><path d="M0 0h40v10H0z" fill="#123456"/></svg>'
    )
  })

  it('refuses an SVG outside header-logos/', async () => {
    for (const key of ['logos/2026/11/abc-mark.svg', 'avatars/x.svg', 'files/header-logos/x.svg']) {
      mockUploadObject.mockClear()
      const res = await handleProxyUpload({
        request: makeRequest({ key, ct: SVG_CT, body: encode(hostile) }),
      })
      expect(res.status, key).toBe(400)
      expect(mockUploadObject, key).not.toHaveBeenCalled()
    }
  })

  it('refuses markup the sanitiser cannot read, saying why in words for people', async () => {
    for (const body of ['<html><script>x</script></html>', '<svg viewBox="0 0 1 1"><g>', '']) {
      mockUploadObject.mockClear()
      const res = await handleProxyUpload({
        request: makeRequest({ key: SVG_KEY, ct: SVG_CT, body: encode(body) }),
      })
      expect(res.status, body).toBe(400)
      expect(await res.json(), body).toEqual({
        code: 'SVG_NOT_SAFE',
        error: "This SVG can't be used. Try a PNG or a simpler SVG.",
      })
      expect(mockUploadObject, body).not.toHaveBeenCalled()
    }
  })

  it('refuses a raster image signed as an SVG', async () => {
    const res = await handleProxyUpload({
      request: makeRequest({ key: SVG_KEY, ct: SVG_CT, body: PNG_BYTES }),
    })
    expect(res.status).toBe(400)
    expect(mockUploadObject).not.toHaveBeenCalled()
  })
})
