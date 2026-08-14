import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

/**
 * Configuration matrix tests for generatePresignedUploadUrl.
 *
 * Browser uploads are always a same-origin `/api/storage/{key}` PUT. Persist
 * is the same path with no query. Object-store hosts, CDNs, BASE_URL, and a
 * friendly platform URL must not appear on either URL.
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

/**
 * The self-hosted install's own workspace. Storage composes every object name
 * from `settings.id`, which an unscoped process reads from the one database it
 * has — so these deployment-matrix cases need that read to answer.
 */
const LOCAL_WORKSPACE = 'workspace_01kzf9848he8h86ct48hanask6'
vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: async () => ({ id: LOCAL_WORKSPACE }) } } },
}))

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

const KEY = 'post-images/abc123/photo.png'
const CT = 'image/png'

function parseUpload(uploadUrl: string): URL {
  return new URL(uploadUrl, 'https://workspace.test')
}

function verifySig(uploadUrl: string, key: string, ct: string, secret: string): boolean {
  const url = parseUpload(uploadUrl)
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

describe('browser uploads stay on /api/storage', () => {
  it('returns a same-origin PUT target, not a presigned object-store URL', async () => {
    const { uploadUrl, key } = await generatePresignedUploadUrl(KEY, CT)
    expect(uploadUrl.startsWith(`/api/storage/${KEY}?`)).toBe(true)
    expect(uploadUrl).not.toContain('s3.amazonaws.com')
    expect(uploadUrl).not.toContain('X-Amz-Signature')
    expect(mockGetSignedUrl).not.toHaveBeenCalled()
    expect(key).toBe(KEY)
  })

  it('returns a host-independent /api/storage publicUrl', async () => {
    const { publicUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(publicUrl).toBe(`/api/storage/${KEY}`)
  })

  it('does not bake BASE_URL, a friendly host, or a CDN into either URL', async () => {
    mockConfig.baseUrl = 'https://acme.quackback.co.uk/'
    mockConfig.s3PublicUrl = 'https://cdn.example.com/'
    mockConfig.s3Endpoint = 'http://minio:9000'
    const { uploadUrl, publicUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(uploadUrl.startsWith(`/api/storage/${KEY}?`)).toBe(true)
    expect(publicUrl).toBe(`/api/storage/${KEY}`)
    expect(uploadUrl).not.toContain('acme.quackback.co.uk')
    expect(uploadUrl).not.toContain('cdn.example.com')
    expect(uploadUrl).not.toContain('minio')
    expect(publicUrl).not.toContain('acme.quackback.co.uk')
    expect(publicUrl).not.toContain('cdn.example.com')
  })

  it('stays relative after a friendly URL rename', async () => {
    mockConfig.baseUrl = 'https://ws-abc123.quackback.co.uk'
    const before = await generatePresignedUploadUrl(KEY, CT)
    mockConfig.baseUrl = 'https://north7f3a2b.quackback.co.uk'
    const after = await generatePresignedUploadUrl(KEY, CT)
    expect(before.uploadUrl.split('?')[0]).toBe(`/api/storage/${KEY}`)
    expect(after.uploadUrl.split('?')[0]).toBe(`/api/storage/${KEY}`)
    expect(before.publicUrl).toBe(after.publicUrl)
  })

  it('upload URL contains ct, exp, and sig query params', async () => {
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    const url = parseUpload(uploadUrl)
    expect(url.searchParams.get('ct')).toBe(CT)
    expect(Number(url.searchParams.get('exp'))).toBeGreaterThan(Date.now())
    expect(url.searchParams.get('sig')).toHaveLength(32)
  })

  it('upload URL HMAC signature is valid', async () => {
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    expect(verifySig(uploadUrl, KEY, CT, 'secret-key')).toBe(true)
  })

  it('upload URL encodes content-type correctly', async () => {
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, 'image/svg+xml')
    expect(parseUpload(uploadUrl).searchParams.get('ct')).toBe('image/svg+xml')
  })

  it('token expiry defaults to 15 minutes', async () => {
    const before = Date.now() + 900 * 1000
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT)
    const after = Date.now() + 900 * 1000
    const exp = Number(parseUpload(uploadUrl).searchParams.get('exp'))
    expect(exp).toBeGreaterThanOrEqual(before)
    expect(exp).toBeLessThanOrEqual(after)
  })

  it('respects a custom expiresIn', async () => {
    const before = Date.now() + 60 * 1000
    const { uploadUrl } = await generatePresignedUploadUrl(KEY, CT, 60)
    const after = Date.now() + 60 * 1000
    const exp = Number(parseUpload(uploadUrl).searchParams.get('exp'))
    expect(exp).toBeGreaterThanOrEqual(before)
    expect(exp).toBeLessThanOrEqual(after)
  })

  it('does not call getSignedUrl when S3_PUBLIC_URL is set', async () => {
    mockConfig.s3PublicUrl = 'https://cdn.example.com'
    await generatePresignedUploadUrl(KEY, CT)
    expect(mockGetSignedUrl).not.toHaveBeenCalled()
  })
})
