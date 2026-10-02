/**
 * The `file-preview` job handler.
 *
 * The files domain derives a file's preview and copies it onto the message
 * the file was first sent on. Telling open threads about that message is a
 * conversation and ticket concern, so the two are wired together here, above
 * both domains, the way a message edit tells them: agents' inbox threads, the
 * visitor's own thread for a customer-visible message, and the ticket thread
 * the message shows in.
 */
import { isValidTypeId, type FileId } from '@quackback/ids'
import type { ConversationMessage } from '@/lib/server/db'
import type { JobHandler } from '@/lib/server/jobs/definitions'
import {
  generateFilePreview,
  markFilePreviewFailed,
  type PreviewOutcome,
} from '@/lib/server/domains/files/files.preview'
import {
  publishConversationOnlyEvent,
  publishTicketEvent,
} from '@/lib/server/realtime/conversation-channels'
import { broadcastInboxMessageUpdated } from '@/lib/server/domains/conversation/message.actions'
import {
  loadAuthors,
  fallbackAuthor,
  toMessageDTO,
} from '@/lib/server/domains/conversation/conversation.query'
import { resolvePairTicketIdForConversation } from '@/lib/server/domains/tickets/pair-thread.service'

async function publishAttachmentPreview(message: ConversationMessage): Promise<void> {
  const author = message.principalId
    ? ((await loadAuthors([message.principalId])).get(message.principalId) ??
      fallbackAuthor(message.principalId))
    : null
  let ticketId = message.ticketId
  if (message.conversationId) {
    await broadcastInboxMessageUpdated(message)
    if (!message.isInternal) {
      publishConversationOnlyEvent(message.conversationId, {
        kind: 'message_edited',
        conversationId: message.conversationId,
        message: toMessageDTO(message, author),
      })
    }
    ticketId = await resolvePairTicketIdForConversation(message.conversationId)
  }
  if (ticketId) {
    publishTicketEvent(ticketId, {
      kind: 'ticket_message_updated',
      ticketId,
      message: toMessageDTO(message, author),
    })
  }
}

/** Derive one file's preview and tell open threads about the message it patched. */
export function previewFileAndPublish(
  fileId: FileId,
  options: { budgetMs?: number } = {}
): Promise<PreviewOutcome> {
  return generateFilePreview(fileId, { ...options, onMessagePatched: publishAttachmentPreview })
}

export const runFilePreview: JobHandler = async (job) => {
  const fileId = job.payload.fileId
  if (typeof fileId !== 'string' || !isValidTypeId(fileId, 'file')) return
  try {
    await previewFileAndPublish(fileId as FileId)
  } catch (err) {
    // With no attempts left the file stops waiting for a preview.
    if (job.attempts >= job.maxAttempts) {
      await markFilePreviewFailed(fileId as FileId).catch(() => {})
    }
    throw err
  }
}
