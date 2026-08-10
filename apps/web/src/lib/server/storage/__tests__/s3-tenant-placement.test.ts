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
import { beforeEach, describe, it, expect, vi } from 'vitest'

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

/**
 * Placement and credentials are no longer readable as values: `getS3Config` and
 * `getStoragePlacement` are module-private, because a bucket plus a credential
 * is a complete capability to address any object and nothing outside the module
 * needs one. So the tests that used to read them now observe them where they are
 * spent — the `Bucket` a command names, and the credentials a client is built
 * with. That is a better question than the old one: it asks what the request
 * actually addressed rather than what an accessor was willing to say.
 */
const sent: Array<{ Bucket: string; Key: string }> = []
const clientConfigs: Array<{
  region: string
  endpoint?: string
  forcePathStyle: boolean
  credentials: { accessKeyId: string; secretAccessKey: string }
}> = []

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function (cfg: (typeof clientConfigs)[number]) {
    clientConfigs.push(cfg)
    return {
      send: async (command: { input: { Bucket: string; Key: string } }) => {
        sent.push(command.input)
        return {}
      },
      destroy: vi.fn(),
    }
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
  getSignedUrl: vi.fn(async () => 'https://stub'),
}))

const {
  getPublicUrlOrNull,
  getStorageSigningSecret,
  isS3Configured,
  isS3Usable,
  StorageUnavailableError,
  uploadObject,
} = await import('../s3')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')

const BYTES = Buffer.from([1, 2, 3])

beforeEach(() => {
  sent.length = 0
  clientConfigs.length = 0
})

// `logos/` is a public prefix; `attachments/` is not (unknown prefixes are private).
const PUBLIC_KEY = 'logos/2026/08/brand.png'
const PRIVATE_KEY = 'attachments/2026/08/contract.pdf'

/**
 * The pessimistic case: every tenant holding the SAME storage secret. The read
 * token must still be tenant-bound, because the object key alone does not say
 * which bucket it names.
 *
 * Passed per call rather than installed globally — the credentials now live on
 * the tenant scope, resolved at pool checkout, so "shared" is a property of the
 * fixture rather than of a process-wide switch.
 */
const SHARED_SECRET = {
  storage: { accessKeyId: 'shared-key', secretAccessKey: 'shared-secret' },
} as const

/** A tenant whose storage credentials did not resolve. */
const NO_STORAGE = {
  storage: null,
  storageProblem: 'openbao+kv://… has no resolver in this process',
} as const

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
    const url = withTenant('tenant-alpha', () => getPublicUrlOrNull(PRIVATE_KEY), {
      secrets: SHARED_SECRET,
    })

    expect(url).toContain(`https://tenant-alpha.example.com/api/storage/${PRIVATE_KEY}?read=`)
  })

  it('signs a private key differently per tenant even on one shared secret', () => {
    const alpha = withTenant('tenant-alpha', () => getPublicUrlOrNull(PRIVATE_KEY), {
      secrets: SHARED_SECRET,
    })
    const bravo = withTenant('tenant-bravo', () => getPublicUrlOrNull(PRIVATE_KEY), {
      secrets: SHARED_SECRET,
    })

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
  it('addresses the tenant bucket, not the environment bucket', async () => {
    await withTenant('tenant-alpha', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'))

    expect(sent).toHaveLength(1)
    expect(sent[0]!.Bucket).toBe('tenant-alpha-bucket')
    expect(sent[0]!.Bucket).not.toBe('env-bucket')
    expect(clientConfigs).toHaveLength(1)
    expect(clientConfigs[0]).toMatchObject({
      region: 'auto',
      forcePathStyle: false,
      endpoint: 'https://storage.example.com',
    })
  })

  it('needs no resolved credential to address a bucket', () => {
    // The old spelling of this asked whether `getStoragePlacement()` threw. That
    // accessor is gone; the property it was protecting is not, and it was never
    // really about the accessor — it is that a public asset URL keeps rendering
    // for a tenant whose credentials this process cannot dereference, because
    // rendering one needs a bucket and no secret.
    expect(withTenant('tenant-alpha', () => isS3Configured(), { secrets: NO_STORAGE })).toBe(true)
    expect(
      withTenant('tenant-alpha', () => getPublicUrlOrNull(PUBLIC_KEY), { secrets: NO_STORAGE })
    ).toBe(`https://assets-tenant-alpha.example.com/${PUBLIC_KEY}`)
  })

  it('is NOT usable without resolved credentials, though the bucket is addressable', () => {
    // Addressability and usability diverge under pooled tenancy, and conflating
    // them is not academic: a tenant record always names a bucket, so the
    // addressability question answers `true` while every upload throws. The two
    // callers that gate an upload already skip cleanly on `false`, so the wrong
    // question there turns a skip into an exception.
    expect(withTenant('tenant-alpha', () => isS3Usable(), { secrets: NO_STORAGE })).toBe(false)
    expect(withTenant('tenant-alpha', () => isS3Configured(), { secrets: NO_STORAGE })).toBe(true)
  })

  it('is usable once the credentials resolved', () => {
    // The positive control: without it, `isS3Usable` could return false
    // unconditionally and the assertion above would still pass.
    expect(withTenant('tenant-alpha', () => isS3Usable())).toBe(true)
  })
})

describe('credentials', () => {
  it('refuses loudly rather than falling back to the fleet-wide keys', async () => {
    // The failure that matters is not "throws" — it is "does not silently use
    // env-access-key". A fleet-wide fallback would build a client for tenant
    // alpha's bucket holding credentials that might well open it.
    expect(() =>
      withTenant('tenant-alpha', () => getStorageSigningSecret(), { secrets: NO_STORAGE })
    ).toThrow(StorageUnavailableError)
    expect(() =>
      withTenant('tenant-alpha', () => getStorageSigningSecret(), { secrets: NO_STORAGE })
    ).toThrow(/no resolver in this process/)

    // …and the command path refuses too, without ever constructing a client.
    //
    // A tenant nothing else has touched. The S3 client is memoised per tenant,
    // so a tenant that built one earlier in this file would send through the
    // cached client and never reach credential resolution — the test would be
    // reporting on that earlier client rather than on this call.
    await expect(
      withTenant('tenant-foxtrot', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'), {
        secrets: NO_STORAGE,
      })
    ).rejects.toThrow(StorageUnavailableError)
    expect(clientConfigs).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  it('uses the credentials resolved for THIS tenant', async () => {
    // Observed at the client rather than at an accessor. Two tenants no other
    // test in this file has touched, because the client cache is keyed by
    // tenant and a reused one would be evidence from an earlier test.
    await withTenant('tenant-delta', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'))
    await withTenant('tenant-echo', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'))

    expect(clientConfigs).toHaveLength(2)
    const [delta, echo] = clientConfigs as [
      (typeof clientConfigs)[number],
      (typeof clientConfigs)[number],
    ]
    expect(delta.credentials.accessKeyId).toBe('AK-tenant-delta')
    expect(echo.credentials.accessKeyId).toBe('AK-tenant-echo')
    expect(delta.credentials.secretAccessKey).not.toBe(echo.credentials.secretAccessKey)
    expect(delta.credentials.accessKeyId).not.toBe('env-access-key')
    expect(sent.map((c) => c.Bucket)).toEqual(['tenant-delta-bucket', 'tenant-echo-bucket'])
  })

  it('gives no private URL at all when the credentials did not resolve', () => {
    // Null rather than a throw: an unsignable private key degrades one avatar or
    // one attachment link, while an escaping throw takes down every page that
    // renders one.
    expect(
      withTenant('tenant-alpha', () => getPublicUrlOrNull(PRIVATE_KEY), { secrets: NO_STORAGE })
    ).toBeNull()
    // …and the public URL still renders, because it needs no secret.
    expect(
      withTenant('tenant-alpha', () => getPublicUrlOrNull(PUBLIC_KEY), { secrets: NO_STORAGE })
    ).toBe(`https://assets-tenant-alpha.example.com/${PUBLIC_KEY}`)
  })

  it('still reads the environment keys with no tenant scope', () => {
    // The self-hosted path. Only the signing secret is observable from outside
    // the module now; that the unscoped bucket is still the environment one is
    // asserted at the command in `unscoped-storage.test.ts`, which is the only
    // place that can supply the database the unscoped namespace is read from.
    expect(getStorageSigningSecret()).toBe('env-secret-key')
  })
})
