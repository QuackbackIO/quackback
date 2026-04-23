import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

/**
 * Configuration matrix tests for generatePresignedUploadUrl.
 *
 * Covers every supported deployment variation:
 *
 *   A. S3_PROXY=false, no S3_PUBLIC_URL  — local MinIO / Railway / AWS private bucket
 *      uploadUrl: presigned S3 PUT URL
 *      publicUrl: BASE_URL/api/storage/{key}  (presigned redirect)
 *
 *   B. S3_PROXY=false, S3_PUBLIC_URL set  — AWS public / Cloudflare R2 + CDN
 *      uploadUrl: presigned S3 PUT URL
 *      publicUrl: {S3_PUBLIC_URL}/{key}
 *
 *   C. S3_PROXY=true, no S3_PUBLIC_URL  — Docker self-hosted / ngrok
 *      uploadUrl: BASE_URL/api/storage/{key}?ct=…&exp=…&sig=…  (HMAC-signed proxy)
 *      publicUrl: BASE_URL/api/storage/{key}
 *
 *   D. S3_PROXY=true, S3_PUBLIC_URL set  — proxy uploads, CDN downloads
 *      uploadUrl: BASE_URL/api/storage/{key}?ct=…&exp=…&sig=…  (must NOT use CDN URL)
 *      publicUrl: {S3_PUBLIC_URL}/{key}
 */

// ── Shared mock config (mutated per test) ────────────────────────────────────

const mockConfig = {
  s3Bucket: 'my-bucket',
  s3Region: 'us-east-1',
  s3AccessKeyId: 'access-key',
  s3SecretAccessKey: 'secret-key',
  s3Endpoint: undefined as string | undefined,
  s3ForcePathStyle: false,
  s3PublicUrl: undefined as string | undefined,
  s3Proxy: false,
  baseUrl: 'https://app.example.com',
}

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

// ── Mock AWS SDK modules ─────────────────────────────────────────────────────

const mockGetSignedUrl = vi.fn(async (_client: unknown, cmd: { input: { Key: string } }) => {
  return `https://s3.amazonaws.com/my-bucket/${cmd.input.Key}?X-Amz-Signature=abc`
})

vi.mock('@aws-sdk/client-s3', () => ({
  // Must be a regular function (not arrow) so `new S3Client()` works
  S3Client: vi.fn(function () {
    return { send: vi.fn(), destroy: vi.fn() }
  }),
  PutObjectCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
  GetObjectCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
  DeleteObjectCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}))

const { generatePresignedUploadUrl } = await import('@/lib/server/storage/s3')

const KEY = 'uploads/abc123/photo.png'
const CT = 'image/png'

function verifySig(uploadUrl: string, key: string, ct: string, secret: string): boolean {
  const url = new URL(uploadUrl)
  const exp = Number(url.searchParams.get('exp'))
  const sig = url.searchParams.get('sig')
  if (!sig || !exp) return false
  const expected = createHmac('sha256', secret)
    .update(`${key}|${ct}|${exp}`)
    .digest('hex')
    .slice(0, 32)
  return sig === expected
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset to baseline (local MinIO / no proxy)
  mockConfig.s3Endpoint = undefined
  mockConfig.s3PublicUrl = undefined
  mockConfig.s3Proxy = false
  mockConfig.s3ForcePathStyle = false
  mockConfig.baseUrl = 'https://app.example.com'
})

// ── Case A: S3_PROXY=false, no S3_PUBLIC_URL ────────────────────────────────

describe('Case A — S3_PROXY=false, no S3_PUBLIC_URL (local MinIO / Railway / AWS private)', () => {
  it('returns a presigned S3 PUT URL', async () => {
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(uploadUrl).toContain('s3.amazonaws.com')
    expect(uploadUrl).toContain('X-Amz-Signature')
    expect(mockGetSignedUrl).toHaveBeenCalledOnce()
  })

  it('returns a BASE_URL/api/storage publicUrl (presigned redirect route)', async () => {
    const { publicUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(publicUrl).toBe(`https://app.example.com/api/storage/${KEY}`)
  })

  it('strips trailing slash from BASE_URL', async () => {
    mockConfig.baseUrl = 'https://app.example.com/'
    const { publicUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(publicUrl).toBe(`https://app.example.com/api/storage/${KEY}`)
  })

  it('works with MinIO endpoint (S3_FORCE_PATH_STYLE=true)', async () => {
    mockConfig.s3Endpoint = 'http://minio:9000'
    mockConfig.s3ForcePathStyle = true
    const { uploadUrl, publicUrl } = await generatePresignedUploadUrl(KEY, CT)
    // Upload still goes through SDK (presigned MinIO URL)
    expect(mockGetSignedUrl).toHaveBeenCalledOnce()
    // Public URL still routes through the app
    expect(publicUrl).toBe(`https://app.example.com/api/storage/${KEY}`)
    // uploadUrl is whatever the SDK mock returned (simulating a MinIO presigned URL)
    expect(uploadUrl).toContain('X-Amz-Signature')
  })
})

// ── Case B: S3_PROXY=false, S3_PUBLIC_URL set ────────────────────────────────

describe('Case B — S3_PROXY=false, S3_PUBLIC_URL set (AWS public / Cloudflare R2 + CDN)', () => {
  beforeEach(() => {
    mockConfig.s3PublicUrl = 'https://cdn.example.com'
  })

  it('returns a presigned S3 PUT URL', async () => {
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(uploadUrl).toContain('X-Amz-Signature')
    expect(mockGetSignedUrl).toHaveBeenCalledOnce()
  })

  it('returns an S3_PUBLIC_URL-based publicUrl', async () => {
    const { publicUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(publicUrl).toBe(`https://cdn.example.com/${KEY}`)
  })

  it('strips trailing slash from S3_PUBLIC_URL', async () => {
    mockConfig.s3PublicUrl = 'https://cdn.example.com/'
    const { publicUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(publicUrl).toBe(`https://cdn.example.com/${KEY}`)
  })

  it('works with Cloudflare R2 endpoint and CDN public URL', async () => {
    mockConfig.s3Endpoint = 'https://account-id.r2.cloudflarestorage.com'
    mockConfig.s3ForcePathStyle = true
    mockConfig.s3PublicUrl = 'https://assets.myapp.com'
    const { uploadUrl, publicUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(mockGetSignedUrl).toHaveBeenCalledOnce()
    expect(publicUrl).toBe(`https://assets.myapp.com/${KEY}`)
    expect(uploadUrl).toContain('X-Amz-Signature')
  })
})

// ── Case C: S3_PROXY=true, no S3_PUBLIC_URL ──────────────────────────────────

describe('Case C — S3_PROXY=true, no S3_PUBLIC_URL (Docker self-hosted / ngrok)', () => {
  beforeEach(() => {
    mockConfig.s3Proxy = true
  })

  it('returns a proxy upload URL (not a presigned S3 URL)', async () => {
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(uploadUrl).toContain('/api/storage/')
    expect(uploadUrl).not.toContain('X-Amz-Signature')
    expect(mockGetSignedUrl).not.toHaveBeenCalled()
  })

  it('upload URL is rooted at BASE_URL, not at the S3 endpoint', async () => {
    mockConfig.s3Endpoint = 'http://minio:9000'
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(uploadUrl.startsWith('https://app.example.com/api/storage/')).toBe(true)
    expect(uploadUrl).not.toContain('minio')
  })

  it('upload URL contains ct, exp, and sig query params', async () => {
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    const url = new URL(uploadUrl)
    expect(url.searchParams.get('ct')).toBe(CT)
    expect(Number(url.searchParams.get('exp'))).toBeGreaterThan(Date.now())
    expect(url.searchParams.get('sig')).toHaveLength(32)
  })

  it('upload URL HMAC signature is valid', async () => {
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(verifySig(uploadUrl, KEY, CT, 'secret-key')).toBe(true)
  })

  it('returns a BASE_URL/api/storage publicUrl', async () => {
    const { publicUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(publicUrl).toBe(`https://app.example.com/api/storage/${KEY}`)
  })

  it('strips trailing slash from BASE_URL in both upload and public URLs', async () => {
    mockConfig.baseUrl = 'https://app.example.com/'
    const { uploadUrl, publicUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(uploadUrl.startsWith('https://app.example.com/api/storage/')).toBe(true)
    expect(publicUrl).toBe(`https://app.example.com/api/storage/${KEY}`)
  })

  it('upload URL encodes content-type correctly', async () => {
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, 'image/svg+xml')
    expect(new URL(uploadUrl).searchParams.get('ct')).toBe('image/svg+xml')
  })

  it('token expiry defaults to 15 minutes', async () => {
    const before = Date.now() + 900 * 1000
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    const after = Date.now() + 900 * 1000
    const exp = Number(new URL(uploadUrl).searchParams.get('exp'))
    expect(exp).toBeGreaterThanOrEqual(before)
    expect(exp).toBeLessThanOrEqual(after)
  })

  it('respects a custom expiresIn', async () => {
    const before = Date.now() + 60 * 1000
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT, 60)
    const after = Date.now() + 60 * 1000
    const exp = Number(new URL(uploadUrl).searchParams.get('exp'))
    expect(exp).toBeGreaterThanOrEqual(before)
    expect(exp).toBeLessThanOrEqual(after)
  })
})

// ── Case D: S3_PROXY=true, S3_PUBLIC_URL set ─────────────────────────────────

describe('Case D — S3_PROXY=true, S3_PUBLIC_URL set (proxy uploads, CDN downloads)', () => {
  beforeEach(() => {
    mockConfig.s3Proxy = true
    mockConfig.s3PublicUrl = 'https://cdn.example.com'
  })

  it('upload URL points at BASE_URL/api/storage, not at the CDN', async () => {
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(uploadUrl.startsWith('https://app.example.com/api/storage/')).toBe(true)
    expect(uploadUrl).not.toContain('cdn.example.com')
  })

  it('public URL (for downloads) uses S3_PUBLIC_URL', async () => {
    const { publicUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(publicUrl).toBe(`https://cdn.example.com/${KEY}`)
  })

  it('upload URL HMAC is still valid (signed against correct key path)', async () => {
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(verifySig(uploadUrl, KEY, CT, 'secret-key')).toBe(true)
  })

  it('does not call getSignedUrl', async () => {
    await generatePresignedUploadUrl(KEY, CT)
    expect(mockGetSignedUrl).not.toHaveBeenCalled()
  })
})
