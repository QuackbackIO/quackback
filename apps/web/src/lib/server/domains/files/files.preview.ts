/**
 * The `file-preview` job: derive what a file's card and viewer can show
 * without opening it (counts, a thumbnail, the first rows or lines, a text
 * excerpt), write it to the `files` row, and copy it onto the message the file
 * was attached to.
 *
 * Every file it reads came from a stranger. The bytes are read with the
 * file's own size cap, each deriver holds its own budgets, and the whole run
 * has a time budget checked between phases. A file that cannot be read is
 * recorded as 'failed' and the job succeeds; only a fault in storage, the
 * database or a missing parser throws, so the queue retries.
 */
import type { FileId } from '@quackback/ids'
import {
  db,
  files,
  conversationMessages,
  eq,
  and,
  isNull,
  type ConversationMessage,
  type FileRecord,
  type FilePreviewMeta,
} from '@/lib/server/db'
import { getS3Object, uploadObject } from '@/lib/server/storage/s3'
import { maxBytesForFamily, type FileFamily } from '@/lib/shared/files/file-types'
import { logger } from '@/lib/server/logger'
import {
  Deadline,
  NOTHING_TO_DERIVE,
  PreviewDependencyError,
  PreviewRefusedError,
  deriveFromBytes,
  deriveMediaPreview,
  previewKind,
  type PreviewResult,
} from './preview'
import { withFilePreview } from './files.service'

export const FILE_PREVIEW_QUEUE = 'file-preview'

const log = logger.child({ component: 'file-preview' })

/** Wall-clock budget for one file, checked between phases. */
const PREVIEW_BUDGET_MS = 60_000

export type PreviewOutcome = 'skipped' | 'ready' | 'none' | 'failed'

/** Storage could not be read: retry, the file is not at fault. */
class StorageReadError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Stored file could not be read', options)
    this.name = 'StorageReadError'
  }
}

/** The stored object is bigger than its row's cap allows. */
class OverBudgetError extends Error {
  constructor() {
    super('Stored file is over its size cap')
    this.name = 'OverBudgetError'
  }
}

/**
 * Read an object, or a range of it, refusing more than `maxBytes`. A storage
 * that ignores the range would hand back the wrong bytes, so a ranged read
 * that does not come back as that range is a storage fault.
 */
async function readObject(
  key: string,
  maxBytes: number,
  range?: { offset: number; length: number }
): Promise<Uint8Array> {
  if (range && range.length <= 0) return new Uint8Array(0)
  let object: Awaited<ReturnType<typeof getS3Object>>
  try {
    object = await getS3Object(
      key,
      range ? `bytes=${range.offset}-${range.offset + range.length - 1}` : undefined
    )
  } catch (err) {
    throw new StorageReadError({ cause: err })
  }
  if (range && range.offset > 0 && !object.contentRange?.startsWith(`bytes ${range.offset}-`)) {
    await object.body.cancel().catch(() => {})
    throw new StorageReadError()
  }

  const reader = object.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new OverBudgetError()
      }
      chunks.push(value)
    }
  } catch (err) {
    if (err instanceof OverBudgetError) throw err
    throw new StorageReadError({ cause: err })
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function derive(file: FileRecord, deadline: Deadline): Promise<PreviewResult> {
  const family = file.family as FileFamily
  const kind = previewKind(family, file.contentType)
  if (!kind) return NOTHING_TO_DERIVE
  const cap = maxBytesForFamily(family)
  if (kind === 'media') {
    const size = Math.min(file.size, cap)
    return deriveMediaPreview(
      (offset, length) =>
        readObject(file.storageKey, length, {
          offset,
          length: Math.max(0, Math.min(length, size - offset)),
        }),
      size
    )
  }
  const bytes = await readObject(file.storageKey, cap)
  deadline.check()
  return deriveFromBytes(kind, bytes, file.contentType, deadline)
}

function isInfrastructureFault(err: unknown): boolean {
  return err instanceof StorageReadError || err instanceof PreviewDependencyError
}

/**
 * Write the outcome to the row and, when the file is already on a message,
 * the preview onto that message's attachment, in one transaction. Returns
 * the patched message, if any.
 */
async function writeOutcome(
  file: FileRecord,
  status: 'ready' | 'none' | 'failed',
  meta: FilePreviewMeta,
  excerpt: string | undefined
): Promise<ConversationMessage | null> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(files)
      .set({
        previewStatus: status,
        ...(status === 'ready' ? { meta, ...(excerpt ? { textExcerpt: excerpt } : {}) } : {}),
      })
      .where(and(eq(files.id, file.id), isNull(files.deletedAt)))
      .returning({ messageId: files.messageId })
    // A file not sent yet has nothing to patch: sending copies the row's meta.
    if (status !== 'ready' || !updated?.messageId) return null

    const [message] = await tx
      .select({ id: conversationMessages.id, attachments: conversationMessages.attachments })
      .from(conversationMessages)
      .where(eq(conversationMessages.id, updated.messageId))
      .for('update')
    if (!message?.attachments?.some((a) => a.fileId === file.id)) return null

    const attachments = message.attachments.map((a) =>
      a.fileId === file.id ? withFilePreview(a, file.family, meta) : a
    )
    const [patched] = await tx
      .update(conversationMessages)
      .set({ attachments })
      .where(eq(conversationMessages.id, message.id))
      .returning()
    return patched ?? null
  })
}

/** Derive and store one file's preview. Throws only for faults worth retrying. */
export async function generateFilePreview(
  fileId: FileId,
  options: {
    budgetMs?: number
    /** Told about the message whose attachment now carries the preview. */
    onMessagePatched?: (message: ConversationMessage) => Promise<void>
  } = {}
): Promise<PreviewOutcome> {
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1)
  if (!file || file.deletedAt || file.previewStatus === 'ready') return 'skipped'

  const started = Date.now()
  const deadline = new Deadline(options.budgetMs ?? PREVIEW_BUDGET_MS)
  let result: PreviewResult | null = null
  let reason: string | undefined
  try {
    result = await derive(file, deadline)
  } catch (err) {
    if (isInfrastructureFault(err)) throw err
    // The name (or a refusal's code) says which check refused the file;
    // messages can quote its bytes.
    reason =
      err instanceof PreviewRefusedError ? err.reason : err instanceof Error ? err.name : 'unknown'
  }

  let meta: FilePreviewMeta = file.meta ?? {}
  if (result?.status === 'ready') {
    meta = { ...meta, ...result.meta }
    for (const object of result.derived ?? []) {
      const key = `${file.storageKey}.${object.suffix}`
      await uploadObject(key, object.bytes, object.contentType)
      meta[object.field] = key
    }
  }
  const outcome = result ? result.status : 'failed'
  const patched = await writeOutcome(file, outcome, meta, result?.excerpt)

  if (patched && options.onMessagePatched) {
    try {
      await options.onMessagePatched(patched)
    } catch (err) {
      // Open threads miss the live update and show the preview on reload.
      log.warn({ err, fileId }, 'file preview update not published')
    }
  }

  log.info(
    { fileId, family: file.family, outcome, durationMs: Date.now() - started, reason },
    'file preview'
  )
  return outcome
}

/** A file whose preview attempts are spent stops waiting for one. */
export async function markFilePreviewFailed(fileId: FileId): Promise<void> {
  await db
    .update(files)
    .set({ previewStatus: 'failed' })
    .where(and(eq(files.id, fileId), eq(files.previewStatus, 'pending')))
}
