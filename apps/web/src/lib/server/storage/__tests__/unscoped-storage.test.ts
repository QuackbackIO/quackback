/**
 * What a storage access with no workspace scope does.
 *
 * `currentWorkspaceNamespace()` answers `_` when nothing is scoped. Composed into a
 * shared bucket that is a real, shared prefix every unscoped caller in the fleet
 * would write into, and the background tier is where it bites — `exports/` is
 * written by a job with no request scope. So the namespace resolver never falls
 * back to a literal.
 *
 * The decision it makes instead has two halves, and both are asserted here:
 *
 * - **Self-hosted resolves.** One process, one database, one workspace: the
 *   namespace is that database's own `settings.id`.
 * - **Pooled refuses, and refuses because the database refused.** There is no
 *   unscoped database in a pooled process, so the read throws before a namespace
 *   exists. No storage-side guard, nothing for a later caller to forget.
 *
 * Each test re-imports the module graph, because the self-hosted answer is
 * memoised for the life of the process — as it must be, `settings.id` being a
 * primary key — and a test that inherited that memo from the test above it would
 * be asserting about the previous run rather than its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = {
  s3Bucket: 'self-hosted-bucket',
  s3Region: 'us-east-1',
  s3Endpoint: undefined as string | undefined,
  s3AccessKeyId: 'env-access-key',
  s3SecretAccessKey: 'env-secret-key',
  s3ForcePathStyle: true,
  s3PublicUrl: undefined as string | undefined,
  s3Proxy: false,
  baseUrl: 'https://self-hosted.example.com',
}
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

/** Stands in for the `db` Proxy: answers for a self-hosted process, throws for a pooled one. */
const findFirst = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: {
    query: { settings: { findFirst: (...args: unknown[]) => findFirst(...args) } },
  },
}))

const sent: Array<{ Bucket: string; Key: string }> = []

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
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

/** The self-hosted install's own workspace, as `settings.id` would report it. */
const LOCAL_WORKSPACE = 'workspace_01kzf9848he8h86ct48hanask6'
const KEY = 'exports/export_run_01h455vb4pex5vsknk084sn02q.zip'
const BYTES = Buffer.from([1, 2, 3])

/** A fresh module graph, so no memo survives from the test before. */
async function freshStorage() {
  vi.resetModules()
  return import('../s3')
}

beforeEach(() => {
  sent.length = 0
  findFirst.mockReset()
})

describe('a self-hosted process', () => {
  it('namespaces by its own settings.id', async () => {
    findFirst.mockResolvedValue({ id: LOCAL_WORKSPACE })
    const { uploadObject } = await freshStorage()

    await uploadObject(KEY, BYTES, 'application/zip')

    expect(sent).toHaveLength(1)
    expect(sent[0]!.Key).toBe(`w/${LOCAL_WORKSPACE}/${KEY}`)
    expect(sent[0]!.Bucket).toBe('self-hosted-bucket')
  })

  it('never composes the single-workspace literal', async () => {
    // `_` is the right answer for a cache key and the wrong one for a bucket.
    // In a shared bucket it is a prefix with no owner that every unscoped writer
    // in the fleet would land in.
    findFirst.mockResolvedValue({ id: LOCAL_WORKSPACE })
    const { uploadObject } = await freshStorage()

    await uploadObject(KEY, BYTES, 'application/zip')

    expect(sent[0]!.Key).not.toContain('/_/')
    expect(sent[0]!.Key.startsWith('w/_')).toBe(false)
  })

  it('reads settings.id once and reuses it', async () => {
    // settings.id is a primary key on a singleton row, so this is a
    // process-lifetime constant rather than a per-operation query.
    findFirst.mockResolvedValue({ id: LOCAL_WORKSPACE })
    const { uploadObject } = await freshStorage()

    await uploadObject(KEY, BYTES, 'application/zip')
    await uploadObject(KEY, BYTES, 'application/zip')

    expect(sent).toHaveLength(2)
    expect(findFirst).toHaveBeenCalledTimes(1)
  })

  it('refuses rather than guessing when the database has no settings row', async () => {
    findFirst.mockResolvedValue(undefined)
    const { uploadObject } = await freshStorage()
    const { WorkspaceNamespaceUnresolvable } = await import('../workspace-scope')

    await expect(uploadObject(KEY, BYTES, 'application/zip')).rejects.toThrow(
      WorkspaceNamespaceUnresolvable
    )
    expect(sent).toHaveLength(0)
  })
})

describe('a pooled process with no scope', () => {
  it('refuses, and the refusal is the database proxy s own', async () => {
    // Exactly what `db.ts` does under QUACKBACK_TENANCY=pooled: there is no
    // fleet-wide connection to fall back to, so the read throws. Storage adds no
    // check of its own — it inherits this one.
    const { WorkspaceScopeMissingError } = await import('@/lib/server/workspaces/workspace-context')
    findFirst.mockImplementation(() => {
      throw new WorkspaceScopeMissingError('A `db` call was made with no workspace resolved.')
    })
    const { uploadObject } = await freshStorage()

    await expect(uploadObject(KEY, BYTES, 'application/zip')).rejects.toThrow(
      WorkspaceScopeMissingError
    )
    expect(sent).toHaveLength(0)
  })

  it('refuses every command, not only the write path', async () => {
    const { WorkspaceScopeMissingError } = await import('@/lib/server/workspaces/workspace-context')
    findFirst.mockImplementation(() => {
      throw new WorkspaceScopeMissingError('A `db` call was made with no workspace resolved.')
    })
    const { deleteObject, getS3Object, generatePresignedGetUrl } = await freshStorage()

    await expect(getS3Object(KEY)).rejects.toThrow(WorkspaceScopeMissingError)
    await expect(deleteObject(KEY)).rejects.toThrow(WorkspaceScopeMissingError)
    await expect(generatePresignedGetUrl(KEY, 60)).rejects.toThrow(WorkspaceScopeMissingError)
    expect(sent).toHaveLength(0)
  })
})
