import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

/** Whether the signed-in teammate may edit this bubble. The server repeats the
 *  check: only the author of an agent message, never an assistant or block message, and only
 *  while they hold the permission that writes that kind of message. */
export function canEditAgentMessage(
  message: Pick<
    AgentConversationMessageDTO,
    'senderType' | 'isAssistant' | 'author' | 'block' | 'ticketId' | 'isInternal'
  >,
  principalId: string | null | undefined,
  permissions: ReadonlySet<PermissionKey>
): boolean {
  if (!principalId) return false
  // Only agent-side rows: a teammate's own customer-side message stays theirs.
  if (message.senderType !== 'agent' || message.isAssistant) return false
  if (message.block) return false
  if (message.author?.principalId !== principalId) return false
  const permission = message.ticketId
    ? message.isInternal
      ? PERMISSIONS.TICKET_NOTE
      : PERMISSIONS.TICKET_REPLY
    : message.isInternal
      ? PERMISSIONS.CONVERSATION_NOTE
      : PERMISSIONS.CONVERSATION_REPLY
  return permissions.has(permission)
}
