/**
 * Knowledge-document server fns: upload (base64 body), list, and delete for
 * admin-uploaded PDFs Quinn grounds answers on. Gates on assistant.manage,
 * same as snippets (assistant-snippets.ts) and assistant-settings.ts.
 *
 * The upload carries its bytes as base64 rather than through the presigned
 * S3 flow: ingest needs the bytes server-side anyway (text extraction and
 * embedding happen here), so a presigned round-trip would only move the same
 * payload twice. The original bytes still land in object storage when S3 is
 * configured (document.service.ts).
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { AssistantDocumentId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-documents' })

// 5 MB of PDF is ~6.7 MB of base64; the cap rides the validator so oversize
// uploads fail before decode.
const BASE64_MAX_CHARS = Math.ceil((5 * 1024 * 1024) / 3) * 4

const uploadDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.literal('application/pdf'),
  dataBase64: z.string().min(1).max(BASE64_MAX_CHARS),
})

const deleteDocumentSchema = z.object({ id: z.string() })

export const uploadAssistantDocumentFn = createServerFn({ method: 'POST' })
  .validator(uploadDocumentSchema)
  .handler(async ({ data }) => {
    log.info({ file_name: data.fileName }, 'upload assistant document')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { ingestAssistantDocument } =
      await import('@/lib/server/domains/assistant/document.service')
    const bytes = new Uint8Array(Buffer.from(data.dataBase64, 'base64'))
    const row = await ingestAssistantDocument({
      title: data.title,
      fileName: data.fileName,
      mimeType: data.mimeType,
      bytes,
      createdById: ctx.principal.id,
    })
    return { id: row.id, title: row.title }
  })

export const listAssistantDocumentsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list assistant documents')
  await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
  const { listAssistantDocuments } = await import('@/lib/server/domains/assistant/document.service')
  return listAssistantDocuments()
})

export const deleteAssistantDocumentFn = createServerFn({ method: 'POST' })
  .validator(deleteDocumentSchema)
  .handler(async ({ data }) => {
    log.info({ assistant_document_id: data.id }, 'delete assistant document')
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { deleteAssistantDocument } =
      await import('@/lib/server/domains/assistant/document.service')
    await deleteAssistantDocument(data.id as AssistantDocumentId)
    return { ok: true }
  })
