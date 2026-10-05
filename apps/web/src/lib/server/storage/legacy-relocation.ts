/**
 * One-time relocation of objects stored before the workspace namespace.
 *
 * Every object name is composed as `w/<workspace TypeID>/<stored key>` (see
 * `namespace.ts`), and there is deliberately no read fallback to the bare key
 * (see the header of `s3.ts`). An install that served files before that layout
 * therefore holds them where nothing reads any more. On a single-workspace
 * install the bucket holds exactly one workspace, so the bare keys are
 * unambiguously its own, and this copies each one to its namespaced name.
 *
 * - **Copy, never move.** The originals stay, so a database backup taken before
 *   the upgrade still finds every file after a restore to the older build.
 * - **Server-side.** CopyObject inside the bucket; no bytes pass through here,
 *   and Content-Type and user metadata are copied with the object.
 * - **Idempotent.** A destination that already holds the same object is
 *   skipped, so an interrupted run resumes by simply running again.
 * - **Never clobbers.** A destination that holds a *different* object was
 *   written under the namespace by the running build and wins; it is counted
 *   and logged, never overwritten.
 * - **Once.** Completion is recorded in `kv_store` with the counts; a run with
 *   any failed copy leaves the marker unset so the next attempt retries.
 *
 * Never runs under pooled tenancy: there the bucket is shared and a bare key is
 * nobody's. `openLegacyRelocationBucket()` refuses that independently.
 */
import { config } from '@/lib/server/config'
import { kvGet, kvSet } from '@/lib/server/kv/pg-kv'
import { logger } from '@/lib/server/logger'
import { withSweepLock } from '@/lib/server/sweep-lock'
import { WORKSPACE_NAMESPACE_ROOT } from './namespace'
import { openLegacyRelocationBucket, type LegacyRelocationBucket, type ListedObject } from './s3'

const log = logger.child({ component: 'storage-relocation' })

/** `kv_store` key the completion marker is written under. */
export const LEGACY_RELOCATION_MARKER_KEY = 'storage:legacy-key-relocation'

/** The marker never expires in practice; `kv_store` requires a TTL. */
const MARKER_TTL_SECONDS = 100 * 365 * 24 * 60 * 60

/**
 * Cross-replica mutex. Copies are idempotent, so an overlap after the lock
 * lapses on a very large bucket costs duplicate requests, not correctness.
 */
const LOCK_NAME = 'storage_legacy_relocation'
const LOCK_TTL_MS = 60 * 60 * 1000

/**
 * CopyObject's single-request limit. The application never writes an object
 * near it (uploads are capped at 100 MB), so a larger one is something an
 * operator put in the bucket by hand: it is logged and left to the manual
 * command in `s3.ts`, which handles multipart copies itself.
 */
export const MAX_SINGLE_COPY_BYTES = 5 * 1024 * 1024 * 1024

const COPY_CONCURRENCY = 8
const PROGRESS_EVERY = 1000
const SAMPLE_LIMIT = 20

export interface RelocationCounts {
  /** Objects at the bucket root, outside `w/`. */
  bareObjects: number
  copied: number
  /** Destination already holds the same object. */
  alreadyPresent: number
  /** Destination holds a different object; left untouched. */
  conflicting: number
  /** Over {@link MAX_SINGLE_COPY_BYTES}; left for the manual command. */
  oversized: number
  /** A bare key that cannot be composed into the namespace (traversal, length). */
  uncomposable: number
  failed: number
}

export interface RelocationMarker extends RelocationCounts {
  finishedAt: string
  namespace: string
}

export type RelocationOutcome =
  | { status: 'not-applicable'; reason: 'pooled' | 'no-storage' }
  | { status: 'already-done'; marker: RelocationMarker }
  | { status: 'locked' }
  | { status: 'done'; marker: RelocationMarker }
  | { status: 'incomplete'; counts: RelocationCounts }

/** Same object, as far as a listing can tell. */
function sameObject(source: ListedObject, destination: ListedObject): boolean {
  if (source.size !== destination.size) return false
  if (!source.etag || !destination.etag) return true
  if (source.etag === destination.etag) return true
  // A multipart upload's ETag (`"<hash>-<parts>"`) is not a content hash, and a
  // copy made in one request gets a plain one. Size is all that compares.
  return source.etag.includes('-') || destination.etag.includes('-')
}

async function listAll(
  bucket: LegacyRelocationBucket,
  prefix: string | undefined,
  onPage: (objects: ListedObject[]) => Promise<void>
): Promise<void> {
  let token: string | undefined
  do {
    const page = await bucket.listPage(prefix, token)
    await onPage(page.objects)
    token = page.nextToken
  } while (token)
}

/** Copy every bare object into the namespace. Exported for tests. */
export async function relocateBareObjects(
  bucket: LegacyRelocationBucket
): Promise<RelocationCounts> {
  const counts: RelocationCounts = {
    bareObjects: 0,
    copied: 0,
    alreadyPresent: 0,
    conflicting: 0,
    oversized: 0,
    uncomposable: 0,
    failed: 0,
  }
  const samples: Record<'conflicting' | 'oversized' | 'uncomposable' | 'failed', string[]> = {
    conflicting: [],
    oversized: [],
    uncomposable: [],
    failed: [],
  }
  const note = (kind: keyof typeof samples, key: string) => {
    counts[kind] += 1
    if (samples[kind].length < SAMPLE_LIMIT) samples[kind].push(key)
  }

  // What the namespace already holds, so a resumed run skips finished copies
  // without a request per object.
  const existing = new Map<string, ListedObject>()
  await listAll(bucket, bucket.namespace, async (objects) => {
    for (const object of objects) existing.set(object.key, object)
  })

  const relocate = async (source: ListedObject): Promise<void> => {
    let destination: string
    try {
      destination = bucket.destinationFor(source.key)
    } catch {
      note('uncomposable', source.key)
      return
    }
    const present = existing.get(destination)
    if (present) {
      if (sameObject(source, present)) counts.alreadyPresent += 1
      else note('conflicting', source.key)
      return
    }
    if (source.size > MAX_SINGLE_COPY_BYTES) {
      note('oversized', source.key)
      return
    }
    try {
      await bucket.copy(source.key, destination)
      counts.copied += 1
    } catch (err) {
      note('failed', source.key)
      if (counts.failed === 1) log.warn({ err, key: source.key }, 'storage relocation copy failed')
    }
  }

  let started = false
  await listAll(bucket, undefined, async (objects) => {
    const bare = objects.filter((o) => !o.key.startsWith(`${WORKSPACE_NAMESPACE_ROOT}/`))
    if (bare.length > 0 && !started) {
      started = true
      log.info(
        { namespace: bucket.namespace },
        'copying files stored before the workspace layout into it; originals are kept'
      )
    }
    for (let i = 0; i < bare.length; i += COPY_CONCURRENCY) {
      await Promise.all(bare.slice(i, i + COPY_CONCURRENCY).map(relocate))
    }
    const before = counts.bareObjects
    counts.bareObjects += bare.length
    if (Math.floor(counts.bareObjects / PROGRESS_EVERY) > Math.floor(before / PROGRESS_EVERY)) {
      log.info({ ...counts }, 'storage relocation progress')
    }
  })

  if (counts.conflicting > 0) {
    log.warn(
      { count: counts.conflicting, sample: samples.conflicting },
      'storage relocation left existing namespaced objects untouched where they differ from the original'
    )
  }
  if (counts.oversized > 0) {
    log.warn(
      { count: counts.oversized, sample: samples.oversized, limitBytes: MAX_SINGLE_COPY_BYTES },
      'storage relocation skipped objects too large for a single copy; copy them with the command in s3.ts'
    )
  }
  if (counts.uncomposable > 0) {
    log.warn(
      { count: counts.uncomposable, sample: samples.uncomposable },
      'storage relocation skipped keys that cannot be stored under the workspace layout'
    )
  }
  if (counts.failed > 0) {
    log.error(
      { count: counts.failed, sample: samples.failed },
      'storage relocation could not copy some objects; it retries on the next attempt'
    )
  }
  return counts
}

/**
 * Run the relocation once per install, under a cross-replica lock.
 *
 * Returns what happened so the caller can stop re-arming it. Throws only for
 * failures it cannot count (a listing error, the database), which also leave
 * the marker unset.
 */
export async function runLegacyStorageRelocation(): Promise<RelocationOutcome> {
  if (config.isPooledTenancy) return { status: 'not-applicable', reason: 'pooled' }

  const prior = await kvGet<RelocationMarker>(LEGACY_RELOCATION_MARKER_KEY)
  if (prior) return { status: 'already-done', marker: prior }

  let outcome: RelocationOutcome = { status: 'locked' }
  await withSweepLock(LOCK_NAME, LOCK_TTL_MS, async () => {
    // Re-read under the lock: another replica may have finished meanwhile.
    const finished = await kvGet<RelocationMarker>(LEGACY_RELOCATION_MARKER_KEY)
    if (finished) {
      outcome = { status: 'already-done', marker: finished }
      return
    }

    const bucket = await openLegacyRelocationBucket()
    if (!bucket) {
      outcome = { status: 'not-applicable', reason: 'no-storage' }
      return
    }

    const counts = await relocateBareObjects(bucket)
    if (counts.failed > 0) {
      outcome = { status: 'incomplete', counts }
      return
    }

    const marker: RelocationMarker = {
      ...counts,
      namespace: bucket.namespace,
      finishedAt: new Date().toISOString(),
    }
    await kvSet(LEGACY_RELOCATION_MARKER_KEY, marker, MARKER_TTL_SECONDS)
    if (counts.bareObjects > 0) {
      log.info({ ...marker }, 'storage relocation finished')
    }
    outcome = { status: 'done', marker }
  })
  return outcome
}
