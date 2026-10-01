/**
 * Files attached to conversation and ticket messages.
 *
 * Every entry point (the agent composer, the widget, the portal, inbound email
 * and the public API) stores bytes through `storeFile`, which decides the type
 * from the bytes, applies the sender's policy and size cap, writes the object
 * and a `files` row, and queues the preview job. A message then attaches files
 * by id through `resolveAttachments`, which takes type, size and URL from the
 * row rather than from the request.
 */
import { createHash } from 'node:crypto'
import { isValidTypeId, type FileId, type PrincipalId } from '@quackback/ids'
import {
  db,
  files,
  conversationMessages,
  eq,
  and,
  inArray,
  isNull,
  sql,
  type Transaction,
} from '@/lib/server/db'
import type { ConversationAttachment, FilePreviewMeta, FileRecord } from '@/lib/server/db'
import { sniffFile, isRefusedFromUnverifiedSender } from '@/lib/server/content/file-sniff'
import { generateStorageKey, uploadObject, getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { isTrustedAttachmentUrl, namesPipelineFile } from '@/lib/server/storage/trusted-url'
import { toUserContentUrl } from '@/lib/server/storage/asset-url'
import {
  familyFor,
  maxBytesForFamily,
  formatBytes,
  type FileFamily,
} from '@/lib/shared/files/file-types'
import { stripInvisible } from '@/lib/shared/files/file-name'
import { MAX_CONVERSATION_ATTACHMENTS, type UploadedFile } from '@/lib/shared/conversation/types'
import { ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'files' })

/** Object-storage prefix for every file stored through the pipeline. Private. */
export const FILES_PREFIX = 'files'

export type FileSource = 'agent' | 'visitor' | 'portal' | 'email' | 'api'

export type FileRejection = 'empty' | 'too_large' | 'blocked'

/** A file the pipeline will not store. `message` is safe to show the sender. */
export class FileRejectedError extends Error {
  constructor(
    readonly reason: FileRejection,
    message: string
  ) {
    super(message)
    this.name = 'FileRejectedError'
  }
}

export interface StoreFileInput {
  bytes: Uint8Array
  name: string
  declaredType?: string | null
  source: FileSource
  uploadedById?: PrincipalId | null
  /**
   * Anonymous widget visitors and inbound email: their identity is not
   * verified, so executables and scripts are refused.
   */
  unverifiedSender: boolean
}

/**
 * Strip any path, control, bidirectional and invisible characters and
 * surrounding space; cap the length.
 */
export function cleanFileName(raw: string | null | undefined): string {
  const base = String(raw ?? '')
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop()!
  const cleaned = stripInvisible(base).trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'file'
  if (cleaned.length <= 255) return cleaned
  const dot = cleaned.lastIndexOf('.')
  const ext = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : ''
  return cleaned.slice(0, 255 - ext.length) + ext
}

/**
 * The upload response. Its URL is for the uploader's browser, so it loads from
 * the user-content origin when one is configured.
 */
export function toUploadedFile(row: FileRecord): UploadedFile {
  const url = getPublicUrlOrNull(row.storageKey)
  return {
    fileId: row.id,
    url: url ? toUserContentUrl(url) : '',
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    family: row.family as FileFamily,
  }
}

export async function storeFile(input: StoreFileInput): Promise<FileRecord> {
  const name = cleanFileName(input.name)
  const size = input.bytes.byteLength
  if (size === 0) throw new FileRejectedError('empty', 'The file is empty')

  const sniffed = sniffFile(input.bytes, name)
  if (input.unverifiedSender && isRefusedFromUnverifiedSender(sniffed, name)) {
    throw new FileRejectedError('blocked', "This file type can't be sent")
  }
  const cap = maxBytesForFamily(sniffed.family)
  if (size > cap) throw new FileRejectedError('too_large', `Over ${formatBytes(cap)}`)

  const key = generateStorageKey(FILES_PREFIX, name)
  await uploadObject(key, input.bytes, sniffed.contentType)

  const sha256 = createHash('sha256').update(input.bytes).digest('hex')
  const meta: FilePreviewMeta = sniffed.macro ? { macro: true } : {}
  const [row] = await db
    .insert(files)
    .values({
      storageKey: key,
      name,
      contentType: sniffed.contentType,
      declaredType: input.declaredType?.slice(0, 128) || null,
      family: sniffed.family,
      size,
      sha256,
      source: input.source,
      uploadedById: input.uploadedById ?? null,
      meta,
    })
    .returning()

  await queueFilePreview(row!.id)
  return row!
}

/**
 * Queue the preview job for a stored file. A failure to queue is logged, not
 * thrown: the file is stored and usable, it only lacks a thumbnail.
 */
async function queueFilePreview(fileId: FileId): Promise<void> {
  try {
    const { enqueueJob } = await import('@/lib/server/jobs/job-queue')
    await enqueueJob({
      queue: 'file-preview',
      payload: { fileId },
      dedupeKey: fileId,
      maxAttempts: 2,
    })
  } catch (err) {
    log.warn({ err, fileId }, 'file preview job could not be queued')
  }
}

export interface AttachmentSender {
  principalId?: PrincipalId | null
  /**
   * Team members may attach any stored file (forwarding a customer's file to
   * a ticket, say). Everyone else may attach only files they uploaded.
   */
  canAttachAnyFile: boolean
}

function legacyAttachment(a: ConversationAttachment): ConversationAttachment {
  if (!isTrustedAttachmentUrl(a?.url)) {
    throw new ValidationError('VALIDATION_ERROR', 'Invalid attachment')
  }
  // A pipeline file comes by id, whose row says who may attach it.
  if (namesPipelineFile(a.url)) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Invalid attachment: attach this file by its fileId'
    )
  }
  const name = stripInvisible(String(a.name ?? '')).slice(0, 255)
  const contentType = String(a.contentType ?? '').slice(0, 128)
  const size = Number(a.size)
  const cap = maxBytesForFamily(familyFor(name, contentType))
  if (!Number.isFinite(size) || size < 0 || size > cap) {
    throw new ValidationError('VALIDATION_ERROR', 'Attachment too large')
  }
  return { url: a.url, name, contentType, size }
}

/**
 * The attachment a message stores for a file row: every field from the row.
 * The URL stays a host-independent ref; `attachmentForClient` places it on an
 * origin at read time.
 */
export function attachmentFromFile(row: FileRecord): ConversationAttachment {
  const meta = row.meta ?? {}
  return {
    url: getPublicUrlOrNull(row.storageKey) ?? '',
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    fileId: row.id,
    family: row.family as FileFamily,
    ...(Object.keys(meta).length > 0 ? { preview: meta } : {}),
  }
}

/**
 * Validate and normalize the attachments a sender put on a message.
 *
 * An entry with a `fileId` is rebuilt from its `files` row, so type, size and
 * URL are the stored truth whatever the request said. An entry without one is
 * an older client or an API caller referencing an object it stored some other
 * way; it keeps the rules attachments always had (a URL from our own storage,
 * a size within the cap).
 */
export async function resolveAttachments(
  raw: ConversationAttachment[] | null | undefined,
  sender: AttachmentSender
): Promise<ConversationAttachment[]> {
  if (!raw || raw.length === 0) return []
  if (raw.length > MAX_CONVERSATION_ATTACHMENTS) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Too many attachments (max ${MAX_CONVERSATION_ATTACHMENTS})`
    )
  }

  const ids = [
    ...new Set(
      raw
        .map((a) => a?.fileId)
        .filter((id): id is string => typeof id === 'string' && isValidTypeId(id, 'file'))
    ),
  ]
  const rows = ids.length
    ? await db
        .select()
        .from(files)
        .where(and(inArray(files.id, ids as FileId[]), isNull(files.deletedAt)))
    : []
  const byId = new Map(rows.map((r) => [r.id as string, r]))

  return raw.map((a) => {
    if (typeof a?.fileId !== 'string') return legacyAttachment(a)
    const row = byId.get(a.fileId)
    if (!row) throw new ValidationError('VALIDATION_ERROR', 'Invalid attachment')
    if (!sender.canAttachAnyFile && row.uploadedById !== (sender.principalId ?? null)) {
      throw new ValidationError('VALIDATION_ERROR', 'Invalid attachment')
    }
    return attachmentFromFile(row)
  })
}

/**
 * Record the message a set of files was first sent on. Files already attached
 * keep their first message; a later message (a copy into a ticket) only
 * references them.
 */
export async function linkFilesToMessage(
  executor: Transaction | typeof db,
  attachments: ConversationAttachment[],
  messageId: string
): Promise<void> {
  const ids = attachments.map((a) => a.fileId).filter((id): id is string => !!id)
  if (ids.length === 0) return
  const linked = await executor
    .update(files)
    .set({ messageId: messageId as never, attachedAt: new Date() })
    .where(and(inArray(files.id, ids as FileId[]), isNull(files.attachedAt)))
    .returning({ id: files.id, family: files.family, meta: files.meta })

  // The preview job may have written a file's preview after the send read the
  // row and before this link: it found no message to patch then, so the
  // message takes the row's current preview here. Linking locks the row, so a
  // job that writes later finds the message and patches it itself.
  const fresh = new Map(linked.map((r) => [r.id as string, r]))
  let changed = false
  const next = attachments.map((a) => {
    const row = a.fileId ? fresh.get(a.fileId) : undefined
    if (!row || JSON.stringify(row.meta ?? {}) === JSON.stringify(a.preview ?? {})) return a
    changed = true
    return withFilePreview(a, row.family, row.meta ?? {})
  })
  if (changed) {
    await executor
      .update(conversationMessages)
      .set({ attachments: next })
      .where(eq(conversationMessages.id, messageId as never))
  }
}

/** An attachment carrying its file's current family and preview. */
export function withFilePreview(
  attachment: ConversationAttachment,
  family: string,
  meta: FilePreviewMeta
): ConversationAttachment {
  const { preview: _stale, ...rest } = attachment
  return {
    ...rest,
    family: family as FileFamily,
    ...(Object.keys(meta).length > 0 ? { preview: meta } : {}),
  }
}

/** Count a viewer open, so usage by format is measurable. */
export async function recordFileOpen(fileId: FileId): Promise<void> {
  await db
    .update(files)
    .set({ openCount: sql`${files.openCount} + 1` })
    .where(eq(files.id, fileId))
}

export async function getFile(fileId: FileId): Promise<FileRecord | null> {
  const [row] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .limit(1)
  return row ?? null
}
