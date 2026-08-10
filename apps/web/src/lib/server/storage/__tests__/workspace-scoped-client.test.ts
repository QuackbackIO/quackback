/**
 * The workspace-scoped client, observed where it matters: at the command.
 *
 * Asserting on an accessor's return value would only prove this module agrees
 * with itself. The fact that decides whether one customer reads another's files
 * is the `Key` that reaches `PutObjectCommand`/`GetObjectCommand`, so every
 * assertion below is about a command **this test caused to be issued** — the
 * capture is cleared before each one, and a refusal is asserted as "no command
 * was issued", never as "the call threw".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workspaceIdFor } from '@/lib/server/__tests__/tenant-scope'

const mockConfig = {
  s3Bucket: 'env-bucket',
  s3Region: 'env-region',
  s3Endpoint: undefined as string | undefined,
  s3AccessKeyId: 'env-access-key',
  s3SecretAccessKey: 'env-secret-key',
  s3ForcePathStyle: true,
  s3PublicUrl: undefined as string | undefined,
  s3Proxy: false,
  baseUrl: 'https://env-app.example.net',
}
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

/** Every command the SDK was actually handed, in this test. */
const sent: Array<{ Bucket: string; Key: string }> = []
/** Every command that was presigned rather than sent. */
const presigned: Array<{ Bucket: string; Key: string }> = []
/** The credentials each client was constructed with. */
const clientCredentials: Array<{ accessKeyId: string; secretAccessKey: string }> = []

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function (cfg: {
    credentials: { accessKeyId: string; secretAccessKey: string }
  }) {
    clientCredentials.push(cfg.credentials)
    return {
      send: async (command: { input: { Bucket: string; Key: string } }) => {
        sent.push(command.input)
        return {
          Body: { transformToWebStream: () => new ReadableStream() },
          ContentType: 'image/png',
        }
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
  getSignedUrl: vi.fn(async (_client: unknown, cmd: { input: { Bucket: string; Key: string } }) => {
    presigned.push(cmd.input)
    return `https://storage.example.com/${cmd.input.Bucket}/${cmd.input.Key}?X-Amz-Signature=stub`
  }),
}))

const {
  deleteObject,
  generatePresignedGetUrl,
  generatePresignedUploadUrl,
  getS3Object,
  getStorageSigningSecret,
  isPublicStorageKey,
  uploadObject,
  verifyProxyUploadToken,
  workspaceStorage,
} = await import('../s3')
const { StorageNamespaceViolation, WORKSPACE_NAMESPACE_ROOT } = await import('../namespace')
const { WorkspaceStorageScopeMismatch } = await import('../workspace-scope')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')

const PUBLIC_KEY = 'logos/2026/08/brand.png'
const PRIVATE_KEY = 'attachments/2026/08/contract.pdf'
const BYTES = Buffer.from([1, 2, 3])

/** Both tenants pointed at ONE bucket — §9's fleet bucket, where the prefix is the whole boundary. */
const FLEET = { storage: { bucket: 'fleet-bucket' } }

const nameFor = (tenantId: string, key: string) =>
  `${WORKSPACE_NAMESPACE_ROOT}/${workspaceIdFor(tenantId)}/${key}`

beforeEach(() => {
  sent.length = 0
  presigned.length = 0
  clientCredentials.length = 0
  mockConfig.s3Proxy = false
})

describe('every command is namespaced', () => {
  it('writes into the calling workspace namespace', async () => {
    await withTenant('tenant-alpha', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'))

    expect(sent).toHaveLength(1)
    expect(sent[0]!.Key).toBe(nameFor('tenant-alpha', PUBLIC_KEY))
    expect(sent[0]!.Bucket).toBe('tenant-alpha-bucket')
  })

  it('reads, presigns and deletes through the same namespace', async () => {
    await withTenant('tenant-alpha', () => getS3Object(PUBLIC_KEY))
    await withTenant('tenant-alpha', () => deleteObject(PUBLIC_KEY))
    await withTenant('tenant-alpha', () => generatePresignedGetUrl(PUBLIC_KEY, 60))
    await withTenant('tenant-alpha', () => generatePresignedUploadUrl(PUBLIC_KEY, 'image/png'))

    expect(sent.map((c) => c.Key)).toEqual([
      nameFor('tenant-alpha', PUBLIC_KEY),
      nameFor('tenant-alpha', PUBLIC_KEY),
    ])
    expect(presigned.map((c) => c.Key)).toEqual([
      nameFor('tenant-alpha', PUBLIC_KEY),
      nameFor('tenant-alpha', PUBLIC_KEY),
    ])
  })

  it('cannot collide two workspaces on one key in one bucket', async () => {
    await withTenant('tenant-alpha', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'), FLEET)
    await withTenant('tenant-bravo', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'), FLEET)

    expect(sent).toHaveLength(2)
    const [alpha, bravo] = sent as [
      { Bucket: string; Key: string },
      { Bucket: string; Key: string },
    ]
    // Same bucket — so the names are the only thing keeping these apart.
    expect(alpha.Bucket).toBe('fleet-bucket')
    expect(bravo.Bucket).toBe('fleet-bucket')
    expect(alpha.Key).not.toBe(bravo.Key)
    expect(
      alpha.Key.startsWith(`${WORKSPACE_NAMESPACE_ROOT}/${workspaceIdFor('tenant-bravo')}/`)
    ).toBe(false)
    expect(
      bravo.Key.startsWith(`${WORKSPACE_NAMESPACE_ROOT}/${workspaceIdFor('tenant-alpha')}/`)
    ).toBe(false)
  })

  it('uses the credentials the scope resolved, not the environment keys', async () => {
    // The narrowing removed `getS3Config` from the module's exports, so this is
    // now observed where it is used rather than where it was returned.
    //
    // A tenant no other test in this file touches, because the client cache is
    // keyed by tenant: reusing one would let this pass on a client an earlier
    // test constructed, which is evidence about that test rather than this one.
    await withTenant('tenant-charlie', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'), FLEET)

    expect(clientCredentials).toHaveLength(1)
    expect(clientCredentials[0]!.accessKeyId).toBe('AK-tenant-charlie')
    expect(clientCredentials[0]!.accessKeyId).not.toBe('env-access-key')
  })
})

describe('the stored key stays namespace-free', () => {
  it('returns the bare key and a bare public URL from an upload', async () => {
    const result = await withTenant('tenant-alpha', () =>
      generatePresignedUploadUrl(PUBLIC_KEY, 'image/png')
    )

    expect(result.key).toBe(PUBLIC_KEY)
    expect(result.publicUrl).toBe(`https://assets-tenant-alpha.example.com/${PUBLIC_KEY}`)
    expect(result.publicUrl).not.toContain(`${WORKSPACE_NAMESPACE_ROOT}/`)
    // …while the object it will be PUT to IS namespaced.
    expect(presigned).toHaveLength(1)
    expect(presigned[0]!.Key).toBe(nameFor('tenant-alpha', PUBLIC_KEY))
  })

  it('keeps isPublicStorageKey classifying on the stored key', async () => {
    // Prefixing the *stored* key is what would have turned every public asset
    // private, because the classifier reads segment 0. It still reads
    // `logos`, and the object name still reads `w`.
    const client = withTenant('tenant-alpha', () =>
      workspaceStorage(workspaceIdFor('tenant-alpha'))
    )

    expect(isPublicStorageKey(PUBLIC_KEY)).toBe(true)
    expect(isPublicStorageKey(PRIVATE_KEY)).toBe(false)
    expect(client.objectName(PUBLIC_KEY).split('/', 1)[0]).toBe(WORKSPACE_NAMESPACE_ROOT)
    expect(isPublicStorageKey(client.objectName(PUBLIC_KEY))).toBe(false)
  })
})

describe('a key that would escape never reaches a command', () => {
  const neverReachesTheBucket = async (label: string, run: () => Promise<unknown>) => {
    await expect(run(), label).rejects.toThrow(StorageNamespaceViolation)
    expect(sent, `${label}: a command was issued anyway`).toHaveLength(0)
    expect(presigned, `${label}: a command was presigned anyway`).toHaveLength(0)
  }

  it('refuses a traversal on the write path', async () => {
    await neverReachesTheBucket('upload', () =>
      withTenant('tenant-alpha', () => uploadObject('../../escape.png', BYTES, 'image/png'))
    )
  })

  it('refuses an absolute key on the read path', async () => {
    await neverReachesTheBucket('read', () =>
      withTenant('tenant-alpha', () => getS3Object('/etc/passwd'))
    )
  })

  it('refuses an empty key on the delete path', async () => {
    // An empty key composes to the namespace itself, which under a fleet bucket
    // is a request shaped like "everything belonging to this workspace".
    await neverReachesTheBucket('delete', () => withTenant('tenant-alpha', () => deleteObject('')))
  })

  it('refuses percent-encoded traversal on the presign path', async () => {
    await neverReachesTheBucket('presign', () =>
      withTenant('tenant-alpha', () => generatePresignedGetUrl('..%2f..%2fother/x.png', 60))
    )
  })
})

describe('the namespace and the bucket come from the same scope', () => {
  it('refuses a client for a workspace the active scope does not own', () => {
    // The escape route the factory would otherwise open: placement and
    // credentials come from the ambient scope, so composing another workspace's
    // prefix here would address that workspace's objects in a shared bucket.
    expect(() =>
      withTenant('tenant-alpha', () => workspaceStorage(workspaceIdFor('tenant-bravo')))
    ).toThrow(WorkspaceStorageScopeMismatch)
    expect(sent).toHaveLength(0)
  })

  it('allows a client for the workspace the active scope does own', () => {
    // The positive control for the assertion above.
    const client = withTenant('tenant-alpha', () =>
      workspaceStorage(workspaceIdFor('tenant-alpha'))
    )
    expect(client.workspaceId).toBe(workspaceIdFor('tenant-alpha'))
  })

  it('does not accept an unbranded string as a namespace', () => {
    // The assertions here are the `@ts-expect-error` directives and the gate is
    // `bun run typecheck`: if the parameter ever loosens to `string`, every one
    // of them becomes unused and the build fails. Nothing is invoked, and the
    // `expect` at the end is deliberately not the test — the type is erased at
    // runtime, so there is no runtime behaviour here that could go red.
    const fromARequest: string = 'workspace_01kzf9848he8h86ct48hanask6'

    const wouldNotCompile = () => [
      // @ts-expect-error a plain `string` is not a WorkspaceId — anything that
      // came off a request, a header or a route parameter is this type.
      workspaceStorage(fromARequest),
      // @ts-expect-error a slug is not a WorkspaceId.
      workspaceStorage('acme'),
      // @ts-expect-error an empty value is not a WorkspaceId.
      workspaceStorage(''),
      // @ts-expect-error another entity's id is not a WorkspaceId.
      workspaceStorage('post_01h455vb4pex5vsknk084sn02q'),
    ]

    // The honest limit, recorded rather than hidden: `TypeId<'workspace'>` is
    // `` `workspace_${string}` ``, so a *hand-written literal* with the right
    // prefix does typecheck. That is what the scope check above is for — the
    // type stops a value flowing in from outside, and the scope stops a
    // hand-written one naming somebody else.
    expect(wouldNotCompile).toBeTypeOf('function')
  })
})

describe('the module exports no way to address the bucket', () => {
  it('no longer exports an accessor that hands out bucket plus credentials', async () => {
    // The escape route this design closes. `getS3Config()` returned a bucket, an
    // endpoint and a credential pair — a complete capability to address any
    // object — and it was an import away for any file in the app. Named
    // explicitly rather than only shape-checked, because these are the names a
    // future change would reach for when it wants "just the bucket".
    const module = await import('../s3')

    expect(module).not.toHaveProperty('getS3Config')
    expect(module).not.toHaveProperty('getStoragePlacement')
    expect(module).not.toHaveProperty('getStoragePlacementOrNull')
  })

  it('has no zero-argument export that returns a bucket', async () => {
    // The shape check behind the name check, so a re-export under a new name is
    // caught too. Every nullary export is called under a real scope and its
    // result inspected; anything handing back a `bucket` is the same capability
    // wearing a different label.
    const module = (await import('../s3')) as Record<string, unknown>

    const nullary = Object.entries(module).filter(
      ([, value]) => typeof value === 'function' && (value as () => unknown).length === 0
    )
    expect(nullary.length).toBeGreaterThan(0)

    for (const [name, fn] of nullary) {
      const result = withTenant('tenant-alpha', () => (fn as () => unknown)())
      if (result && typeof result === 'object') {
        expect(result, `${name} returns a bucket`).not.toHaveProperty('bucket')
      }
    }
  })
})

describe('token verification through the narrowed accessor', () => {
  /**
   * Every workspace holding the SAME storage secret — which under §9's one fleet
   * credential is not the pessimistic case, it is the case. It matters that this
   * fixture is shared: with per-workspace secrets these two tests would pass
   * because the keys differ, and would keep passing with the tenant binding torn
   * out. The binding has to be the only thing separating them or they are
   * asserting something else.
   */
  const SHARED = { secrets: { storage: { accessKeyId: 'fleet', secretAccessKey: 'fleet-secret' } } }

  const mintFor = async (tenantId: string) => {
    mockConfig.s3Proxy = true
    const { uploadUrl } = await withTenant(
      tenantId,
      () => generatePresignedUploadUrl(PUBLIC_KEY, 'image/png'),
      SHARED
    )
    return new URL(uploadUrl).searchParams
  }

  const verifyAs = (tenantId: string, params: URLSearchParams) =>
    withTenant(
      tenantId,
      () =>
        verifyProxyUploadToken(
          getStorageSigningSecret(),
          PUBLIC_KEY,
          'image/png',
          params.get('exp'),
          params.get('sig')
        ),
      SHARED
    )

  it('verifies a proxy upload token this test minted', async () => {
    const params = await mintFor('tenant-alpha')

    expect(verifyAs('tenant-alpha', params)).toBe(true)
  })

  it('refuses that same token under another workspace on one shared secret', async () => {
    const params = await mintFor('tenant-alpha')

    expect(verifyAs('tenant-bravo', params)).toBe(false)
  })
})
