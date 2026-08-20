/**
 * Knowledge-document ingest service: admin-uploaded files (PDFs and Word
 * documents) whose extracted text grounds Quinn's answers.
 *
 * Ingest is synchronous and small: extract the text layer (`./pdf-text`,
 * `./docx-text`), store the row, then embed best-effort — mirroring the
 * changelog embedding pattern (embedding failure is logged, never thrown,
 * and only costs semantic ranking: the keyword arm of
 * `documents-retrieval.ts` still finds the row).
 * When S3 is configured the original bytes are kept under the
 * `assistant-documents/` prefix; the extracted `content` column is the
 * grounding source of truth either way, so storage being unconfigured never
 * blocks an upload.
 */
import { db, assistantDocuments, eq, sql } from '@/lib/server/db'
import type { AssistantDocumentId, PrincipalId } from '@quackback/ids'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { getEmbeddingModel } from '@/lib/server/domains/ai/models'
import { isS3Usable, uploadObject, generateStorageKey } from '@/lib/server/storage/s3'
import { extractPdfText } from './pdf-text'
import { extractDocxText } from './docx-text'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-documents' })

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const ASSISTANT_DOCUMENT_MIME_TYPES = ['application/pdf', DOCX_MIME_TYPE] as const
export const ASSISTANT_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024
/** Stored-text ceiling; retrieval trims per row, this caps the whole document. */
export const ASSISTANT_DOCUMENT_MAX_CONTENT_CHARS = 100_000

export class DocumentIngestError extends Error {}

export interface IngestAssistantDocumentInput {
  title: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
  createdById: PrincipalId | null
}

/**
 * Generate and persist the embedding for one document. Best-effort: any
 * failure (unconfigured AI, a provider error) is caught and logged, and the
 * row keeps working through the keyword retrieval arm.
 */
async function embedAssistantDocument(id: AssistantDocumentId, title: string, content: string) {
  try {
    const embedding = await generateEmbedding(`${title}\n\n${content}`, {
      pipelineStep: 'assistant_document_embedding',
    })
    if (!embedding) return // AI unconfigured or the call failed (already logged)

    await db
      .update(assistantDocuments)
      .set({
        embedding: sql<number[]>`${`[${embedding.join(',')}]`}::vector`,
        embeddingModel: getEmbeddingModel() ?? 'unknown',
        embeddingUpdatedAt: new Date(),
      })
      .where(eq(assistantDocuments.id, id))

    log.debug({ assistant_document_id: id }, 'assistant document embedded')
  } catch (err) {
    log.error({ err, assistant_document_id: id }, 'assistant document embedding failed')
  }
}

/**
 * Ingest one uploaded document: validate, extract its text, persist the row
 * (plus the original bytes when object storage is configured), and embed.
 * Throws `DocumentIngestError` on anything the admin can act on — a wrong
 * type, an oversize file, or a document with no text layer (scanned image) —
 * rather than storing a document Quinn can never ground on.
 */
export async function ingestAssistantDocument(input: IngestAssistantDocumentInput) {
  const title = input.title.trim()
  if (!title) throw new DocumentIngestError('A title is required.')
  if (!(ASSISTANT_DOCUMENT_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new DocumentIngestError(
      `Unsupported file type: ${input.mimeType}. Upload a PDF or Word document.`
    )
  }
  if (input.bytes.byteLength > ASSISTANT_DOCUMENT_MAX_BYTES) {
    throw new DocumentIngestError('The file is too large. The limit is 5 MB.')
  }

  const extracted =
    input.mimeType === DOCX_MIME_TYPE ? extractDocxText(input.bytes) : extractPdfText(input.bytes)
  const content = extracted.slice(0, ASSISTANT_DOCUMENT_MAX_CONTENT_CHARS)
  if (!content) {
    throw new DocumentIngestError(
      'No text could be extracted from this document. Scanned or image-only files are not supported.'
    )
  }

  let storageKey: string | null = null
  if (isS3Usable()) {
    storageKey = generateStorageKey('assistant-documents', input.fileName)
    await uploadObject(storageKey, Buffer.from(input.bytes), input.mimeType)
  }

  const [row] = await db
    .insert(assistantDocuments)
    .values({
      title,
      fileName: input.fileName,
      mimeType: input.mimeType,
      storageKey,
      content,
      createdById: input.createdById,
    })
    .returning()

  await embedAssistantDocument(row.id, row.title, row.content)

  log.info(
    { assistant_document_id: row.id, chars: content.length, stored: storageKey !== null },
    'assistant document ingested'
  )
  return row
}

/** Soft-delete a document: it leaves every retrieval index at once. */
export async function deleteAssistantDocument(id: AssistantDocumentId) {
  await db
    .update(assistantDocuments)
    .set({ deletedAt: new Date() })
    .where(eq(assistantDocuments.id, id))
  log.info({ assistant_document_id: id }, 'assistant document deleted')
}

/** List live documents for the admin surface, newest first. */
export async function listAssistantDocuments() {
  return db
    .select({
      id: assistantDocuments.id,
      title: assistantDocuments.title,
      fileName: assistantDocuments.fileName,
      mimeType: assistantDocuments.mimeType,
      createdAt: assistantDocuments.createdAt,
    })
    .from(assistantDocuments)
    .where(sql`${assistantDocuments.deletedAt} IS NULL`)
    .orderBy(sql`${assistantDocuments.createdAt} DESC`)
}
