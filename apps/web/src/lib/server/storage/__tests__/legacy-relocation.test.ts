/**
 * The one-time relocation of pre-namespace objects, against an in-memory bucket
 * that behaves like one: listings honour `Prefix` and paginate, a copy reads
 * the source named by `CopySource` and fails when it is absent, and metadata
 * survives only when the copy asks for it. Every assertion is about the bucket's
 * final contents or the commands that reached it, never about a return value
 * alone.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const WORKSPACE_ID = 'workspace_01kzf9848he8h86ct48hanask6'
const NS = `w/${WORKSPACE_ID}/`
const BUCKET = 'install-bucket'

const mockConfig = {
  s3Bucket: BUCKET as string | undefined,
  s3Region: 'us-east-1' as string | undefined,
  s3Endpoint: undefined as string | undefined,
  s3AccessKeyId: 'key' as string | undefined,
  s3SecretAccessKey: 'secret' as string | undefined,
  s3ForcePathStyle: true,
  s3PublicUrl: undefined as string | undefined,
  baseUrl: 'https://feedback.example.com',
  isPooledTenancy: false,
}
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: async () => ({ id: WORKSPACE_ID }) } } },
}))

/** `kv_store`, as far as the marker is concerned. */
const kv = new Map<string, unknown>()
vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvGet: async (key: string) => (kv.has(key) ? structuredClone(kv.get(key)) : null),
  kvSet: async (key: string, value: unknown, seconds: number) => {
    if (!(seconds > 0)) throw new Error('ttl must be positive')
    kv.set(key, structuredClone(value))
  },
}))

/** The sweep lock: held by someone else when `lockHeldElsewhere` is set. */
let lockHeldElsewhere = false
vi.mock('@/lib/server/sweep-lock', () => ({
  withSweepLock: async (_name: string, _ttl: number, fn: () => Promise<void>) => {
    if (lockHeldElsewhere) return
    await fn()
  },
}))

interface StoredObject {
  body: string
  size: number
  etag: string
  contentType?: string
  metadata?: Record<string, string>
}

const bucket = new Map<string, StoredObject>()
const sent: Array<{ kind: string; input: Record<string, unknown> }> = []
const failCopiesOf = new Set<string>()
const PAGE_SIZE = 3

function put(key: string, body: string, extra: Partial<StoredObject> = {}) {
  bucket.set(key, {
    body,
    size: Buffer.byteLength(body),
    etag: `"${createHash('md5').update(body).digest('hex')}"`,
    ...extra,
  })
}

function command(kind: string) {
  return vi.fn(function (input: Record<string, unknown>) {
    return { kind, input }
  })
}

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return {
      send: async (cmd: { kind: string; input: Record<string, unknown> }) => {
        sent.push(cmd)
        const input = cmd.input
        if (input.Bucket !== BUCKET) throw new Error(`NoSuchBucket: ${String(input.Bucket)}`)
        if (cmd.kind === 'ListObjectsV2') {
          const prefix = (input.Prefix as string | undefined) ?? ''
          const keys = [...bucket.keys()].filter((k) => k.startsWith(prefix)).sort()
          const after = input.ContinuationToken as string | undefined
          const from = after ? keys.findIndex((k) => k > after) : 0
          const page = from < 0 ? [] : keys.slice(from, from + PAGE_SIZE)
          const truncated = from >= 0 && from + PAGE_SIZE < keys.length
          return {
            Contents: page.map((Key) => {
              const o = bucket.get(Key)!
              return { Key, Size: o.size, ETag: o.etag }
            }),
            IsTruncated: truncated,
            NextContinuationToken: truncated ? page[page.length - 1] : undefined,
          }
        }
        if (cmd.kind === 'CopyObject') {
          const source = decodeURIComponent(String(input.CopySource))
          if (!source.startsWith(`${BUCKET}/`)) throw new Error(`bad CopySource ${source}`)
          const sourceKey = source.slice(BUCKET.length + 1)
          if (failCopiesOf.has(sourceKey)) throw new Error('InternalError')
          const original = bucket.get(sourceKey)
          if (!original) throw new Error(`NoSuchKey: ${sourceKey}`)
          const keepMetadata = input.MetadataDirective === 'COPY'
          bucket.set(String(input.Key), {
            ...original,
            contentType: keepMetadata ? original.contentType : 'binary/octet-stream',
            metadata: keepMetadata ? original.metadata : undefined,
          })
          return {}
        }
        throw new Error(`unexpected command ${cmd.kind}`)
      },
      destroy: vi.fn(),
    }
  }),
  PutObjectCommand: command('PutObject'),
  GetObjectCommand: command('GetObject'),
  DeleteObjectCommand: command('DeleteObject'),
  ListObjectsV2Command: command('ListObjectsV2'),
  CopyObjectCommand: command('CopyObject'),
}))

const { runLegacyStorageRelocation, LEGACY_RELOCATION_MARKER_KEY, MAX_SINGLE_COPY_BYTES } =
  await import('../legacy-relocation')
const { openLegacyRelocationBucket, LegacyRelocationRefused } = await import('../s3')

const copies = () => sent.filter((c) => c.kind === 'CopyObject')

beforeEach(() => {
  bucket.clear()
  sent.length = 0
  kv.clear()
  failCopiesOf.clear()
  lockHeldElsewhere = false
  mockConfig.isPooledTenancy = false
  mockConfig.s3Bucket = BUCKET
  mockConfig.s3Region = 'us-east-1'
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('single-workspace relocation', () => {
  it('copies every bare key into the namespace and keeps the originals', async () => {
    put('logos/brand.png', 'logo-bytes', { contentType: 'image/png', metadata: { a: '1' } })
    put('attachments/2025/contract.pdf', 'pdf-bytes', { contentType: 'application/pdf' })
    put('exports/old.zip', 'zip')

    const outcome = await runLegacyStorageRelocation()

    expect(outcome.status).toBe('done')
    expect(bucket.get(`${NS}logos/brand.png`)).toMatchObject({
      body: 'logo-bytes',
      contentType: 'image/png',
      metadata: { a: '1' },
    })
    expect(bucket.get(`${NS}attachments/2025/contract.pdf`)).toMatchObject({
      body: 'pdf-bytes',
      contentType: 'application/pdf',
    })
    expect(bucket.get(`${NS}exports/old.zip`)?.body).toBe('zip')
    // Originals stay for a restore onto the older build.
    expect(bucket.has('logos/brand.png')).toBe(true)
    expect(bucket.has('attachments/2025/contract.pdf')).toBe(true)
    expect(bucket.has('exports/old.zip')).toBe(true)
    expect(copies()).toHaveLength(3)
  })

  it('leaves already-namespaced objects alone, including other namespaces', async () => {
    put(`${NS}post-images/new.png`, 'new')
    put('w/workspace_01other0000000000000000000/logos/x.png', 'other')
    put('avatars/a.png', 'avatar')

    await runLegacyStorageRelocation()

    expect(copies().map((c) => c.input.Key)).toEqual([`${NS}avatars/a.png`])
    expect([...bucket.keys()].some((k) => k.startsWith(`${NS}w/`))).toBe(false)
  })

  it('pages through a listing larger than one page', async () => {
    const keys = Array.from({ length: 10 }, (_, i) => `post-images/p${i}.png`)
    for (const key of keys) put(key, key)
    put(`${NS}logos/kept.png`, 'kept')

    const outcome = await runLegacyStorageRelocation()

    for (const key of keys) expect(bucket.get(`${NS}${key}`)?.body).toBe(key)
    expect(outcome.status === 'done' && outcome.marker.copied).toBe(10)
  })

  it('skips a destination that already holds the same object', async () => {
    put('logos/brand.png', 'same')
    put(`${NS}logos/brand.png`, 'same')

    const outcome = await runLegacyStorageRelocation()

    expect(copies()).toHaveLength(0)
    expect(outcome.status === 'done' && outcome.marker.alreadyPresent).toBe(1)
  })

  it('never overwrites a namespaced object that differs from the original', async () => {
    put('logos/brand.png', 'old')
    put(`${NS}logos/brand.png`, 'written-by-new-build')

    const outcome = await runLegacyStorageRelocation()

    expect(copies()).toHaveLength(0)
    expect(bucket.get(`${NS}logos/brand.png`)?.body).toBe('written-by-new-build')
    expect(outcome.status === 'done' && outcome.marker.conflicting).toBe(1)
  })

  it('leaves objects over the single-copy limit for the manual command', async () => {
    put('exports/huge.bin', 'x', { size: MAX_SINGLE_COPY_BYTES + 1 })
    put('logos/small.png', 'small')

    const outcome = await runLegacyStorageRelocation()

    expect(copies().map((c) => c.input.Key)).toEqual([`${NS}logos/small.png`])
    expect(outcome.status === 'done' && outcome.marker.oversized).toBe(1)
  })

  it('records completion with counts, and a second run touches nothing', async () => {
    put('logos/brand.png', 'logo')

    await runLegacyStorageRelocation()
    expect(kv.get(LEGACY_RELOCATION_MARKER_KEY)).toMatchObject({
      copied: 1,
      bareObjects: 1,
      failed: 0,
      namespace: NS,
      finishedAt: expect.any(String),
    })

    sent.length = 0
    put('avatars/after-marker.png', 'late')
    const second = await runLegacyStorageRelocation()

    expect(second.status).toBe('already-done')
    expect(sent).toHaveLength(0)
    expect(bucket.has(`${NS}avatars/after-marker.png`)).toBe(false)
  })

  it('marks an empty bucket done quietly', async () => {
    const outcome = await runLegacyStorageRelocation()
    expect(outcome.status).toBe('done')
    expect(kv.get(LEGACY_RELOCATION_MARKER_KEY)).toMatchObject({ bareObjects: 0, copied: 0 })
  })

  it('leaves the marker unset after a failed copy, and the next run resumes', async () => {
    put('logos/a.png', 'a')
    put('logos/b.png', 'b')
    put('logos/c.png', 'c')
    failCopiesOf.add('logos/b.png')

    const first = await runLegacyStorageRelocation()

    expect(first.status).toBe('incomplete')
    expect(kv.has(LEGACY_RELOCATION_MARKER_KEY)).toBe(false)
    expect(bucket.has(`${NS}logos/a.png`)).toBe(true)
    expect(bucket.has(`${NS}logos/b.png`)).toBe(false)

    failCopiesOf.clear()
    sent.length = 0
    const second = await runLegacyStorageRelocation()

    expect(second.status).toBe('done')
    expect(copies().map((c) => c.input.Key)).toEqual([`${NS}logos/b.png`])
    expect(kv.get(LEGACY_RELOCATION_MARKER_KEY)).toMatchObject({ copied: 1, alreadyPresent: 2 })
  })

  it('does nothing while another replica holds the lock', async () => {
    put('logos/a.png', 'a')
    lockHeldElsewhere = true

    const outcome = await runLegacyStorageRelocation()

    expect(outcome.status).toBe('locked')
    expect(sent).toHaveLength(0)
    expect(kv.has(LEGACY_RELOCATION_MARKER_KEY)).toBe(false)
  })

  it('does nothing when no object storage is configured', async () => {
    mockConfig.s3Bucket = undefined
    mockConfig.s3Region = undefined
    put('logos/a.png', 'a')

    const outcome = await runLegacyStorageRelocation()

    expect(outcome).toEqual({ status: 'not-applicable', reason: 'no-storage' })
    expect(sent).toHaveLength(0)
    expect(kv.has(LEGACY_RELOCATION_MARKER_KEY)).toBe(false)
  })
})

describe('pooled tenancy', () => {
  it('never relocates anything', async () => {
    mockConfig.isPooledTenancy = true
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    put('logos/a.png', 'a')

    const outcome = await runLegacyStorageRelocation()

    expect(outcome).toEqual({ status: 'not-applicable', reason: 'pooled' })
    expect(sent).toHaveLength(0)
    expect([...bucket.keys()]).toEqual(['logos/a.png'])
  })

  it('refuses to open the bucket root even when asked directly', async () => {
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    await expect(openLegacyRelocationBucket()).rejects.toBeInstanceOf(LegacyRelocationRefused)
    expect(sent).toHaveLength(0)
  })
})
