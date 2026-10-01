/**
 * The HTTP half of a file upload, shared by the agent, widget, portal and
 * public API routes. Each route authenticates its own caller and says who the
 * sender is; this reads the body under the size cap and stores it.
 *
 * The body is the raw file (not multipart), named by `?name=`, so the server
 * reads it as a stream and stops at the cap instead of parsing a form that was
 * already buffered whole.
 */
import type { PrincipalId } from '@quackback/ids'
import { isS3Usable } from '@/lib/server/storage/s3'
import { readBodyWithLimit } from '@/lib/server/utils/read-body'
import {
  familyFor,
  formatBytes,
  maxBytesForFamily,
  MAX_ATTACHMENT_BYTES,
} from '@/lib/shared/files/file-types'
import { logger } from '@/lib/server/logger'
import { storeFile, toUploadedFile, FileRejectedError, type FileSource } from './files.service'

const log = logger.child({ component: 'file-upload' })

export interface FileUploadSender {
  source: FileSource
  uploadedById: PrincipalId | null
  unverifiedSender: boolean
}

const REJECTION_STATUS = { empty: 400, too_large: 413, blocked: 415 } as const

export async function handleFileUploadRequest(
  request: Request,
  sender: FileUploadSender
): Promise<Response> {
  if (!isS3Usable()) {
    return Response.json({ error: 'File storage is not configured' }, { status: 503 })
  }
  const url = new URL(request.url)
  const name = url.searchParams.get('name')
  if (!name) return Response.json({ error: 'Missing file name' }, { status: 400 })
  const declaredType = request.headers.get('content-type')

  // Read up to the cap the name or declared type allows. The bytes decide the
  // real family afterwards, and storeFile re-checks against that family's cap,
  // so a "video" that turns out to be a 90 MB PDF is still refused.
  const readCap = maxBytesForFamily(familyFor(name, declaredType ?? ''))
  const bytes = await readBodyWithLimit(request, Math.max(readCap, MAX_ATTACHMENT_BYTES))
  if (!bytes) {
    return Response.json(
      { error: `Over ${formatBytes(readCap)}`, reason: 'too_large' },
      { status: 413 }
    )
  }

  try {
    const row = await storeFile({
      bytes,
      name,
      declaredType,
      source: sender.source,
      uploadedById: sender.uploadedById,
      unverifiedSender: sender.unverifiedSender,
    })
    return Response.json(toUploadedFile(row), { status: 201 })
  } catch (err) {
    if (err instanceof FileRejectedError) {
      return Response.json(
        { error: err.message, reason: err.reason },
        { status: REJECTION_STATUS[err.reason] }
      )
    }
    log.error({ err, source: sender.source }, 'file upload failed')
    return Response.json({ error: 'Upload failed' }, { status: 500 })
  }
}
