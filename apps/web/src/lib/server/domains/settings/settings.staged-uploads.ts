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
 *  - The deletes happen under the settings row lock, which a publish also
 *    takes, so a publish cannot save a key between the check and the delete.
 *    A publish that comes after the delete is refused for a key no longer
 *    staged (see the publish service).
 */
import { db, eq, settings, type Database, type Transaction } from '@/lib/server/db'
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
 * Deletes per run, and a time budget well inside the job's 60s lease. The
 * deletes hold the settings row lock, so a run stays short; what is left
 * stays listed for the next run.
 */
export const MAX_SWEEP_DELETES = 25
const SWEEP_BUDGET_MS = 20_000

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

/** Whether `key` is staged as an imported brand asset, which a publish must have confirmed. */
export function isStagedBrandAsset(metadata: string | null, key: string): boolean {
  return readStagedUploads(metadata).some((entry) => entry.key === key && entry.brandAsset === true)
}

/** Whether `key` is on the staged list of this metadata text. */
export function isStaged(metadata: string | null, key: string): boolean {
  return readStagedUploads(metadata).some((entry) => entry.key === key)
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
  /** Deletes that failed; their records stay for the next run. */
  failed: number
}

/** Every stored value of the row except the staged list itself, as one text to search. */
function referenceText(row: typeof settings.$inferSelect, bag: Record<string, unknown>): string {
  const { [STAGED_UPLOADS_KEY]: _staged, ...rest } = bag
  return JSON.stringify({ ...row, metadata: rest })
}

/** Remove the staged uploads nothing refers to a day after they were staged. */
export async function sweepStagedUploads(
  options: { now?: Date } = {}
): Promise<StagedUploadSweepResult> {
  const now = options.now ?? new Date()
  const result: StagedUploadSweepResult = { removed: 0, kept: 0, failed: 0 }

  const sweep = async (tx: Database | Transaction) => {
    const [row] = await tx.select().from(settings).limit(1).for('update')
    if (!row) return false
    const bag = parsedBag(row.metadata, row.id)
    const list = stagedIn(bag)
    const due = list.filter((entry) => isDue(entry, now))
    if (due.length === 0) return false

    const references = referenceText(row, bag)
    const started = Date.now()
    const leftForNextRun: StagedUpload[] = []
    for (const entry of due) {
      if (
        result.removed + result.failed >= MAX_SWEEP_DELETES ||
        Date.now() - started >= SWEEP_BUDGET_MS
      ) {
        leftForNextRun.push(entry)
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
      try {
        await deleteObject(entry.key)
        result.removed++
      } catch (err) {
        if (isNotFound(err)) {
          result.removed++
          continue
        }
        result.failed++
        leftForNextRun.push(entry)
        log.warn({ err, key: entry.key }, 'failed to delete staged upload; will retry')
      }
    }

    bag[STAGED_UPLOADS_KEY] = [...list.filter((entry) => !isDue(entry, now)), ...leftForNextRun]
    await tx
      .update(settings)
      .set({ metadata: JSON.stringify(bag) })
      .where(eq(settings.id, row.id))
    return true
  }

  const wrote = await db.transaction(sweep)
  if (wrote) await invalidateSettingsCache()
  log.info({ ...result }, 'staged upload sweep')
  return result
}
