import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

/**
 * The permission that writes this kind of message: a reply or a note, on a
 * conversation or a ticket. Editing or deleting your own message needs the
 * same one, so losing it also takes away changes to what you already sent.
 */
export function writePermissionFor(message: {
  parent: 'conversation' | 'ticket'
  isInternal: boolean
}): PermissionKey {
  if (message.parent === 'ticket') {
    return message.isInternal ? PERMISSIONS.TICKET_NOTE : PERMISSIONS.TICKET_REPLY
  }
  return message.isInternal ? PERMISSIONS.CONVERSATION_NOTE : PERMISSIONS.CONVERSATION_REPLY
}
