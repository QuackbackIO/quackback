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
 * Per file, the objects go first and the row is marked after. A storage
 * failure leaves the row untouched and the next run retries it; marking first
 * would leave an object nothing remembers. The row stays as a tombstone (name,
 * size, hash) with `deleted_at` set and the derived content (preview meta,
 * text excerpt) cleared, since it came from the bytes that are gone.
 *
 * Only `files/` objects are ever deleted. A row or preview key that names
 * anything else is left for whoever owns it.
 */
import type { FileId } from '@quackback/ids'
import { db, files, and, asc, gt, isNull, isNotNull, like, lt, sql, eq } from '@/lib/server/db'
import type { FilePreviewMeta } from '@/lib/server/db'
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
  /** Orphaned files kept because a remaining message still carries them. */
  kept: number
}

interface Candidate {
  id: FileId
  storageKey: string
  meta: FilePreviewMeta | null
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

/** Delete a file's objects, then mark its row. False when storage refused. */
async function removeFile(file: Candidate, now: Date): Promise<boolean> {
  const keys = [file.storageKey, file.meta?.thumbKey, file.meta?.renditionKey].filter(isPipelineKey)
  try {
    for (const key of keys) await deleteObject(key)
  } catch (err) {
    log.warn({ err, fileId: file.id }, 'file object delete failed; the next run retries it')
    return false
  }
  await db
    .update(files)
    .set({ deletedAt: now, meta: {}, textExcerpt: null })
    .where(and(eq(files.id, file.id), isNull(files.deletedAt)))
  return true
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

  const phases = [
    {
      name: 'unsent',
      where: and(isNull(files.attachedAt), lt(files.createdAt, unsentBefore)),
      orphaned: false,
    },
    {
      name: 'orphaned',
      where: and(isNotNull(files.attachedAt), isNull(files.messageId)),
      orphaned: true,
    },
  ]

  for (const phase of phases) {
    let after: FileId | null = null
    for (;;) {
      const batch: Candidate[] = await db
        .select({ id: files.id, storageKey: files.storageKey, meta: files.meta })
        .from(files)
        .where(
          and(
            phase.where,
            isNull(files.deletedAt),
            like(files.storageKey, `${FILES_PREFIX}/%`),
            after ? gt(files.id, after) : undefined
          )
        )
        .orderBy(asc(files.id))
        .limit(batchSize)
      if (batch.length === 0) break

      const referenced = phase.orphaned
        ? await referencedFileIds(batch.map((f) => f.id))
        : new Set<string>()
      for (const file of batch) {
        if (referenced.has(file.id)) {
          result.kept += 1
        } else if (await removeFile(file, now)) {
          result.removed += 1
        } else {
          result.failed += 1
        }
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
