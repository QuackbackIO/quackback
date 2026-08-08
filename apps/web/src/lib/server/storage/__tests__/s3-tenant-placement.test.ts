/**
 * Storage placement under a tenant scope.
 *
 * `contentJson` stores ABSOLUTE image URLs, so the origin a public URL is built
 * from is baked permanently into post, changelog and article content. Under
 * pooling the process-wide `S3_PUBLIC_URL` / `BASE_URL` are the wrong source:
 * they belong to whichever install configured the environment, and the
 * request's own host belongs to whichever hostname the visitor happened to
 * use. The tenant record pins one origin; that is the one that must win.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({
  config: {
    s3Bucket: 'env-bucket',
    s3Region: 'env-region',
    s3Endpoint: 'https://env-endpoint.example.net',
    s3AccessKeyId: 'env-access-key',
    s3SecretAccessKey: 'env-secret-key',
    s3ForcePathStyle: true,
    s3PublicUrl: 'https://env-cdn.example.net',
    s3Proxy: false,
    baseUrl: 'https://env-app.example.net',
  },
}))

const {
  getPublicUrlOrNull,
  getStoragePlacement,
  getS3Config,
  isS3Configured,
  isS3Usable,
  setStorageCredentialResolver,
} = await import('../s3')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')

// `logos/` is a public prefix; `attachments/` is not (unknown prefixes are private).
const PUBLIC_KEY = 'logos/2026/08/brand.png'
const PRIVATE_KEY = 'attachments/2026/08/contract.pdf'

/** The resolver is process-global; leave it unset unless a case installs one. */
beforeEach(() => setStorageCredentialResolver(null))

/**
 * A resolver that returns the SAME secret for every tenant — the pessimistic
 * case where the fleet shares one storage credential. The read token must still
 * be tenant-bound, because the object key alone does not say which bucket it
 * names.
 */
function installSharedSecretResolver(): void {
  setStorageCredentialResolver(() => ({
    accessKeyId: 'shared-key',
    secretAccessKey: 'shared-secret',
  }))
}

describe('public URLs', () => {
  it('uses the tenant pinned publicUrl, not the environment CDN', () => {
    const url = withTenant('tenant-alpha', () => getPublicUrlOrNull(PUBLIC_KEY))

    expect(url).toBe(`https://assets-tenant-alpha.example.com/${PUBLIC_KEY}`)
    expect(url).not.toContain('env-cdn.example.net')
  })

  it('gives two tenants different origins for the same key', () => {
    const alpha = withTenant('tenant-alpha', () => getPublicUrlOrNull(PUBLIC_KEY))
    const bravo = withTenant('tenant-bravo', () => getPublicUrlOrNull(PUBLIC_KEY))

    expect(alpha).toBe(`https://assets-tenant-alpha.example.com/${PUBLIC_KEY}`)
    expect(bravo).toBe(`https://assets-tenant-bravo.example.com/${PUBLIC_KEY}`)
  })

  it('falls back to the tenant base URL, never the environment BASE_URL', () => {
    const url = withTenant('tenant-alpha', () => getPublicUrlOrNull(PUBLIC_KEY), {
      storage: { publicUrl: '' },
    })

    expect(url).toBe(`https://tenant-alpha.example.com/api/storage/${PUBLIC_KEY}`)
    expect(url).not.toContain('env-app.example.net')
  })

  it('still uses the environment values with no tenant scope', () => {
    expect(getPublicUrlOrNull(PUBLIC_KEY)).toBe(`https://env-cdn.example.net/${PUBLIC_KEY}`)
  })

  it('routes private keys through the tenant origin with a read capability', () => {
    installSharedSecretResolver()
    const url = withTenant('tenant-alpha', () => getPublicUrlOrNull(PRIVATE_KEY))

    expect(url).toContain(`https://tenant-alpha.example.com/api/storage/${PRIVATE_KEY}?read=`)
  })

  it('signs a private key differently per tenant even on one shared secret', () => {
    installSharedSecretResolver()
    const alpha = withTenant('tenant-alpha', () => getPublicUrlOrNull(PRIVATE_KEY))
    const bravo = withTenant('tenant-bravo', () => getPublicUrlOrNull(PRIVATE_KEY))

    const sigOf = (url: string | null) => new URL(url!).searchParams.get('read')
    expect(sigOf(alpha)).toBeTruthy()
    expect(sigOf(alpha)).not.toBe(sigOf(bravo))
  })

  it('leaves the unscoped read signature byte-identical to the historical one', () => {
    // HMAC-SHA256('env-secret-key', 'read|<key>') truncated to 32 hex chars —
    // the message as it stood before tenancy. These signatures are embedded in
    // absolute URLs already written into stored content, so a changed message
    // is a fleet of dead asset links, not a migration.
    const url = getPublicUrlOrNull(PRIVATE_KEY)

    expect(new URL(url!).searchParams.get('read')).toBe('e5d708d10b754b004667a83a235584f6')
  })
})

describe('placement', () => {
  it('addresses the tenant bucket, not the environment bucket', () => {
    const placement = withTenant('tenant-alpha', () => getStoragePlacement())

    expect(placement.bucket).toBe('tenant-alpha-bucket')
    expect(placement.region).toBe('auto')
    expect(placement.forcePathStyle).toBe(false)
    expect(placement.endpoint).toBe('https://storage.example.com')
  })

  it('needs no credential resolver to address a bucket', () => {
    setStorageCredentialResolver(null)
    expect(() => withTenant('tenant-alpha', () => getStoragePlacement())).not.toThrow()
    expect(withTenant('tenant-alpha', () => isS3Configured())).toBe(true)
  })

  it('is NOT usable without a resolver, even though the bucket is addressable', () => {
    // Addressability and usability diverge under pooled tenancy, and conflating
    // them is not academic: a tenant record always names a bucket, so the
    // addressability question answers `true` while every upload throws. The two
    // callers that gate an upload already skip cleanly on `false`, so the wrong
    // question there turns a skip into an exception.
    setStorageCredentialResolver(null)
    expect(withTenant('tenant-alpha', () => isS3Usable())).toBe(false)
    expect(withTenant('tenant-alpha', () => isS3Configured())).toBe(true)
  })

  it('becomes usable once a resolver is registered', () => {
    // The positive control: without it, `isS3Usable` could return false
    // unconditionally and the assertion above would still pass.
    setStorageCredentialResolver(() => ({ accessKeyId: 'k', secretAccessKey: 's' }))
    expect(withTenant('tenant-alpha', () => isS3Usable())).toBe(true)
    setStorageCredentialResolver(null)
  })
})

describe('credentials', () => {
  it('refuses loudly rather than falling back to the fleet-wide keys', () => {
    setStorageCredentialResolver(null)

    expect(() => withTenant('tenant-alpha', () => getS3Config())).toThrow(
      /No storage credential resolver is configured/
    )
  })

  it('resolves through the injected seam once one is registered', () => {
    const seen: string[] = []
    setStorageCredentialResolver((ref) => {
      seen.push(ref)
      return { accessKeyId: 'tenant-key', secretAccessKey: 'tenant-secret' }
    })
    try {
      const resolved = withTenant('tenant-alpha', () => getS3Config())
      expect(resolved.accessKeyId).toBe('tenant-key')
      expect(resolved.bucket).toBe('tenant-alpha-bucket')
      expect(seen).toEqual(['env://QUACKBACK_TENANT_SECRET_STORAGE'])
    } finally {
      setStorageCredentialResolver(null)
    }
  })

  it('still reads the environment keys with no tenant scope', () => {
    setStorageCredentialResolver(null)

    expect(getS3Config()).toMatchObject({
      bucket: 'env-bucket',
      accessKeyId: 'env-access-key',
      secretAccessKey: 'env-secret-key',
    })
  })
})
