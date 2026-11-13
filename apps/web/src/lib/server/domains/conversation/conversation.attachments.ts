/**
 * Add files to, or remove a file from, a message already sent. The same rule
 * as a body edit decides who may (the author, for the kind of message it is;
 * see loadEditableMessage), the change is marked as an edit, and it fans out
 * to every surface the message shows on through publishMessageChange.
 *
 * A public reply shown in a ticket thread also fires ticket.attachment_added
 * or ticket.attachment_removed, so integrations mirroring the thread follow
 * the change. A removed file's stored object is left alone: another message
 * may reference it (a copy into a ticket), and the file retention sweep owns
 * stored objects.
 */
import {
  db,
  eq,
  and,
  isNull,
  conversationMessages,
  type ConversationMessage,
} from '@/lib/server/db'
import type { ConversationMessageId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import type { Actor } from '@/lib/server/policy/types'
import type { ConversationAttachment } from '@/lib/shared/db-types'
import {
  MAX_CONVERSATION_ATTACHMENTS,
  type AgentConversationMessageDTO,
} from '@/lib/shared/conversation/types'
import { isTeamMember } from '@/lib/shared/roles'
import { linkFilesToMessage, resolveAttachments } from '@/lib/server/domains/files/files.service'
import { loadEditableMessage, publishMessageChange } from './conversation.edit'

/** Append files to a sent message. Returns the updated message. */
export async function addMessageAttachments(
  messageId: ConversationMessageId,
  raw: ConversationAttachment[],
  actor: Actor
): Promise<AgentConversationMessageDTO> {
  if (raw.length === 0) throw new ValidationError('VALIDATION_ERROR', 'Choose a file to add')
  const { message, viewerId } = await loadEditableMessage(messageId, actor)
  const existing = message.attachments ?? []
  if (existing.length + raw.length > MAX_CONVERSATION_ATTACHMENTS) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `A message can carry at most ${MAX_CONVERSATION_ATTACHMENTS} files`
    )
  }
  // A teammate may attach any stored file, as when sending; anyone else only
  // files they uploaded.
  const added = await resolveAttachments(raw, {
    principalId: viewerId,
    canAttachAnyFile: message.senderType === 'agent' && isTeamMember(actor.role),
  })

  const now = new Date()
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(conversationMessages)
      .set({ attachments: [...existing, ...added], editedAt: now, updatedAt: now })
      .where(and(eq(conversationMessages.id, message.id), isNull(conversationMessages.deletedAt)))
      .returning()
    if (!row) return null
    await linkFilesToMessage(tx, added, row.id)
    return row
  })
  if (!updated) throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')

  // linkFilesToMessage may have refreshed a file preview on the row.
  const fresh = await reload(updated)
  const { dto, ticketEdit } = await publishMessageChange(fresh, actor, viewerId)
  if (ticketEdit && announced(fresh)) {
    const { emitTicketAttachmentChanged } =
      await import('@/lib/server/domains/tickets/ticket.webhooks')
    for (const attachment of added) {
      void emitTicketAttachmentChanged('added', actor, ticketEdit.ticketId, fresh, attachment)
    }
  }
  return dto
}

/**
 * Remove one file from a sent message, by its position. `name` must match the
 * file at that position, so a stale client cannot remove a different file
 * after the list changed. A message is never left with neither text nor files.
 */
export async function removeMessageAttachment(
  messageId: ConversationMessageId,
  index: number,
  name: string,
  actor: Actor
): Promise<AgentConversationMessageDTO> {
  const { message, viewerId } = await loadEditableMessage(messageId, actor)
  const existing = message.attachments ?? []
  const removed = existing[index]
  if (!removed || removed.name !== name) {
    throw new ValidationError('VALIDATION_ERROR', 'That file is no longer on this message')
  }
  const remaining = existing.filter((_, i) => i !== index)
  if (remaining.length === 0 && !message.content.trim() && !message.contentJson) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'A message needs text or a file. Delete the message instead'
    )
  }

  const now = new Date()
  const [updated] = await db
    .update(conversationMessages)
    .set({ attachments: remaining.length > 0 ? remaining : null, editedAt: now, updatedAt: now })
    .where(and(eq(conversationMessages.id, message.id), isNull(conversationMessages.deletedAt)))
    .returning()
  if (!updated) throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')

  const { dto, ticketEdit } = await publishMessageChange(updated, actor, viewerId)
  if (ticketEdit && announced(updated)) {
    const { emitTicketAttachmentChanged } =
      await import('@/lib/server/domains/tickets/ticket.webhooks')
    void emitTicketAttachmentChanged('removed', actor, ticketEdit.ticketId, updated, removed)
  }
  return dto
}

/** Integrations hear about public replies only, never internal notes. */
function announced(message: ConversationMessage): boolean {
  return !message.isInternal && message.senderType !== 'system'
}

async function reload(message: ConversationMessage): Promise<ConversationMessage> {
  const [row] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, message.id))
    .limit(1)
  return row ?? message
}
