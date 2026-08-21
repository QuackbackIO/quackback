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
import { workspaceIdFor } from '@/lib/server/__tests__/workspace-scope'

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

/**
 * The scoped tests never reach this — a workspace scope carries its own verified
 * `settings.id`. It is here for the unscoped assertions, which drive it into
 * the pooled refusal on purpose.
 */
const findFirst = vi.fn(async () => ({ id: 'workspace_01kzf9848he8h86ct48hanask6' }))
vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: () => findFirst() } } },
}))

/**
 * Every command the SDK was actually handed, in this test.
 *
 * `via` records the access key of the client the command went out through.
 * Without it a command can be checked for the right bucket and the right key
 * while having been signed by somebody else's client, which is exactly the half
 * of the scope-straddle a first version of these tests could not see.
 */
const sent: Array<{ Bucket: string; Key: string; via: string }> = []
/** Every command that was presigned rather than sent. */
const presigned: Array<{ Bucket: string; Key: string }> = []
/** The credentials each client was constructed with. */
const clientCredentials: Array<{ accessKeyId: string; secretAccessKey: string }> = []

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function (cfg: {
    credentials: { accessKeyId: string; secretAccessKey: string }
  }) {
    clientCredentials.push(cfg.credentials)
    const via = cfg.credentials.accessKeyId
    return {
      send: async (command: { input: { Bucket: string; Key: string } }) => {
        sent.push({ ...command.input, via })
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
  currentWorkspaceStorage,
  deleteObject,
  generatePresignedGetUrl,
  generatePresignedUploadUrl,
  getS3Object,
  getStorageSigningSecret,
  isPublicStorageKey,
  uploadObject,
  verifyProxyUploadToken,
} = await import('../s3')
const { composeNamespacedKey, StorageNamespaceViolation, WORKSPACE_NAMESPACE_ROOT } =
  await import('../namespace')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

const PUBLIC_KEY = 'logos/2026/08/brand.png'
const PRIVATE_KEY = 'attachments/2026/08/contract.pdf'
const BYTES = Buffer.from([1, 2, 3])

/** Both workspaces pointed at ONE bucket — §9's fleet bucket, where the prefix is the whole boundary. */
const FLEET = { storage: { bucket: 'fleet-bucket' } }

const nameFor = (workspaceKey: string, key: string) =>
  `${WORKSPACE_NAMESPACE_ROOT}/${workspaceIdFor(workspaceKey)}/${key}`

beforeEach(() => {
  sent.length = 0
  presigned.length = 0
  clientCredentials.length = 0
  mockConfig.s3Proxy = false
})

describe('every command is namespaced', () => {
  it('writes into the calling workspace namespace', async () => {
    await withWorkspace('workspace-alpha', () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'))

    expect(sent).toHaveLength(1)
    expect(sent[0]!.Key).toBe(nameFor('workspace-alpha', PUBLIC_KEY))
    expect(sent[0]!.Bucket).toBe('workspace-alpha-bucket')
  })

  it('reads, presigns and deletes through the same namespace', async () => {
    await withWorkspace('workspace-alpha', () => getS3Object(PUBLIC_KEY))
    await withWorkspace('workspace-alpha', () => deleteObject(PUBLIC_KEY))
    await withWorkspace('workspace-alpha', () => generatePresignedGetUrl(PUBLIC_KEY, 60))
    await withWorkspace('workspace-alpha', () =>
      generatePresignedUploadUrl(PUBLIC_KEY, 'image/png')
    )

    expect(sent.map((c) => c.Key)).toEqual([
      nameFor('workspace-alpha', PUBLIC_KEY),
      nameFor('workspace-alpha', PUBLIC_KEY),
    ])
    // Uploads no longer presign a PUT. Reads still do.
    expect(presigned.map((c) => c.Key)).toEqual([nameFor('workspace-alpha', PUBLIC_KEY)])
  })

  it('cannot collide two workspaces on one key in one bucket', async () => {
    await withWorkspace(
      'workspace-alpha',
      () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'),
      FLEET
    )
    await withWorkspace(
      'workspace-bravo',
      () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'),
      FLEET
    )

    expect(sent).toHaveLength(2)
    const [alpha, bravo] = sent as [(typeof sent)[number], (typeof sent)[number]]
    // Same bucket — so the names are the only thing keeping these apart.
    expect(alpha.Bucket).toBe('fleet-bucket')
    expect(bravo.Bucket).toBe('fleet-bucket')
    expect(alpha.Key).not.toBe(bravo.Key)
    expect(
      alpha.Key.startsWith(`${WORKSPACE_NAMESPACE_ROOT}/${workspaceIdFor('workspace-bravo')}/`)
    ).toBe(false)
    expect(
      bravo.Key.startsWith(`${WORKSPACE_NAMESPACE_ROOT}/${workspaceIdFor('workspace-alpha')}/`)
    ).toBe(false)
  })

  it('uses the credentials the scope resolved, not the environment keys', async () => {
    // The narrowing removed `getS3Config` from the module's exports, so this is
    // now observed where it is used rather than where it was returned.
    //
    // A workspace no other test in this file touches. The client cache is keyed by
    // connection parameters, so reusing a workspace would let this pass on a client
    // an earlier test constructed — evidence about that test, not this one.
    await withWorkspace(
      'workspace-charlie',
      () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'),
      FLEET
    )

    expect(clientCredentials).toHaveLength(1)
    expect(clientCredentials[0]!.accessKeyId).toBe('AK-workspace-charlie')
    expect(clientCredentials[0]!.accessKeyId).not.toBe('env-access-key')
  })
})

describe('the stored key stays namespace-free', () => {
  it('returns the bare key and a bare public URL from an upload', async () => {
    const result = await withWorkspace('workspace-alpha', () =>
      generatePresignedUploadUrl(PUBLIC_KEY, 'image/png')
    )

    expect(result.key).toBe(PUBLIC_KEY)
    expect(result.publicUrl).toBe(`/api/storage/${PUBLIC_KEY}`)
    expect(result.uploadUrl.startsWith(`/api/storage/${PUBLIC_KEY}?`)).toBe(true)
    expect(result.publicUrl).not.toContain(`${WORKSPACE_NAMESPACE_ROOT}/`)
    expect(result.uploadUrl).not.toContain(`${WORKSPACE_NAMESPACE_ROOT}/`)
    expect(presigned).toHaveLength(0)
  })

  it('keeps isPublicStorageKey classifying on the stored key', async () => {
    // Prefixing the *stored* key is what would have turned every public asset
    // private, because the classifier reads segment 0. It still reads
    // `logos`, and the object name still reads `w`.
    const client = await withWorkspace('workspace-alpha', () => currentWorkspaceStorage())

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
      withWorkspace('workspace-alpha', () => uploadObject('../../escape.png', BYTES, 'image/png'))
    )
  })

  it('refuses an absolute key on the read path', async () => {
    await neverReachesTheBucket('read', () =>
      withWorkspace('workspace-alpha', () => getS3Object('/etc/passwd'))
    )
  })

  it('refuses an empty key on the delete path', async () => {
    // An empty key composes to the namespace itself, which under a fleet bucket
    // is a request shaped like "everything belonging to this workspace".
    await neverReachesTheBucket('delete', () =>
      withWorkspace('workspace-alpha', () => deleteObject(''))
    )
  })

  it('refuses percent-encoded traversal on the presign path', async () => {
    await neverReachesTheBucket('presign', () =>
      withWorkspace('workspace-alpha', () => generatePresignedGetUrl('..%2f..%2fother/x.png', 60))
    )
  })
})

describe('there is no exported way to name a workspace', () => {
  it('does not export the factory at all', async () => {
    // The finding this replaces. `workspaceStorage()` used to be exported behind
    // a guard that compared its argument to the ambient scope — and skipped the
    // comparison when there was no scope, which is precisely the state a pooled
    // background job is in. An unscoped caller could name any workspace and
    // reach the fleet bucket with the fleet credential.
    //
    // A guard could not repair it: "no scope" is also every self-hosted
    // install, where the unscoped path is correct and resolves through `db`. So
    // the export went instead, and this assertion is the whole control.
    const module = (await import('../s3')) as Record<string, unknown>

    expect(module).not.toHaveProperty('workspaceStorage')
  })

  it('exposes exactly one client factory, and it takes no arguments', async () => {
    // The shape behind the name. An export that returns a client must have no
    // parameter for a caller to supply a workspace through — that is the whole
    // difference between the surface that was reviewable and the one that was
    // not. Asserted on arity rather than by invoking every export, because
    // calling arbitrary exports to see what comes back is a test that performs
    // the side effects it is meant to be auditing.
    const module = await import('../s3')

    expect(module).not.toHaveProperty('workspaceStorage')
    expect(module.currentWorkspaceStorage).toBeTypeOf('function')
    expect(module.currentWorkspaceStorage.length).toBe(0)
  })

  it('is unreachable unscoped in a pooled process, on every command', async () => {
    // The test that did not exist, and whose absence let the hole through: no
    // test called into storage from outside a scope. `db` throwing is exactly
    // what the pooled Proxy does when nothing is resolved.
    const { WorkspaceScopeMissingError } = await import('@/lib/server/workspaces/workspace-context')
    findFirst.mockImplementation(() => {
      throw new WorkspaceScopeMissingError('A `db` call was made with no workspace resolved.')
    })

    await expect(uploadObject(PUBLIC_KEY, BYTES, 'image/png')).rejects.toThrow(
      WorkspaceScopeMissingError
    )
    await expect(getS3Object(PUBLIC_KEY)).rejects.toThrow(WorkspaceScopeMissingError)
    await expect(deleteObject(PUBLIC_KEY)).rejects.toThrow(WorkspaceScopeMissingError)
    await expect(generatePresignedGetUrl(PUBLIC_KEY, 60)).rejects.toThrow(
      WorkspaceScopeMissingError
    )
    await expect(generatePresignedUploadUrl(PUBLIC_KEY, 'image/png')).rejects.toThrow(
      WorkspaceScopeMissingError
    )

    expect(sent).toHaveLength(0)
    expect(presigned).toHaveLength(0)
  })

  it('binds the bucket at construction, so a captured client cannot straddle a scope', async () => {
    // `WorkspaceStorage` fixes its workspace at construction but used to re-read
    // the bucket and credentials on every call. Held across a scope boundary
    // that composed workspace A's prefix against workspace B's bucket, which in
    // one shared bucket is A's objects reached through B's client.
    // Two workspaces no other test in this file touches. The SDK client is memoised
    // by connection parameters, so reusing a workspace would serve a client an
    // earlier test built and the credential assertion would report on that.
    const GOLF = { storage: { bucket: 'golf-bucket' } }
    const HOTEL = { storage: { bucket: 'hotel-bucket' } }

    const client = await withWorkspace('workspace-golf', () => currentWorkspaceStorage(), GOLF)

    // Hotel issues its own command FIRST, so a client for hotel exists and is
    // cached. Without this the straddle is only half-observable: the captured
    // client would be rebuilt from its captured config either way, and a cache
    // keyed by the asking workspace would look correct because nothing was there to
    // hand back. This is the state where a wrong key returns a wrong client.
    await withWorkspace(
      'workspace-hotel',
      () => uploadObject(PUBLIC_KEY, BYTES, 'image/png'),
      HOTEL
    )

    await withWorkspace('workspace-hotel', () => client.put(PUBLIC_KEY, BYTES, 'image/png'), HOTEL)

    expect(sent).toHaveLength(2)
    const straddled = sent[1]!
    expect(straddled.Key).toBe(nameFor('workspace-golf', PUBLIC_KEY))
    expect(straddled.Bucket, 'the captured client took the later scope bucket').toBe('golf-bucket')
    expect(straddled.via, 'the captured client signed through the later scope client').toBe(
      'AK-workspace-golf'
    )
  })

  it('does not accept an unbranded string as a namespace', () => {
    // The type-level half, moved to `composeNamespacedKey` — the exported
    // function that still takes a `WorkspaceId`, and the one place a namespace
    // is chosen. The assertions are the `@ts-expect-error` directives and the
    // gate is `bun run typecheck`; the `expect` is deliberately not the test,
    // because the type is erased at runtime.
    const fromARequest: string = 'workspace_01kzf9848he8h86ct48hanask6'

    const wouldNotCompile = () => [
      // @ts-expect-error a plain `string` is not a WorkspaceId — anything that
      // came off a request, a header or a route parameter is this type.
      composeNamespacedKey(fromARequest, PUBLIC_KEY),
      // @ts-expect-error a slug is not a WorkspaceId.
      composeNamespacedKey('acme', PUBLIC_KEY),
      // @ts-expect-error an empty value is not a WorkspaceId.
      composeNamespacedKey('', PUBLIC_KEY),
      // @ts-expect-error another entity id is not a WorkspaceId.
      composeNamespacedKey('post_01h455vb4pex5vsknk084sn02q', PUBLIC_KEY),
    ]

    // The limit, recorded rather than implied, because a reviewer found the
    // previous wording overclaimed it: `TypeId<'workspace'>` is
    // `` `workspace_${string}` ``, a template-literal type and not a nominal
    // brand. A hand-written literal typechecks, and so does
    // `` composeNamespacedKey(`workspace_${req.params.ws}`, key) `` — with no
    // cast and no error. The type stops a bare `string`; it does not stop
    // interpolation, and nothing about it is load-bearing for isolation. What
    // is load-bearing is that no export hands out a client for a named
    // workspace at all, which the two assertions above pin.
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
      const result = withWorkspace('workspace-alpha', () => (fn as () => unknown)())
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
   * because the keys differ, and would keep passing with the workspace binding torn
   * out. The binding has to be the only thing separating them or they are
   * asserting something else.
   */
  const SHARED = { secrets: { storage: { accessKeyId: 'fleet', secretAccessKey: 'fleet-secret' } } }

  const mintFor = async (workspaceKey: string) => {
    mockConfig.s3Proxy = true
    const { uploadUrl } = await withWorkspace(
      workspaceKey,
      () => generatePresignedUploadUrl(PUBLIC_KEY, 'image/png'),
      SHARED
    )
    return new URL(uploadUrl, 'https://workspace.test').searchParams
  }

  const verifyAs = (workspaceKey: string, params: URLSearchParams) =>
    withWorkspace(
      workspaceKey,
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
    const params = await mintFor('workspace-alpha')

    expect(verifyAs('workspace-alpha', params)).toBe(true)
  })

  it('refuses that same token under another workspace on one shared secret', async () => {
    const params = await mintFor('workspace-alpha')

    expect(verifyAs('workspace-bravo', params)).toBe(false)
  })
})
