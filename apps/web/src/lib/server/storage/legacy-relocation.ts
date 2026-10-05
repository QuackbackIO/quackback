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
 *   and logged, never overwritten. Each copy re-checks its destination and is
 *   conditional (`If-None-Match: *`) where the provider honours that; the
 *   residual window on providers that ignore it is described at the copy.
 * - **Once, after a grace period.** The first complete pass is recorded in
 *   `kv_store` with its counts. During a rolling upgrade a replica of the
 *   older build can keep writing bare keys after that pass, so cheap
 *   reconciling passes (identical destinations are skipped) continue hourly
 *   until {@link RECONCILE_GRACE_MS} after it, and only then is the marker
 *   final. A pass with any failed copy records nothing, so the next attempt
 *   retries.
 *
 * Never runs under pooled tenancy: there the bucket is shared and a bare key is
 * nobody's. `openLegacyRelocationBucket()` refuses that independently.
 */
import { config } from '@/lib/server/config'
import { kvGet, kvSet } from '@/lib/server/kv/pg-kv'
import { runWithoutLogContext } from '@/lib/server/log-context'
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

/**
 * Counts are those of the first complete pass; `lateCopies` sums what the
 * reconciling passes after it copied. `finishedAt` is set once the grace period
 * has passed, and from then on nothing runs again.
 */
export interface RelocationMarker extends RelocationCounts {
  namespace: string
  firstCompletedAt: string
  lateCopies: number
  finishedAt?: string
}

/**
 * How long reconciling passes continue after the first complete one: long
 * enough for an older build's replicas to drain during a rolling upgrade.
 */
export const RECONCILE_GRACE_MS = 24 * 60 * 60 * 1000

export type RelocationOutcome =
  | { status: 'not-applicable'; reason: 'pooled' | 'no-storage' }
  | { status: 'already-done'; marker: RelocationMarker }
  | { status: 'locked' }
  | { status: 'reconciling'; marker: RelocationMarker }
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
  bucket: LegacyRelocationBucket,
  { quiet = false }: { quiet?: boolean } = {}
): Promise<RelocationCounts> {
  // A reconciling pass repeats the same findings every hour; only failures
  // stay loud on it.
  const notice = quiet ? log.debug.bind(log) : log.info.bind(log)
  const warn = quiet ? log.debug.bind(log) : log.warn.bind(log)
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
    const classify = (present: ListedObject) => {
      if (sameObject(source, present)) counts.alreadyPresent += 1
      else note('conflicting', source.key)
    }
    const listed = existing.get(destination)
    if (listed) {
      classify(listed)
      return
    }
    if (source.size > MAX_SINGLE_COPY_BYTES) {
      note('oversized', source.key)
      return
    }
    try {
      // The snapshot above is from before the scan, and the running build may
      // have written this destination since. Look again immediately before
      // copying, and copy with `If-None-Match: *` so a provider that honours
      // conditional copies refuses atomically. On a provider that ignores the
      // condition, a write landing between this HEAD and the copy is still
      // overwritten; that window is one request long and needs a newly
      // uploaded object to reuse a bare key's random name.
      const now = await bucket.head(destination)
      if (now) {
        classify(now)
        return
      }
      if ((await bucket.copyIfAbsent(source.key, destination)) === 'exists') {
        const raced = await bucket.head(destination)
        if (raced) classify(raced)
        else note('failed', source.key)
        return
      }
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
      notice(
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
      notice({ ...counts }, 'storage relocation progress')
    }
  })

  if (counts.conflicting > 0) {
    warn(
      { count: counts.conflicting, sample: samples.conflicting },
      'storage relocation left existing namespaced objects untouched where they differ from the original'
    )
  }
  if (counts.oversized > 0) {
    warn(
      { count: counts.oversized, sample: samples.oversized, limitBytes: MAX_SINGLE_COPY_BYTES },
      'storage relocation skipped objects too large for a single copy; copy them with the command in s3.ts'
    )
  }
  if (counts.uncomposable > 0) {
    warn(
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
 * Run one relocation pass, under a cross-replica lock, unless the marker is
 * final.
 *
 * Returns what happened so the caller can stop re-arming it. Throws only for
 * failures it cannot count (a listing error, the database), which also leave
 * the marker as it was.
 */
export async function runLegacyStorageRelocation(
  now: () => number = Date.now
): Promise<RelocationOutcome> {
  if (config.isPooledTenancy) return { status: 'not-applicable', reason: 'pooled' }

  const prior = await kvGet<RelocationMarker>(LEGACY_RELOCATION_MARKER_KEY)
  if (prior?.finishedAt) return { status: 'already-done', marker: prior }

  let outcome: RelocationOutcome = { status: 'locked' }
  await withSweepLock(LOCK_NAME, LOCK_TTL_MS, async () => {
    // Re-read under the lock: another replica may have run a pass meanwhile.
    const current = await kvGet<RelocationMarker>(LEGACY_RELOCATION_MARKER_KEY)
    if (current?.finishedAt) {
      outcome = { status: 'already-done', marker: current }
      return
    }

    const bucket = await openLegacyRelocationBucket()
    if (!bucket) {
      outcome = { status: 'not-applicable', reason: 'no-storage' }
      return
    }

    const counts = await relocateBareObjects(bucket, { quiet: current !== null })
    if (counts.failed > 0) {
      outcome = { status: 'incomplete', counts }
      return
    }

    const at = now()
    const marker: RelocationMarker = current
      ? { ...current, lateCopies: current.lateCopies + counts.copied }
      : {
          ...counts,
          namespace: bucket.namespace,
          firstCompletedAt: new Date(at).toISOString(),
          lateCopies: 0,
        }
    if (at - Date.parse(marker.firstCompletedAt) >= RECONCILE_GRACE_MS) {
      marker.finishedAt = new Date(at).toISOString()
    }
    await kvSet(LEGACY_RELOCATION_MARKER_KEY, marker, MARKER_TTL_SECONDS)

    if (!current && counts.bareObjects > 0) {
      log.info({ ...marker }, 'storage relocation copied existing files; reconciling for a day')
    } else if (current && counts.copied > 0) {
      log.info(
        { copied: counts.copied },
        'storage relocation copied files written since the last pass'
      )
    } else {
      log.debug({ ...counts }, 'storage relocation pass found nothing new')
    }
    outcome = { status: marker.finishedAt ? 'done' : 'reconciling', marker }
  })
  return outcome
}

/** Delay before the first attempt, so it does not compete with boot. */
export const RELOCATION_FIRST_ATTEMPT_MS = 20_000
/** Cadence of retries and of reconciling passes until the marker is final. */
export const RELOCATION_RETRY_MS = 60 * 60 * 1000

/**
 * Schedule the relocation on this process: once shortly after boot, then
 * hourly until the marker is final or there is nothing to do here. An
 * interrupted or partly failed run therefore resumes without a restart, and
 * bare keys an older replica writes during a rolling upgrade are picked up.
 *
 * The timers are armed with no ambient context. A timer inherits the async
 * context it was created in, and the workspace scope travels in that context,
 * so arming from inside a scope would otherwise make every attempt run as that
 * workspace and be refused. Every attempt catches and logs its own failure; no
 * rejection escapes a timer. Returns a function that cancels both timers.
 */
export function armLegacyStorageRelocation({
  firstAttemptMs = RELOCATION_FIRST_ATTEMPT_MS,
  retryMs = RELOCATION_RETRY_MS,
}: { firstAttemptMs?: number; retryMs?: number } = {}): () => void {
  return runWithoutLogContext(() => {
    let interval: ReturnType<typeof setInterval> | undefined
    const disarm = () => {
      clearTimeout(first)
      clearInterval(interval)
    }
    const attempt = async () => {
      try {
        const outcome = await runLegacyStorageRelocation()
        if (outcome.status === 'done' || outcome.status === 'already-done') disarm()
        if (outcome.status === 'not-applicable') disarm()
      } catch (err) {
        log.error({ err }, 'storage relocation attempt failed; it retries within the hour')
      }
    }
    const first = setTimeout(() => void attempt(), firstAttemptMs)
    interval = setInterval(() => void attempt(), retryMs)
    return disarm
  })
}
