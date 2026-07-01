/**
 * isTrustedAttachmentUrl gates which URLs may appear as conversation attachments and
 * inline chatImage srcs — anything else becomes a third-party fetch fired from
 * an agent's browser. The path-boundary cases matter most: on a path-style
 * object store, `/bucket` must not admit `/bucket-evil/...` (a sibling bucket
 * on the same host is attacker-creatable).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = {
  baseUrl: 'https://app.example.com',
  s3PublicUrl: undefined as string | undefined,
}

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const { isTrustedAttachmentUrl } = await import('@/lib/server/storage/trusted-url')

beforeEach(() => {
  mockConfig.baseUrl = 'https://app.example.com'
  mockConfig.s3PublicUrl = undefined
})

describe('isTrustedAttachmentUrl — app storage route', () => {
  it('accepts own-app /api/storage/ URLs (absolute and relative)', () => {
    expect(isTrustedAttachmentUrl('https://app.example.com/api/storage/x/y.png')).toBe(true)
    expect(isTrustedAttachmentUrl('/api/storage/x/y.png')).toBe(true)
  })

  it('rejects other hosts and non-http(s) schemes', () => {
    expect(isTrustedAttachmentUrl('https://evil.example.com/api/storage/x.png')).toBe(false)
    expect(isTrustedAttachmentUrl("javascript:'/api/storage/'")).toBe(false)
  })

  it('rejects dot-segment escapes out of the storage prefix', () => {
    expect(isTrustedAttachmentUrl('https://app.example.com/api/storage/../x.png')).toBe(false)
  })
})

describe('isTrustedAttachmentUrl — S3_PUBLIC_URL path boundary', () => {
  it('accepts objects under a path-style public URL', () => {
    mockConfig.s3PublicUrl = 'https://minio.example.com/app-bucket'
    expect(isTrustedAttachmentUrl('https://minio.example.com/app-bucket/2026/x.png')).toBe(true)
  })

  it('accepts objects when the public URL has a trailing slash', () => {
    mockConfig.s3PublicUrl = 'https://minio.example.com/app-bucket/'
    expect(isTrustedAttachmentUrl('https://minio.example.com/app-bucket/2026/x.png')).toBe(true)
  })

  it('rejects a sibling bucket whose name extends the configured one', () => {
    mockConfig.s3PublicUrl = 'https://minio.example.com/app-bucket'
    expect(isTrustedAttachmentUrl('https://minio.example.com/app-bucket-evil/x.png')).toBe(false)
  })

  it('rejects a sibling bucket when the public URL has a trailing slash', () => {
    mockConfig.s3PublicUrl = 'https://minio.example.com/app-bucket/'
    expect(isTrustedAttachmentUrl('https://minio.example.com/app-bucket-evil/x.png')).toBe(false)
  })

  it('accepts any path on a host-only public URL (virtual-hosted bucket)', () => {
    mockConfig.s3PublicUrl = 'https://cdn.example.com'
    expect(isTrustedAttachmentUrl('https://cdn.example.com/anything/x.png')).toBe(true)
  })

  it('still rejects other hosts when a public URL is configured', () => {
    mockConfig.s3PublicUrl = 'https://minio.example.com/app-bucket'
    expect(isTrustedAttachmentUrl('https://evil.example.com/app-bucket/x.png')).toBe(false)
  })
})
