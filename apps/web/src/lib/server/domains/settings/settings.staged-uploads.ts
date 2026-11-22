/**
 * Uploads stored before anything refers to them, and the sweep that removes
 * the abandoned ones (PORTAL-CUSTOMISE-SPEC §4.1.5).
 *
 * The portal editor uploads a wide logo or font files into the draft; they
 * are saved only when the look is published. What a publish replaces goes
 * back on the list, so an undo can publish it again until the sweep runs. An upload the person discards is
 * never referred to, so each one is recorded in
 * `settings.metadata.stagedUploads` with the time it was staged. A daily job
 * deletes those nothing refers to a day later.
 *
 * Safety, in order of importance:
 *  - Never an object the settings row names: before deleting, the whole row
 *    (every column, and every other metadata key) is searched for the key.
 *    A published key is only forgotten, never deleted; the publish that
 *    replaces it stages it again.
 *  - Never outside the staged prefixes, whatever was recorded.
 *  - A publish cannot save a key the sweep is deleting. Under the settings
 *    row lock, which a publish also takes, the sweep checks each due key and
 *    marks the ones it will delete (`sweeping`); a publish refuses a marked
 *    key just as it refuses one no longer staged (see the publish service).
 *  - No storage call holds the row lock. The marks are committed first, the
 *    deletes run after with a timeout each, and a second short transaction
 *    forgets the keys whose delete succeeded. A delete that fails or hangs,
 *    or a run that dies part way, leaves its keys listed and marked, and the
 *    next run checks and deletes them again.
 */
import { db, eq, settings, type Transaction } from '@/lib/server/db'
import { deleteObject } from '@/lib/server/storage/s3'
import { logger } from '@/lib/server/logger'
import { ValidationError } from '@/lib/shared/errors'
import {
  invalidateSettingsCache,
  parseMetadataBag,
  writeMetadataKey,
  type SettingsWriteOptions,
} from './settings.helpers'

const log = logger.child({ component: 'staged-uploads' })

export const STAGED_UPLOADS_KEY = 'stagedUploads'

/** The only key spaces the sweep may delete from. */
// logos/ and favicons/ hold the published icon too: only an icon the editor
// or an Import staged is ever listed, and the sweep never deletes a key the
// row names.
export const STAGED_UPLOAD_PREFIXES = ['header-logos/', 'fonts/', 'logos/', 'favicons/'] as const

/** How long an upload may wait for a publish before it is removed. */
export const STAGED_UPLOAD_GRACE_MS = 24 * 60 * 60_000

/**
 * More than a day of drafting needs: an Import stages up to five objects
 * (logo, icon, favicon, two font files) and runs up to 30 times a day, and a
 * replaced import's objects stay until the daily sweep, since editor Undo can
 * still step back to them. Still small enough for the metadata bag.
 */
export const MAX_STAGED_UPLOADS = 300

/**
 * Deletes per run, and a time budget well inside the job's 60s lease: no new
 * delete starts after the budget, so a run ends within the budget plus one
 * delete timeout. What is left stays listed for the next run.
 */
export const MAX_SWEEP_DELETES = 25
const SWEEP_BUDGET_MS = 20_000

/** How long one delete may take before the sweep gives up on it until the next run. */
export const STAGED_UPLOAD_DELETE_TIMEOUT_MS = 10_000

/** A store reports a missing object two ways; either means there is nothing to delete. */
function isNotFound(error: unknown): boolean {
  const e = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
}

export interface StagedUpload {
  key: string
  /** ISO time the upload was staged. */
  at: string
  /**
   * Import brought it in as one of a site's brand assets (its logo, icon or
   * a commercial font): a publish puts it live only with a confirmation.
   */
  brandAsset?: true
  /**
   * The sweep has claimed it for deletion: it is past its day and nothing
   * referred to it. A publish refuses it; the sweep forgets it once deleted.
   */
  sweeping?: true
}

export function isStageableKey(key: string): boolean {
  return (
    STAGED_UPLOAD_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
    !key.includes('..') &&
    /^[\w./-]+$/.test(key)
  )
}

/** The staged list in a metadata bag; anything malformed in it is skipped. */
function stagedIn(bag: Record<string, unknown>): StagedUpload[] {
  const list = bag[STAGED_UPLOADS_KEY]
  if (!Array.isArray(list)) return []
  return list.filter(
    (entry): entry is StagedUpload =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as StagedUpload).key === 'string' &&
      typeof (entry as StagedUpload).at === 'string'
  )
}

/** The staged list in a stored metadata text, for reads that never write. */
export function readStagedUploads(metadata: string | null): StagedUpload[] {
  try {
    const bag: unknown = metadata ? JSON.parse(metadata) : null
    return typeof bag === 'object' && bag !== null && !Array.isArray(bag)
      ? stagedIn(bag as Record<string, unknown>)
      : []
  } catch {
    return []
  }
}

function parsedBag(metadata: string | null, settingsId: string) {
  return parseMetadataBag(metadata, { settingsId, key: STAGED_UPLOADS_KEY })
}

/**
 * Record an upload as staged. Called before the upload URL is handed out, so
 * every object the editor can store is on the list.
 */
export async function recordStagedUpload(
  key: string,
  options: SettingsWriteOptions & { now?: Date; brandAsset?: boolean } = {}
): Promise<void> {
  if (!isStageableKey(key)) {
    throw new ValidationError('INVALID_STAGED_UPLOAD', 'This file cannot be uploaded here.')
  }
  const at = (options.now ?? new Date()).toISOString()
  await writeMetadataKey(
    STAGED_UPLOADS_KEY,
    (stored) => {
      const list = readStagedUploads(stored)
      if (list.length >= MAX_STAGED_UPLOADS) {
        throw new ValidationError(
          'TOO_MANY_STAGED_UPLOADS',
          'Too many uploads are waiting to be published. Publish your changes or try again tomorrow.'
        )
      }
      return [...list, { key, at, ...(options.brandAsset ? { brandAsset: true as const } : {}) }]
    },
    options
  )
}

/**
 * The entry a publish may save for `key`: listed and not claimed by the sweep.
 * Only the publish gate skips claimed entries; the writers keep them listed.
 */
function publishable(metadata: string | null, key: string): StagedUpload | undefined {
  return readStagedUploads(metadata).find((entry) => entry.key === key && !entry.sweeping)
}

/** Whether `key` is staged as an imported brand asset, which a publish must have confirmed. */
export function isStagedBrandAsset(metadata: string | null, key: string): boolean {
  return publishable(metadata, key)?.brandAsset === true
}

/** Whether `key` is on the staged list of this metadata text and a publish may still save it. */
export function isStaged(metadata: string | null, key: string): boolean {
  return publishable(metadata, key) !== undefined
}

/** Forget staged keys that are now saved (a publish calls this in its own transaction). */
export async function unstageUploads(
  keys: readonly string[],
  options: SettingsWriteOptions = {}
): Promise<void> {
  await writeMetadataKey(
    STAGED_UPLOADS_KEY,
    (stored) => readStagedUploads(stored).filter((entry) => !keys.includes(entry.key)),
    options
  )
}

/**
 * Put objects a publish stopped naming back on the staged list, so they are
 * removed a day later rather than at once: within that time an undo in the
 * editor can publish them again. Never refused for a full list (a publish
 * must not fail on it), and a key already listed keeps its place.
 */
export async function stageReplacedUploads(
  keys: readonly string[],
  options: SettingsWriteOptions & { now?: Date } = {}
): Promise<void> {
  const replaced = keys.filter(isStageableKey)
  if (replaced.length === 0) return
  const at = (options.now ?? new Date()).toISOString()
  await writeMetadataKey(
    STAGED_UPLOADS_KEY,
    (stored) => {
      const list = readStagedUploads(stored)
      const listed = new Set(list.map((entry) => entry.key))
      return [...list, ...replaced.filter((key) => !listed.has(key)).map((key) => ({ key, at }))]
    },
    options
  )
}

const isDue = (entry: StagedUpload, now: Date) => {
  const at = Date.parse(entry.at)
  // An unreadable time is treated as due: the reference check still guards it.
  return Number.isNaN(at) || now.getTime() - at >= STAGED_UPLOAD_GRACE_MS
}

/** The cron gate: is any staged upload a day old? One small read. */
export async function isStagedUploadSweepDue(options: { now?: Date } = {}): Promise<boolean> {
  const now = options.now ?? new Date()
  const [row] = await db.select({ metadata: settings.metadata }).from(settings).limit(1)
  return readStagedUploads(row?.metadata ?? null).some((entry) => isDue(entry, now))
}

export interface StagedUploadSweepResult {
  /** Objects deleted. */
  removed: number
  /** Records forgotten without a delete: the settings row names the key. */
  kept: number
  /** Deletes that failed or timed out; their records stay, marked, for the next run. */
  failed: number
}

/** Delete one object, giving up after `timeoutMs` even if the store never answers. */
async function deleteWithTimeout(key: string, timeoutMs: number): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs)
  let stop = () => {}
  const timedOut = new Promise<never>((_, reject) => {
    stop = () => reject(new Error(`deleting ${key} took longer than ${timeoutMs}ms`))
    signal.addEventListener('abort', stop, { once: true })
  })
  try {
    // The signal also aborts the request itself; the race covers a store
    // that ignores it.
    await Promise.race([deleteObject(key, { signal }), timedOut])
  } finally {
    signal.removeEventListener('abort', stop)
  }
}

/** Every stored value of the row except the staged list itself, as one text to search. */
function referenceText(row: typeof settings.$inferSelect, bag: Record<string, unknown>): string {
  const { [STAGED_UPLOADS_KEY]: _staged, ...rest } = bag
  return JSON.stringify({ ...row, metadata: rest })
}

/**
 * Under the row lock, with no storage calls: forget what is done with (a key
 * the row names, or one outside the staged prefixes) and mark up to
 * MAX_SWEEP_DELETES of the rest for deletion. Returns the marked keys.
 */
async function claimDueUploads(
  tx: Transaction,
  now: Date,
  result: StagedUploadSweepResult
): Promise<string[] | null> {
  const [row] = await tx.select().from(settings).limit(1).for('update')
  if (!row) return null
  const bag = parsedBag(row.metadata, row.id)
  const list = stagedIn(bag)
  if (!list.some((entry) => isDue(entry, now))) return null

  const references = referenceText(row, bag)
  const claimed: string[] = []
  const next: StagedUpload[] = []
  for (const entry of list) {
    if (!isDue(entry, now)) {
      next.push(entry)
      continue
    }
    if (!isStageableKey(entry.key)) {
      log.warn({ key: entry.key }, 'staged upload outside the staged prefixes; forgotten')
      continue
    }
    if (references.includes(entry.key)) {
      result.kept++
      continue
    }
    if (claimed.length < MAX_SWEEP_DELETES) {
      claimed.push(entry.key)
      next.push({ ...entry, sweeping: true })
    } else {
      next.push(entry)
    }
  }

  bag[STAGED_UPLOADS_KEY] = next
  await tx
    .update(settings)
    .set({ metadata: JSON.stringify(bag) })
    .where(eq(settings.id, row.id))
  return claimed
}

/** Remove the staged uploads nothing refers to a day after they were staged. */
export async function sweepStagedUploads(
  options: { now?: Date; deleteTimeoutMs?: number } = {}
): Promise<StagedUploadSweepResult> {
  const now = options.now ?? new Date()
  const timeoutMs = options.deleteTimeoutMs ?? STAGED_UPLOAD_DELETE_TIMEOUT_MS
  const result: StagedUploadSweepResult = { removed: 0, kept: 0, failed: 0 }

  // 1. A short transaction: check and mark under the lock, then commit.
  const claimed = await db.transaction((tx) => claimDueUploads(tx, now, result))
  if (claimed === null) {
    log.info({ ...result }, 'staged upload sweep')
    return result
  }
  await invalidateSettingsCache()

  // 2. The deletes, with no transaction open.
  const started = Date.now()
  const deleted: string[] = []
  for (const key of claimed) {
    // Past the budget, the rest stay marked for the next run.
    if (Date.now() - started >= SWEEP_BUDGET_MS) break
    try {
      await deleteWithTimeout(key, timeoutMs)
      deleted.push(key)
    } catch (err) {
      if (isNotFound(err)) {
        deleted.push(key)
        continue
      }
      result.failed++
      log.warn({ err, key }, 'failed to delete staged upload; will retry')
    }
  }
  result.removed = deleted.length

  // 3. Another short transaction: forget what was deleted.
  if (deleted.length > 0) {
    try {
      await writeMetadataKey(STAGED_UPLOADS_KEY, (stored) =>
        readStagedUploads(stored).filter((entry) => !deleted.includes(entry.key))
      )
    } catch (err) {
      // They stay marked; the next run finds them gone and forgets them.
      log.error({ err, keys: deleted }, 'failed to forget deleted staged uploads')
      throw err
    }
  }
  log.info({ ...result }, 'staged upload sweep')
  return result
}
