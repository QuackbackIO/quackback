/**
 * Widget thread attachments — POST /api/widget/tickets/:ticketId/threads/:threadId/attachments
 *
 * Lets the requester attach an image to one of THEIR OWN threads on a ticket
 * they own. Two-step flow:
 *   1. Create the thread first via POST /api/widget/tickets/:ticketId/replies
 *      (or use the seed thread returned from POST /api/widget/tickets).
 *   2. Upload one or more images to that thread via this endpoint.
 *
 * Constraints (mirror `/api/v1/.../attachments` and `/api/widget/upload`):
 *   - Image MIME types only (`isAllowedImageType`)
 *   - 5MB max (`MAX_FILE_SIZE`)
 *   - Shared S3 prefix `'widget-images'`
 *
 * Authorization gates:
 *   - `widgetTicketingGate` — workspace must have ticketing enabled
 *   - identified widget session (anonymous rejected)
 *   - `widgetConfig.imageUploadsInWidget === true`
 *   - ownership: `getTicketForPortalUser` (404 on miss, never 403)
 *   - thread.ticketId must equal the URL ticketId
 *   - thread.audience must be `'public'` (requester surface only)
 *   - thread.principalId must equal the requester's principal — requesters
 *     cannot attach to staff replies
 */
import { createFileRoute } from '@tanstack/react-router'
import { db, eq, principal as principalTable } from '@/lib/server/db'
import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { getTicketForPortalUser } from '@/lib/server/domains/tickets/ticket.portal-query'
import { getThread, attachToThread } from '@/lib/server/domains/tickets'
import { getWidgetConfig } from '@/lib/server/domains/settings/settings.widget'
import {
  isS3Configured,
  isAllowedAttachmentType,
  MAX_ATTACHMENT_FILE_SIZE,
  generateStorageKey,
  uploadObject,
} from '@/lib/server/storage/s3'
import {
  mapDomainErrorToResponse,
  widgetCorsHeaders,
  widgetJsonError,
} from '@/lib/server/widget/cors'
import { widgetTicketingGate } from '@/lib/server/widget/ticketing-gate'
import type { PrincipalId, TicketId, TicketThreadId, UserId } from '@quackback/ids'

const STORAGE_PREFIX = 'ticket-attachments'

export async function handleWidgetThreadAttachmentUpload({
  request,
  params,
}: {
  request: Request
  params: { ticketId: string; threadId: string }
}): Promise<Response> {
  const disabled = await widgetTicketingGate()
  if (disabled) return disabled
  const session = await getWidgetSession(request)
  if (!session) {
    return widgetJsonError('AUTH_REQUIRED', 'Valid widget session required', 401)
  }
  if (session.principal.type === 'anonymous') {
    return widgetJsonError(
      'IDENTITY_REQUIRED',
      'Identify the widget user before uploading attachments',
      403
    )
  }

  const widgetConfig = await getWidgetConfig()
  if (!widgetConfig.imageUploadsInWidget) {
    return widgetJsonError('IMAGE_UPLOADS_DISABLED', 'Image uploads are disabled', 403)
  }
  if (!isS3Configured()) {
    return widgetJsonError('STORAGE_NOT_CONFIGURED', 'Storage is not configured', 503)
  }

  const ticketId = params.ticketId as TicketId
  const threadId = params.threadId as TicketThreadId

  try {
    // Ownership: throws NotFoundError on miss, never ForbiddenError.
    await getTicketForPortalUser({
      userId: session.user.id as UserId,
      ticketId,
    })

    const thread = await getThread(threadId)
    if (!thread || thread.deletedAt || thread.ticketId !== ticketId) {
      return widgetJsonError('THREAD_NOT_FOUND', 'Thread not found', 404)
    }
    if (thread.audience !== 'public') {
      return widgetJsonError('THREAD_NOT_PUBLIC', 'Cannot attach to non-public threads', 403)
    }

    // Requesters can only attach to their own threads (never staff replies).
    const viewerPrincipal = await db.query.principal.findFirst({
      where: eq(principalTable.userId, session.user.id as UserId),
    })
    const viewerPrincipalId = (viewerPrincipal?.id as PrincipalId | undefined) ?? null
    if (!viewerPrincipalId || thread.principalId !== viewerPrincipalId) {
      return widgetJsonError('THREAD_NOT_OWNER', "Cannot attach to another author's thread", 403)
    }

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return widgetJsonError('VALIDATION_ERROR', 'expected multipart/form-data', 400)
    }
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return widgetJsonError('VALIDATION_ERROR', 'missing "file" field', 400)
    }
    if (!isAllowedAttachmentType(file.type)) {
      return widgetJsonError('VALIDATION_ERROR', `unsupported file type: ${file.type}`, 400)
    }
    if (file.size === 0) {
      return widgetJsonError('VALIDATION_ERROR', 'file is empty', 400)
    }
    if (file.size > MAX_ATTACHMENT_FILE_SIZE) {
      return widgetJsonError(
        'VALIDATION_ERROR',
        `file exceeds ${MAX_ATTACHMENT_FILE_SIZE / 1024 / 1024}MB`,
        400
      )
    }

    const ext = file.name.split('.').pop() || 'bin'
    const filename = file.name || `upload-${Date.now()}.${ext}`
    const key = generateStorageKey(STORAGE_PREFIX, filename)
    const buffer = Buffer.from(await file.arrayBuffer())
    const publicUrl = await uploadObject(key, buffer, file.type)

    const created = await attachToThread({
      threadId,
      uploadedByPrincipalId: viewerPrincipalId,
      filename,
      mimeType: file.type,
      sizeBytes: file.size,
      storageKey: key,
      publicUrl,
    })

    return Response.json(
      {
        data: {
          id: created.id,
          threadId: created.threadId,
          filename: created.filename,
          mimeType: created.mimeType,
          sizeBytes: created.sizeBytes,
          publicUrl: created.publicUrl,
          createdAt: created.createdAt.toISOString(),
        },
      },
      { status: 201, headers: widgetCorsHeaders() }
    )
  } catch (err) {
    const mapped = mapDomainErrorToResponse(err)
    if (mapped) return mapped
    console.error('[widget:tickets] attachment upload error', err)
    return widgetJsonError('SERVER_ERROR', 'Failed to upload attachment', 500)
  }
}

export const Route = createFileRoute('/api/widget/tickets/$ticketId/threads/$threadId/attachments')(
  {
    server: {
      handlers: {
        POST: handleWidgetThreadAttachmentUpload,
      },
    },
  }
)
