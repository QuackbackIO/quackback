import { describe, it, expect, vi, beforeEach } from 'vitest'

const MAX_FILE_SIZE = 5 * 1024 * 1024

const mockIsS3Configured = vi.fn(() => true)
const mockGetS3Config = vi.fn(() => ({ secretAccessKey: 'test-secret' }))
const mockUploadObject = vi.fn(async () => {})
const mockVerifyProxyUploadToken = vi.fn(() => true)

vi.mock('@/lib/server/storage/s3', () => ({
  isS3Configured: mockIsS3Configured,
  getS3Config: mockGetS3Config,
  uploadObject: mockUploadObject,
  verifyProxyUploadToken: mockVerifyProxyUploadToken,
  MAX_FILE_SIZE,
}))

// Mutable so individual tests can flip s3Proxy to false
const mockConfig = { s3Proxy: true }
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const { handleProxyUpload } = await import('../$.js')

const KEY = 'avatars/2024/01/abc123-photo.png'
const CT = 'image/png'

function makeUrl(key = KEY) {
  const url = new URL(`http://localhost/api/storage/${key}`)
  url.searchParams.set('ct', CT)
  url.searchParams.set('exp', String(Date.now() + 60_000))
  url.searchParams.set('sig', 'mock-sig')
  return url.toString()
}

function makeRequest(
  options: {
    key?: string
    body?: BodyInit
    contentLength?: number
    urlOverride?: string
  } = {}
): Request {
  const url = options.urlOverride ?? makeUrl(options.key)
  const headers: Record<string, string> = { 'Content-Type': CT }
  if (options.contentLength !== undefined) {
    headers['Content-Length'] = String(options.contentLength)
  }
  return new Request(url, {
    method: 'PUT',
    body: options.body ?? new Uint8Array(100),
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.s3Proxy = true
  mockIsS3Configured.mockReturnValue(true)
  mockGetS3Config.mockReturnValue({ secretAccessKey: 'test-secret' })
  mockVerifyProxyUploadToken.mockReturnValue(true)
  mockUploadObject.mockResolvedValue(undefined)
})

describe('PUT /api/storage/* (proxy upload)', () => {
  it('returns 403 when S3 is not configured', async () => {
    mockIsS3Configured.mockReturnValue(false)
    const res = await handleProxyUpload({ request: makeRequest() })
    expect(res.status).toBe(403)
  })

  it('returns 403 when S3_PROXY is disabled', async () => {
    mockConfig.s3Proxy = false
    const res = await handleProxyUpload({ request: makeRequest() })
    expect(res.status).toBe(403)
  })

  it('returns 413 when Content-Length header exceeds MAX_FILE_SIZE', async () => {
    const res = await handleProxyUpload({
      request: makeRequest({ contentLength: MAX_FILE_SIZE + 1 }),
    })
    expect(res.status).toBe(413)
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

  it('returns 413 when body exceeds MAX_FILE_SIZE even if Content-Length was absent', async () => {
    const oversized = new Uint8Array(MAX_FILE_SIZE + 1)
    const res = await handleProxyUpload({ request: makeRequest({ body: oversized }) })
    expect(res.status).toBe(413)
  })

  it('uploads to the correct key and returns 200', async () => {
    const res = await handleProxyUpload({ request: makeRequest() })
    expect(res.status).toBe(200)
    expect(mockUploadObject).toHaveBeenCalledWith(KEY, expect.any(Uint8Array), CT)
  })

  it('passes the secretAccessKey from getS3Config to verifyProxyUploadToken', async () => {
    mockGetS3Config.mockReturnValue({ secretAccessKey: 'my-secret' })
    await handleProxyUpload({ request: makeRequest() })
    expect(mockVerifyProxyUploadToken).toHaveBeenCalledWith(
      'my-secret',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String)
    )
  })
})
