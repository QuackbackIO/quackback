/**
 * Ticket attachments — metadata-only.
 *
 * The actual file upload pipeline (S3 / disk fallback) is reused unchanged
 * from `/api/upload/image`; this module records the metadata pointing at the
 * already-uploaded object.
 */
import {
  db,
  eq,
  ticketAttachments,
  ticketThreads,
  tickets,
  type TicketAttachment,
} from '@/lib/server/db'
import type { TicketId, TicketThreadId, TicketAttachmentId, PrincipalId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { recordEvent } from '../audit'
import { writeActivity, bumpLastActivity } from './ticket.service'

const MAX_FILENAME = 256
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB
const THREAD_PREVIEW_MAX = 500

export interface AttachInput {
  threadId: TicketThreadId
  uploadedByPrincipalId: PrincipalId | null
  filename: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  publicUrl?: string | null
}

async function loadTicketEventRef(ticketId: TicketId): Promise<Record<string, unknown>> {
  const ticket = await db.query.tickets.findFirst({
    where: eq(tickets.id, ticketId),
    columns: {
      id: true,
      subject: true,
      descriptionText: true,
      statusId: true,
      statusCategory: true,
      priority: true,
      channel: true,
      visibilityScope: true,
      inboxId: true,
      primaryTeamId: true,
      assigneePrincipalId: true,
      assigneeTeamId: true,
      requesterPrincipalId: true,
      requesterContactId: true,
    },
  })

  return ticket ?? { id: ticketId }
}

function threadPreview(bodyText: string): { bodyTextPreview: string; bodyTextTruncated: boolean } {
  return {
    bodyTextPreview:
      bodyText.length > THREAD_PREVIEW_MAX ? bodyText.slice(0, THREAD_PREVIEW_MAX) : bodyText,
    bodyTextTruncated: bodyText.length > THREAD_PREVIEW_MAX,
  }
}

async function dispatchThreadRefresh(args: {
  actor: { type: 'user' | 'service'; principalId?: string; displayName?: string }
  ticket: Record<string, unknown>
  thread: {
    id: string
    audience: 'public' | 'internal' | 'shared_team'
    sharedWithTeamId: string | null
    bodyText: string | null
    principalId: string | null
    createdAt: Date | string
    editedAt: Date | string | null
  }
}): Promise<void> {
  const { dispatchTicketThreadUpdated } = await import('@/lib/server/events/dispatch')
  const bodyText = args.thread.bodyText ?? ''
  const requesterPrincipalId =
    (args.ticket.requesterPrincipalId as string | null | undefined) ?? null
  const isFromRequester =
    args.thread.principalId !== null && args.thread.principalId === requesterPrincipalId

  await dispatchTicketThreadUpdated(
    args.actor,
    args.ticket,
    args.thread.id,
    args.thread.audience,
    args.thread.sharedWithTeamId,
    {
      ...threadPreview(bodyText),
      bodyText,
      authorPrincipalId: args.thread.principalId,
      isFromRequester,
      createdAt: args.thread.createdAt,
      editedAt: args.thread.editedAt,
    }
  )
}

export async function attachToThread(input: AttachInput): Promise<TicketAttachment> {
  const filename = input.filename?.trim()
  if (!filename) throw new ValidationError('TICKET_ATT_FILENAME_REQUIRED', 'filename required')
  if (filename.length > MAX_FILENAME) {
    throw new ValidationError('TICKET_ATT_FILENAME_TOO_LONG', `filename > ${MAX_FILENAME}`)
  }
  if (!input.mimeType?.trim()) {
    throw new ValidationError('TICKET_ATT_MIME_REQUIRED', 'mimeType required')
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new ValidationError('TICKET_ATT_SIZE_INVALID', 'sizeBytes must be positive')
  }
  if (input.sizeBytes > MAX_BYTES) {
    throw new ValidationError('TICKET_ATT_TOO_LARGE', `attachment exceeds ${MAX_BYTES} bytes`)
  }
  if (!input.storageKey?.trim()) {
    throw new ValidationError('TICKET_ATT_STORAGE_KEY_REQUIRED', 'storageKey required')
  }

  const thread = await db.query.ticketThreads.findFirst({
    where: eq(ticketThreads.id, input.threadId),
    columns: {
      id: true,
      ticketId: true,
      deletedAt: true,
      audience: true,
      sharedWithTeamId: true,
      bodyText: true,
      principalId: true,
      createdAt: true,
      editedAt: true,
    },
  })
  if (!thread || thread.deletedAt) {
    throw new NotFoundError('TICKET_THREAD_NOT_FOUND', `thread ${input.threadId} not found`)
  }

  const [created] = await db
    .insert(ticketAttachments)
    .values({
      threadId: input.threadId,
      uploadedByPrincipalId: input.uploadedByPrincipalId,
      filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: input.storageKey,
      publicUrl: input.publicUrl ?? null,
    })
    .returning()

  await bumpLastActivity(thread.ticketId as TicketId)
  await writeActivity(
    thread.ticketId as TicketId,
    input.uploadedByPrincipalId,
    'attachment.added',
    { attachmentId: created.id, threadId: input.threadId, filename }
  )
  void recordEvent({
    principalId: input.uploadedByPrincipalId,
    action: 'ticket.attachment_added',
    targetType: 'ticket',
    targetId: thread.ticketId,
    diff: { context: { attachmentId: created.id, filename } },
  })
  try {
    const { buildEventActor } = await import('@/lib/server/events/dispatch')
    const actor = input.uploadedByPrincipalId
      ? buildEventActor({
          principalId: input.uploadedByPrincipalId,
          displayName: 'ticket-system',
        })
      : { type: 'service' as const, displayName: 'ticket-system' }
    const ticketEventRef = await loadTicketEventRef(thread.ticketId as TicketId)

    try {
      const { dispatchTicketAttachmentAdded } = await import('@/lib/server/events/dispatch')
      await dispatchTicketAttachmentAdded(actor, ticketEventRef, {
        id: created.id,
        threadId: input.threadId,
        filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedByPrincipalId: input.uploadedByPrincipalId,
        publicUrl: input.publicUrl ?? null,
      })
    } catch (err) {
      console.warn('[tickets] dispatchTicketAttachmentAdded failed', err)
    }

    // Compatibility fallback: integrations created before attachment event
    // mappings existed still receive thread updates and can sync attachments.
    try {
      await dispatchThreadRefresh({
        actor,
        ticket: ticketEventRef,
        thread: {
          id: thread.id,
          audience: thread.audience,
          sharedWithTeamId: thread.sharedWithTeamId ?? null,
          bodyText: thread.bodyText ?? '',
          principalId: thread.principalId ?? null,
          createdAt: thread.createdAt,
          editedAt: thread.editedAt ?? null,
        },
      })
    } catch (err) {
      console.warn('[tickets] dispatchTicketThreadUpdated fallback failed', err)
    }
  } catch (err) {
    console.warn('[tickets] attachment dispatch setup failed', err)
  }
  return created
}

export async function listForThread(threadId: TicketThreadId): Promise<TicketAttachment[]> {
  return db.select().from(ticketAttachments).where(eq(ticketAttachments.threadId, threadId))
}

export async function removeAttachment(
  attachmentId: TicketAttachmentId,
  actorPrincipalId: PrincipalId | null
): Promise<void> {
  const existing = await db.query.ticketAttachments.findFirst({
    where: eq(ticketAttachments.id, attachmentId),
  })
  if (!existing) {
    throw new NotFoundError('TICKET_ATT_NOT_FOUND', `attachment ${attachmentId} not found`)
  }
  await db.delete(ticketAttachments).where(eq(ticketAttachments.id, attachmentId))
  const thread = await db.query.ticketThreads.findFirst({
    where: eq(ticketThreads.id, existing.threadId),
    columns: {
      id: true,
      ticketId: true,
      audience: true,
      sharedWithTeamId: true,
      bodyText: true,
      principalId: true,
      createdAt: true,
      editedAt: true,
    },
  })
  if (thread) {
    await bumpLastActivity(thread.ticketId as TicketId)
    await writeActivity(thread.ticketId as TicketId, actorPrincipalId, 'attachment.removed', {
      attachmentId,
    })
    void recordEvent({
      principalId: actorPrincipalId,
      action: 'ticket.attachment_removed',
      targetType: 'ticket',
      targetId: thread.ticketId,
      diff: { context: { attachmentId } },
    })
    try {
      const { buildEventActor } = await import('@/lib/server/events/dispatch')
      const actor = actorPrincipalId
        ? buildEventActor({ principalId: actorPrincipalId, displayName: 'ticket-system' })
        : { type: 'service' as const, displayName: 'ticket-system' }
      const ticketEventRef = await loadTicketEventRef(thread.ticketId as TicketId)

      try {
        const { dispatchTicketAttachmentRemoved } = await import('@/lib/server/events/dispatch')
        await dispatchTicketAttachmentRemoved(
          actor,
          ticketEventRef,
          { id: attachmentId, threadId: existing.threadId, filename: existing.filename },
          actorPrincipalId
        )
      } catch (err) {
        console.warn('[tickets] dispatchTicketAttachmentRemoved failed', err)
      }

      // Compatibility fallback: refresh linked thread comment body when
      // integrations do not yet have attachment event mappings.
      try {
        await dispatchThreadRefresh({
          actor,
          ticket: ticketEventRef,
          thread: {
            id: thread.id,
            audience: thread.audience,
            sharedWithTeamId: thread.sharedWithTeamId ?? null,
            bodyText: thread.bodyText ?? '',
            principalId: thread.principalId ?? null,
            createdAt: thread.createdAt,
            editedAt: thread.editedAt ?? null,
          },
        })
      } catch (err) {
        console.warn('[tickets] dispatchTicketThreadUpdated fallback failed', err)
      }
    } catch (err) {
      console.warn('[tickets] attachment removal dispatch setup failed', err)
    }
  }
}
