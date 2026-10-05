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
/** Make the next marker read fail, as a database outage would. */
let kvReadFailures = 0
vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvGet: async (key: string) => {
    if (kvReadFailures > 0) {
      kvReadFailures -= 1
      throw new Error('connection refused')
    }
    return kv.has(key) ? structuredClone(kv.get(key)) : null
  },
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
/**
 * How the provider treats `If-None-Match: *` on a copy: honour it (412 when
 * the destination exists), ignore it (as the local Silo does), or reject the
 * header with 501.
 */
let conditionalCopy: 'honour' | 'ignore' | 'reject' = 'honour'
/** Runs after each command completes, to stage a concurrent writer. */
let afterCommand: ((cmd: { kind: string; input: Record<string, unknown> }) => void) | undefined

function s3Error(name: string, status: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } })
}
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
        try {
          return await handle(cmd)
        } finally {
          afterCommand?.(cmd)
        }
      },
      destroy: vi.fn(),
    }
  }),
  PutObjectCommand: command('PutObject'),
  GetObjectCommand: command('GetObject'),
  DeleteObjectCommand: command('DeleteObject'),
  ListObjectsV2Command: command('ListObjectsV2'),
  CopyObjectCommand: command('CopyObject'),
  HeadObjectCommand: command('HeadObject'),
}))

async function handle(cmd: { kind: string; input: Record<string, unknown> }): Promise<unknown> {
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
    if (input.IfNoneMatch !== undefined) {
      if (conditionalCopy === 'reject') throw s3Error('NotImplemented', 501)
      if (conditionalCopy === 'honour' && bucket.has(String(input.Key))) {
        throw s3Error('PreconditionFailed', 412)
      }
    }
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
  if (cmd.kind === 'HeadObject') {
    const o = bucket.get(String(input.Key))
    if (!o) throw s3Error('NotFound', 404)
    return { ContentLength: o.size, ETag: o.etag }
  }
  throw new Error(`unexpected command ${cmd.kind}`)
}

const {
  armLegacyStorageRelocation,
  runLegacyStorageRelocation,
  LEGACY_RELOCATION_MARKER_KEY,
  MAX_SINGLE_COPY_BYTES,
  RELOCATION_FIRST_ATTEMPT_MS,
  RELOCATION_RETRY_MS,
  RECONCILE_GRACE_MS,
} = await import('../legacy-relocation')
const { withWorkspace, workspaceIdFor } = await import('@/lib/server/__tests__/workspace-scope')
const { openLegacyRelocationBucket, LegacyRelocationRefused } = await import('../s3')

const copies = () => sent.filter((c) => c.kind === 'CopyObject')

beforeEach(() => {
  bucket.clear()
  sent.length = 0
  kv.clear()
  failCopiesOf.clear()
  conditionalCopy = 'honour'
  afterCommand = undefined
  lockHeldElsewhere = false
  kvReadFailures = 0
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

    expect(outcome.status).toBe('reconciling')
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
    const other = workspaceIdFor('workspace-other')
    put(`${NS}post-images/new.png`, 'new')
    put(`w/${other}/logos/x.png`, 'other')
    put('avatars/a.png', 'avatar')

    await runLegacyStorageRelocation()

    expect(copies().map((c) => c.input.Key)).toEqual([`${NS}avatars/a.png`])
    expect([...bucket.keys()].some((k) => k.startsWith(`${NS}w/`))).toBe(false)
  })

  it('relocates a bare key that merely starts with w/', async () => {
    // An upload prefix is caller-chosen, so `w/custom/...` is an ordinary
    // stored key. Only `w/<valid workspace TypeID>/` is a namespace.
    put('w/custom/2026/x.png', 'custom')
    put('w/workspace_not-a-typeid/y.png', 'lookalike')
    put(`w/${workspaceIdFor('workspace-other')}/z.png`, 'other')

    await runLegacyStorageRelocation()

    expect(copies().map((c) => c.input.Key)).toEqual([
      `${NS}w/custom/2026/x.png`,
      `${NS}w/workspace_not-a-typeid/y.png`,
    ])
    expect(bucket.get(`${NS}w/custom/2026/x.png`)?.body).toBe('custom')
    expect(bucket.has('w/custom/2026/x.png')).toBe(true)
  })

  it('treats a relocated w/ key as present on the next pass', async () => {
    put('w/custom/x.png', 'custom')
    await runLegacyStorageRelocation()
    sent.length = 0

    const again = await runLegacyStorageRelocation()

    expect(copies()).toHaveLength(0)
    expect('marker' in again && again.marker.lateCopies).toBe(0)
  })

  it('pages through a listing larger than one page', async () => {
    const keys = Array.from({ length: 10 }, (_, i) => `post-images/p${i}.png`)
    for (const key of keys) put(key, key)
    put(`${NS}logos/kept.png`, 'kept')

    const outcome = await runLegacyStorageRelocation()

    for (const key of keys) expect(bucket.get(`${NS}${key}`)?.body).toBe(key)
    expect('marker' in outcome && outcome.marker.copied).toBe(10)
  })

  it('skips a destination that already holds the same object', async () => {
    put('logos/brand.png', 'same')
    put(`${NS}logos/brand.png`, 'same')

    const outcome = await runLegacyStorageRelocation()

    expect(copies()).toHaveLength(0)
    expect('marker' in outcome && outcome.marker.alreadyPresent).toBe(1)
  })

  it('never overwrites a namespaced object that differs from the original', async () => {
    put('logos/brand.png', 'old')
    put(`${NS}logos/brand.png`, 'written-by-new-build')

    const outcome = await runLegacyStorageRelocation()

    expect(copies()).toHaveLength(0)
    expect(bucket.get(`${NS}logos/brand.png`)?.body).toBe('written-by-new-build')
    expect('marker' in outcome && outcome.marker.conflicting).toBe(1)
  })

  it('never overwrites a destination written after the namespace was listed', async () => {
    put('logos/brand.png', 'old')
    // The running build writes the destination once the namespace snapshot is
    // taken, before the copy reaches it.
    afterCommand = (cmd) => {
      if (cmd.kind === 'ListObjectsV2' && cmd.input.Prefix === NS) {
        put(`${NS}logos/brand.png`, 'written-by-new-build')
      }
    }
    conditionalCopy = 'ignore'

    const outcome = await runLegacyStorageRelocation()

    expect(bucket.get(`${NS}logos/brand.png`)?.body).toBe('written-by-new-build')
    expect(copies()).toHaveLength(0)
    expect('marker' in outcome && outcome.marker.conflicting).toBe(1)
  })

  it('refuses atomically when the destination appears between the re-check and the copy', async () => {
    put('logos/brand.png', 'old')
    afterCommand = (cmd) => {
      if (cmd.kind === 'HeadObject' && cmd.input.Key === `${NS}logos/brand.png`) {
        if (!bucket.has(`${NS}logos/brand.png`)) put(`${NS}logos/brand.png`, 'written-by-new-build')
      }
    }

    const outcome = await runLegacyStorageRelocation()

    expect(copies()[0]?.input.IfNoneMatch).toBe('*')
    expect(bucket.get(`${NS}logos/brand.png`)?.body).toBe('written-by-new-build')
    expect('marker' in outcome && outcome.marker).toMatchObject({ conflicting: 1, copied: 0 })
  })

  it('copies without the condition on a provider that rejects it', async () => {
    put('logos/a.png', 'a')
    put('logos/b.png', 'b')
    conditionalCopy = 'reject'

    const outcome = await runLegacyStorageRelocation()

    expect(bucket.get(`${NS}logos/a.png`)?.body).toBe('a')
    expect(bucket.get(`${NS}logos/b.png`)?.body).toBe('b')
    expect('marker' in outcome && outcome.marker.copied).toBe(2)
  })

  it('leaves objects over the single-copy limit for the manual command', async () => {
    put('exports/huge.bin', 'x', { size: MAX_SINGLE_COPY_BYTES + 1 })
    put('logos/small.png', 'small')

    const outcome = await runLegacyStorageRelocation()

    expect(copies().map((c) => c.input.Key)).toEqual([`${NS}logos/small.png`])
    expect('marker' in outcome && outcome.marker.oversized).toBe(1)
  })

  it('records the first complete pass, reconciles for the grace period, then stops', async () => {
    const t0 = Date.parse('2026-10-05T12:00:00Z')
    put('logos/brand.png', 'logo')

    const first = await runLegacyStorageRelocation(() => t0)
    expect(first.status).toBe('reconciling')
    expect(kv.get(LEGACY_RELOCATION_MARKER_KEY)).toMatchObject({
      copied: 1,
      bareObjects: 1,
      failed: 0,
      namespace: NS,
      firstCompletedAt: new Date(t0).toISOString(),
      lateCopies: 0,
    })
    expect(kv.get(LEGACY_RELOCATION_MARKER_KEY)).not.toHaveProperty('finishedAt')

    // An older replica still serving during a rolling upgrade writes a bare key.
    put('avatars/late.png', 'late')
    sent.length = 0
    const later = await runLegacyStorageRelocation(() => t0 + RECONCILE_GRACE_MS / 2)

    expect(later.status).toBe('reconciling')
    expect(copies().map((c) => c.input.Key)).toEqual([`${NS}avatars/late.png`])
    expect(kv.get(LEGACY_RELOCATION_MARKER_KEY)).toMatchObject({ copied: 1, lateCopies: 1 })

    const last = await runLegacyStorageRelocation(() => t0 + RECONCILE_GRACE_MS)
    expect(last.status).toBe('done')
    expect(kv.get(LEGACY_RELOCATION_MARKER_KEY)).toMatchObject({
      finishedAt: new Date(t0 + RECONCILE_GRACE_MS).toISOString(),
    })

    sent.length = 0
    put('avatars/after-final.png', 'too late')
    const after = await runLegacyStorageRelocation(() => t0 + 2 * RECONCILE_GRACE_MS)

    expect(after.status).toBe('already-done')
    expect(sent).toHaveLength(0)
    expect(bucket.has(`${NS}avatars/after-final.png`)).toBe(false)
  })

  it('records an empty bucket without anything to copy', async () => {
    const outcome = await runLegacyStorageRelocation()
    expect(outcome.status).toBe('reconciling')
    expect(kv.get(LEGACY_RELOCATION_MARKER_KEY)).toMatchObject({ bareObjects: 0, copied: 0 })
    expect(copies()).toHaveLength(0)
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

    expect(second.status).toBe('reconciling')
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

describe('the boot-time arming', () => {
  let disarm: (() => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    disarm?.()
    disarm = undefined
    vi.useRealTimers()
  })

  it('runs on a single-workspace boot, reconciles through the grace period, then stops', async () => {
    put('logos/a.png', 'a')

    disarm = armLegacyStorageRelocation()
    await vi.advanceTimersByTimeAsync(RELOCATION_FIRST_ATTEMPT_MS - 1)
    expect(sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(bucket.get(`${NS}logos/a.png`)?.body).toBe('a')
    expect(kv.has(LEGACY_RELOCATION_MARKER_KEY)).toBe(true)

    // A bare key written within the grace period is picked up by an hourly pass.
    put('avatars/late.png', 'late')
    await vi.advanceTimersByTimeAsync(RELOCATION_RETRY_MS)
    expect(bucket.get(`${NS}avatars/late.png`)?.body).toBe('late')

    await vi.advanceTimersByTimeAsync(RECONCILE_GRACE_MS)
    expect(kv.get(LEGACY_RELOCATION_MARKER_KEY)).toHaveProperty('finishedAt')

    sent.length = 0
    await vi.advanceTimersByTimeAsync(RELOCATION_RETRY_MS * 3)
    expect(sent).toHaveLength(0)
  })

  it('gets past the scope guard even when armed from inside a workspace scope', async () => {
    put('logos/a.png', 'a')

    // Real timers: a fake timer runs its callback in the context of whoever
    // advances the clock, which would hide exactly the inheritance at issue.
    vi.useRealTimers()
    disarm = withWorkspace('workspace-alpha', () =>
      armLegacyStorageRelocation({ firstAttemptMs: 1, retryMs: 60_000 })
    )

    await vi.waitFor(() => expect(kv.has(LEGACY_RELOCATION_MARKER_KEY)).toBe(true), {
      timeout: 5_000,
    })
    expect(bucket.get(`${NS}logos/a.png`)?.body).toBe('a')
  })

  it('catches a failed attempt and retries it on the next tick', async () => {
    put('logos/a.png', 'a')
    kvReadFailures = 1

    disarm = armLegacyStorageRelocation()
    await vi.advanceTimersByTimeAsync(RELOCATION_FIRST_ATTEMPT_MS)
    expect(bucket.has(`${NS}logos/a.png`)).toBe(false)

    await vi.advanceTimersByTimeAsync(RELOCATION_RETRY_MS)
    expect(bucket.get(`${NS}logos/a.png`)?.body).toBe('a')
    expect(kv.has(LEGACY_RELOCATION_MARKER_KEY)).toBe(true)
  })

  it('keeps retrying after an incomplete run', async () => {
    put('logos/a.png', 'a')
    failCopiesOf.add('logos/a.png')

    disarm = armLegacyStorageRelocation()
    await vi.advanceTimersByTimeAsync(RELOCATION_FIRST_ATTEMPT_MS)
    expect(kv.has(LEGACY_RELOCATION_MARKER_KEY)).toBe(false)

    failCopiesOf.clear()
    await vi.advanceTimersByTimeAsync(RELOCATION_RETRY_MS)
    expect(kv.has(LEGACY_RELOCATION_MARKER_KEY)).toBe(true)
  })
})
