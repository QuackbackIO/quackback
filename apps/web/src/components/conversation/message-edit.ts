import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'
import { writePermissionFor } from '@/lib/shared/conversation/message-permissions'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

type BubbleMessage = Pick<
  AgentConversationMessageDTO,
  'senderType' | 'isAssistant' | 'author' | 'block' | 'ticketId' | 'isInternal'
>

/** The author acting on their own agent message, with the permission that writes it. */
function isOwnAgentMessage(
  message: BubbleMessage,
  principalId: string | null | undefined,
  permissions: ReadonlySet<PermissionKey>
): boolean {
  if (!principalId || message.senderType !== 'agent') return false
  if (message.author?.principalId !== principalId) return false
  const parent = message.ticketId ? 'ticket' : 'conversation'
  return permissions.has(writePermissionFor({ parent, isInternal: message.isInternal }))
}

/** Whether the signed-in teammate may edit this bubble. Mirrors `canEditMessage`:
 *  only your own agent message, never an assistant or block message. */
export function canEditAgentMessage(
  message: BubbleMessage,
  principalId: string | null | undefined,
  permissions: ReadonlySet<PermissionKey>
): boolean {
  if (message.isAssistant || message.block) return false
  return isOwnAgentMessage(message, principalId, permissions)
}

/** Whether the signed-in teammate may delete this bubble. Mirrors
 *  `canDeleteMessage`: your own agent message, or anyone's for a moderator. */
export function canDeleteAgentMessage(
  message: BubbleMessage,
  principalId: string | null | undefined,
  permissions: ReadonlySet<PermissionKey>
): boolean {
  if (message.senderType === 'system') return false
  if (permissions.has(PERMISSIONS.CONVERSATION_MANAGE)) return true
  return isOwnAgentMessage(message, principalId, permissions)
}
