/**
 * The `file-retention` job: remove stored files nothing can reach any more.
 *
 * Two kinds of file qualify:
 *
 *  - NEVER SENT. An upload writes its row before any message exists, so a
 *    file still unattached a day later was abandoned (a composer closed, a
 *    chip removed). A day is long enough that a file uploaded while a reply is
 *    being written is never touched.
 *  - ORPHANED. A file whose first message was deleted for good (a conversation
 *    deleted permanently, spam retention) has its `message_id` cleared by the
 *    foreign key. A later message may still carry it (a ticket that copied the
 *    attachment), so it is removed only when no remaining message's
 *    attachments name it.
 *
 * A send can link a file at any moment, so each file is CLAIMED before any
 * object goes: one UPDATE sets `deleted_at` only while the row still
 * qualifies, and a file a send linked first is left alone. From the claim on,
 * a send that reads the row is told the file is gone (`FILE_EXPIRED`), and a
 * send that already read it fails when it links it (`linkFilesToMessage`
 * re-reads the row under a lock, so the two cannot both win). An orphaned
 * file's references are checked again after its claim, in a statement that
 * sees every message committed before it; one a message now carries is
 * released.
 *
 * Then the objects go. A storage failure releases the claim (clears
 * `deleted_at` back), so the file stays usable and the next run retries it.
 * A process that dies between the claim and the release leaves a deleted row
 * whose objects remain: nothing mints a link for them any more, so the cost is
 * storage, never a file served after its row said it was gone. Once the
 * objects are gone the row stays as a tombstone (name, size, hash) with the
 * derived content (preview meta, text excerpt) cleared, since it came from
 * the bytes that are gone.
 *
 * Only `files/` objects are ever deleted. A row or preview key that names
 * anything else is left for whoever owns it.
 */
import type { FileId } from '@quackback/ids'
import { db, files, and, asc, gt, isNull, isNotNull, like, lt, sql, eq } from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import { deleteObject } from '@/lib/server/storage/s3'
import type { JobHandler } from '@/lib/server/jobs/definitions'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'
import { FILES_PREFIX } from './files.service'

const log = logger.child({ component: 'file-retention' })

export const FILE_RETENTION_QUEUE = 'file-retention'

/** How long an upload may sit unsent before it is removed. */
export const UNSENT_FILE_GRACE_MS = 24 * 60 * 60_000

const DEFAULT_BATCH_SIZE = 200
/** Stop starting new batches after this; the next run picks up the rest. */
const DEFAULT_BUDGET_MS = 45_000

export interface FileRetentionResult {
  /** Files whose objects were deleted and rows marked. */
  removed: number
  /** Files left for the next run because a storage delete failed. */
  failed: number
  /**
   * Files kept because a message carries them: an orphan a later message
   * copied, or a file a send linked while the sweep was running.
   */
  kept: number
}

type Phase = 'unsent' | 'orphaned'

/** What makes a file removable in a phase: unsent past the grace period, or orphaned. */
function qualifies(phase: Phase, unsentBefore: Date): SQL | undefined {
  return phase === 'unsent'
    ? and(isNull(files.attachedAt), lt(files.createdAt, unsentBefore))
    : and(isNotNull(files.attachedAt), isNull(files.messageId))
}

function isPipelineKey(key: string | undefined | null): key is string {
  return typeof key === 'string' && key.startsWith(`${FILES_PREFIX}/`)
}

/**
 * The file ids, among `ids`, that some message's attachments still name. One
 * pass over the messages that carry attachments, whatever the batch size.
 */
async function referencedFileIds(ids: FileId[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const result = await db.execute(sql`
    SELECT DISTINCT elem->>'fileId' AS file_id
    FROM conversation_messages
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(attachments) = 'array' THEN attachments ELSE '[]'::jsonb END
    ) AS elem
    WHERE attachments IS NOT NULL
      AND elem->>'fileId' = ANY(ARRAY[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )}]::text[])
  `)
  return new Set(getExecuteRows<{ file_id: string }>(result).map((r) => r.file_id))
}

/** Mark a file deleted while it still qualifies for its phase. Null when a send linked it first. */
async function claimFile(id: FileId, phase: Phase, unsentBefore: Date, now: Date) {
  const [claimed] = await db
    .update(files)
    .set({ deletedAt: now })
    .where(and(eq(files.id, id), isNull(files.deletedAt), qualifies(phase, unsentBefore)))
    .returning({ id: files.id, storageKey: files.storageKey, meta: files.meta })
  return claimed ?? null
}

/** Undo a claim: the file is usable again and a later run looks at it afresh. */
async function releaseClaim(id: FileId, now: Date): Promise<void> {
  await db
    .update(files)
    .set({ deletedAt: null })
    .where(and(eq(files.id, id), eq(files.deletedAt, now)))
}

type Removal = 'removed' | 'failed' | 'kept'

/** Claim a file, delete its objects, then clear what was derived from them. */
async function removeFile(
  id: FileId,
  phase: Phase,
  unsentBefore: Date,
  now: Date
): Promise<Removal> {
  const file = await claimFile(id, phase, unsentBefore, now)
  if (!file) return 'kept'
  // A message committed before the claim may name the file; none can after it.
  if (phase === 'orphaned' && (await referencedFileIds([id])).has(id)) {
    await releaseClaim(id, now)
    return 'kept'
  }

  const keys = [file.storageKey, file.meta?.thumbKey, file.meta?.renditionKey].filter(isPipelineKey)
  try {
    for (const key of keys) await deleteObject(key)
  } catch (err) {
    log.warn({ err, fileId: id }, 'file object delete failed; the next run retries it')
    await releaseClaim(id, now)
    return 'failed'
  }
  await db.update(files).set({ meta: {}, textExcerpt: null }).where(eq(files.id, id))
  return 'removed'
}

/**
 * Remove unsent and orphaned files, in batches of `batchSize`, until none
 * remain or `budgetMs` has passed. Each phase pages by id, so a file whose
 * delete failed is tried once per run, not once per batch.
 */
export async function sweepFileRetention(opts?: {
  now?: Date
  batchSize?: number
  budgetMs?: number
}): Promise<FileRetentionResult> {
  const now = opts?.now ?? new Date()
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE
  const deadline = Date.now() + (opts?.budgetMs ?? DEFAULT_BUDGET_MS)
  const unsentBefore = new Date(now.getTime() - UNSENT_FILE_GRACE_MS)
  const result: FileRetentionResult = { removed: 0, failed: 0, kept: 0 }

  for (const phase of ['unsent', 'orphaned'] as const) {
    let after: FileId | null = null
    for (;;) {
      const batch: Array<{ id: FileId }> = await db
        .select({ id: files.id })
        .from(files)
        .where(
          and(
            qualifies(phase, unsentBefore),
            isNull(files.deletedAt),
            like(files.storageKey, `${FILES_PREFIX}/%`),
            after ? gt(files.id, after) : undefined
          )
        )
        .orderBy(asc(files.id))
        .limit(batchSize)
      if (batch.length === 0) break

      // Most orphans a message still carries are found here in one pass,
      // rather than claimed and released one by one.
      const referenced =
        phase === 'orphaned' ? await referencedFileIds(batch.map((f) => f.id)) : new Set<string>()
      for (const file of batch) {
        const removal = referenced.has(file.id)
          ? 'kept'
          : await removeFile(file.id, phase, unsentBefore, now)
        result[removal] += 1
      }

      after = batch[batch.length - 1]!.id
      if (batch.length < batchSize || Date.now() >= deadline) break
    }
  }

  if (result.removed > 0 || result.failed > 0) {
    log.info({ ...result }, 'file retention sweep complete')
  }
  return result
}

export const runFileRetention: JobHandler = async () => {
  await sweepFileRetention()
}
