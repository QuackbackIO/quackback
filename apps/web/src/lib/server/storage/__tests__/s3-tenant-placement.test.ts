/**
 * Storage placement under a workspace scope.
 *
 * Persist stores host-independent `/api/storage/<key>` refs. Off-host leaves
 * absolutize from the pinned system-host publicUrl, never from the friendly
 * platform URL or the process-wide `S3_PUBLIC_URL` / `BASE_URL`.
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
  getEmailSafeUrl,
  getStorageSigningSecret,
  isS3Configured,
  isS3Usable,
  resignStoredAssetUrl,
  StorageUnavailableError,
  uploadObject,
} = await import('../s3')
const { absolutizeOffHostAssetUrl } = await import('../asset-url')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

const BYTES = Buffer.from([1, 2, 3])

beforeEach(() => {
  sent.length = 0
  clientConfigs.length = 0
})

// `logos/` is a public prefix; `attachments/` is not (unknown prefixes are private).
const PUBLIC_KEY = 'logos/2026/08/brand.png'
const PRIVATE_KEY = 'attachments/2026/08/contract.pdf'

/**
 * The pessimistic case: every workspace holding the SAME storage secret. The read
 * token must still be workspace-bound, because the object key alone does not say
 * which bucket it names.
 *
 * Passed per call rather than installed globally — the credentials now live on
 * the workspace scope, resolved at pool checkout, so "shared" is a property of the
 * fixture rather than of a process-wide switch.
 */
const SHARED_SECRET = {
  storage: { accessKeyId: 'shared-key', secretAccessKey: 'shared-secret' },
} as const

/** A workspace whose storage credentials did not resolve. */
const NO_STORAGE = {
  storage: null,
  storageProblem: 'openbao+kv://… has no resolver in this process',
} as const

describe('public URLs', () => {
  it('persists a host-independent /api/storage ref, not the environment CDN', () => {
    const url = withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PUBLIC_KEY))

    expect(url).toBe(`/api/storage/${PUBLIC_KEY}`)
    expect(url).not.toContain('env-cdn.example.net')
    expect(url).not.toContain('assets-workspace-alpha')
  })

  it('keeps persist relative after a friendly URL rename', () => {
    const url = withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PUBLIC_KEY), {
      storage: { publicUrl: 'https://ws-abc123.quackback.co.uk/api/storage' },
      baseUrl: 'https://acme.quackback.co.uk',
    })

    expect(url).toBe(`/api/storage/${PUBLIC_KEY}`)
    expect(url).not.toContain('acme.quackback.co.uk')
    expect(url).not.toContain('env-cdn.example.net')
  })

  it('absolutizes off-host leaves from the pinned system host after a rename', () => {
    const url = withWorkspace(
      'workspace-alpha',
      () => absolutizeOffHostAssetUrl(`/api/storage/${PUBLIC_KEY}`),
      {
        storage: { publicUrl: 'https://ws-abc123.quackback.co.uk/api/storage' },
        baseUrl: 'https://acme.quackback.co.uk',
      }
    )

    expect(url).toBe(`https://ws-abc123.quackback.co.uk/api/storage/${PUBLIC_KEY}`)
    expect(url).not.toContain('acme.quackback.co.uk')
    expect(url).not.toContain('env-cdn.example.net')
  })

  it('gives two workspaces the same persist form for the same key', () => {
    const alpha = withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PUBLIC_KEY))
    const bravo = withWorkspace('workspace-bravo', () => getPublicUrlOrNull(PUBLIC_KEY))

    expect(alpha).toBe(`/api/storage/${PUBLIC_KEY}`)
    expect(bravo).toBe(`/api/storage/${PUBLIC_KEY}`)
  })

  it('does not fall back to the environment BASE_URL for persist', () => {
    const url = withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PUBLIC_KEY), {
      storage: { publicUrl: '' },
    })

    expect(url).toBe(`/api/storage/${PUBLIC_KEY}`)
    expect(url).not.toContain('env-app.example.net')
  })

  it('still persists a relative ref with no workspace scope', () => {
    expect(getPublicUrlOrNull(PUBLIC_KEY)).toBe(`/api/storage/${PUBLIC_KEY}`)
  })

  it('routes private keys through /api/storage with a read capability', () => {
    const url = withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PRIVATE_KEY), {
      secrets: SHARED_SECRET,
    })

    expect(url).toBe(
      `/api/storage/${PRIVATE_KEY}?read=${new URL(url!, 'https://placeholder.invalid').searchParams.get('read')}`
    )
    expect(url).toContain(`/api/storage/${PRIVATE_KEY}?read=`)
    expect(url).not.toContain('workspace-alpha.example.com')
  })

  it('signs a private key differently per workspace even on one shared secret', () => {
    const alpha = withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PRIVATE_KEY), {
      secrets: SHARED_SECRET,
    })
    const bravo = withWorkspace('workspace-bravo', () => getPublicUrlOrNull(PRIVATE_KEY), {
      secrets: SHARED_SECRET,
    })

    const sigOf = (url: string | null) =>
      new URL(url!, 'https://placeholder.invalid').searchParams.get('read')
    expect(sigOf(alpha)).toBeTruthy()
    expect(sigOf(alpha)).not.toBe(sigOf(bravo))
  })

  it('resigns an unsigned legacy private URL with the current workspace token', () => {
    const minted = withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PRIVATE_KEY), {
      secrets: SHARED_SECRET,
    })
    const resigned = withWorkspace(
      'workspace-alpha',
      () => resignStoredAssetUrl(`https://old.example.com/api/storage/${PRIVATE_KEY}`),
      { secrets: SHARED_SECRET }
    )
    expect(resigned).toBe(minted)
    expect(resigned).toContain(`?read=`)
  })

  it('replaces a stale private token rather than keeping it', () => {
    const resigned = withWorkspace(
      'workspace-alpha',
      () =>
        resignStoredAssetUrl(`/api/storage/${PRIVATE_KEY}?read=deadbeefdeadbeefdeadbeefdeadbeef`),
      { secrets: SHARED_SECRET }
    )
    expect(resigned).not.toContain('deadbeef')
    expect(resigned).toBe(
      withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PRIVATE_KEY), {
        secrets: SHARED_SECRET,
      })
    )
  })

  it('leaves a foreign src untouched', () => {
    expect(resignStoredAssetUrl('https://cdn.example.com/brand.png')).toBe(
      'https://cdn.example.com/brand.png'
    )
  })

  it('leaves the unscoped read signature byte-identical to the historical one', () => {
    // HMAC-SHA256('env-secret-key', 'read|<key>') truncated to 32 hex chars —
    // the message as it stood before workspaces. These signatures are embedded in
    // stored refs already written into content, so a changed message is a fleet
    // of dead asset links, not a migration.
    const url = getPublicUrlOrNull(PRIVATE_KEY)

    expect(new URL(url!, 'https://placeholder.invalid').searchParams.get('read')).toBe(
      'e5d708d10b754b004667a83a235584f6'
    )
  })

  it('email-safe URLs absolutize from the system host and force the proxy hint', () => {
    const url = withWorkspace('workspace-alpha', () => getEmailSafeUrl(PUBLIC_KEY), {
      storage: { publicUrl: 'https://ws-abc123.quackback.co.uk/api/storage' },
      baseUrl: 'https://acme.quackback.co.uk',
    })

    expect(url).toBe(`https://ws-abc123.quackback.co.uk/api/storage/${PUBLIC_KEY}?email=1`)
    expect(url).not.toContain('acme.quackback.co.uk')
  })
})

describe('placement', () => {
  it('addresses the workspace bucket, not the environment bucket', async () => {
    await withWorkspace('workspace-alpha', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'))

    expect(sent).toHaveLength(1)
    expect(sent[0]!.Bucket).toBe('workspace-alpha-bucket')
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
    // for a workspace whose credentials this process cannot dereference, because
    // rendering one needs a bucket and no secret.
    expect(withWorkspace('workspace-alpha', () => isS3Configured(), { secrets: NO_STORAGE })).toBe(
      true
    )
    expect(
      withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PUBLIC_KEY), {
        secrets: NO_STORAGE,
      })
    ).toBe(`/api/storage/${PUBLIC_KEY}`)
  })

  it('is NOT usable without resolved credentials, though the bucket is addressable', () => {
    // Addressability and usability diverge under pooled workspaces, and conflating
    // them is not academic: a workspace record always names a bucket, so the
    // addressability question answers `true` while every upload throws. The two
    // callers that gate an upload already skip cleanly on `false`, so the wrong
    // question there turns a skip into an exception.
    expect(withWorkspace('workspace-alpha', () => isS3Usable(), { secrets: NO_STORAGE })).toBe(
      false
    )
    expect(withWorkspace('workspace-alpha', () => isS3Configured(), { secrets: NO_STORAGE })).toBe(
      true
    )
  })

  it('is usable once the credentials resolved', () => {
    // The positive control: without it, `isS3Usable` could return false
    // unconditionally and the assertion above would still pass.
    expect(withWorkspace('workspace-alpha', () => isS3Usable())).toBe(true)
  })
})

describe('credentials', () => {
  it('refuses loudly rather than falling back to the fleet-wide keys', async () => {
    // The failure that matters is not "throws" — it is "does not silently use
    // env-access-key". A fleet-wide fallback would build a client for workspace
    // alpha's bucket holding credentials that might well open it.
    expect(() =>
      withWorkspace('workspace-alpha', () => getStorageSigningSecret(), { secrets: NO_STORAGE })
    ).toThrow(StorageUnavailableError)
    expect(() =>
      withWorkspace('workspace-alpha', () => getStorageSigningSecret(), { secrets: NO_STORAGE })
    ).toThrow(/no resolver in this process/)

    // …and the command path refuses too, without ever constructing a client.
    //
    // A workspace nothing else has touched. The S3 client is memoised per workspace,
    // so a workspace that built one earlier in this file would send through the
    // cached client and never reach credential resolution — the test would be
    // reporting on that earlier client rather than on this call.
    await expect(
      withWorkspace('workspace-foxtrot', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'), {
        secrets: NO_STORAGE,
      })
    ).rejects.toThrow(StorageUnavailableError)
    expect(clientConfigs).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  it('uses the credentials resolved for THIS workspace', async () => {
    // Observed at the client rather than at an accessor. Two workspaces no other
    // test in this file has touched, because the client cache is keyed by
    // workspace and a reused one would be evidence from an earlier test.
    await withWorkspace('workspace-delta', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'))
    await withWorkspace('workspace-echo', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'))

    expect(clientConfigs).toHaveLength(2)
    const [delta, echo] = clientConfigs as [
      (typeof clientConfigs)[number],
      (typeof clientConfigs)[number],
    ]
    expect(delta.credentials.accessKeyId).toBe('AK-workspace-delta')
    expect(echo.credentials.accessKeyId).toBe('AK-workspace-echo')
    expect(delta.credentials.secretAccessKey).not.toBe(echo.credentials.secretAccessKey)
    expect(delta.credentials.accessKeyId).not.toBe('env-access-key')
    expect(sent.map((c) => c.Bucket)).toEqual(['workspace-delta-bucket', 'workspace-echo-bucket'])
  })

  it('gives no private URL at all when the credentials did not resolve', () => {
    // Null rather than a throw: an unsignable private key degrades one avatar or
    // one attachment link, while an escaping throw takes down every page that
    // renders one.
    expect(
      withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PRIVATE_KEY), {
        secrets: NO_STORAGE,
      })
    ).toBeNull()
    // …and the public URL still renders, because it needs no secret.
    expect(
      withWorkspace('workspace-alpha', () => getPublicUrlOrNull(PUBLIC_KEY), {
        secrets: NO_STORAGE,
      })
    ).toBe(`/api/storage/${PUBLIC_KEY}`)
  })

  it('still reads the environment keys with no workspace scope', () => {
    // The self-hosted path. Only the signing secret is observable from outside
    // the module now; that the unscoped bucket is still the environment one is
    // asserted at the command in `unscoped-storage.test.ts`, which is the only
    // place that can supply the database the unscoped namespace is read from.
    expect(getStorageSigningSecret()).toBe('env-secret-key')
  })
})
