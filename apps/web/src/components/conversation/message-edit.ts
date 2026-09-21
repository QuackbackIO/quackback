import type { AgentConversationMessageDTO } from '@/lib/shared/conversation/types'

/** Whether the signed-in teammate may edit this bubble. The server repeats the
 *  check: only the author, and never a system, assistant, or block message. */
export function canEditAgentMessage(
  message: Pick<AgentConversationMessageDTO, 'senderType' | 'isAssistant' | 'author' | 'block'>,
  principalId: string | null | undefined
): boolean {
  if (!principalId) return false
  if (message.senderType === 'system' || message.isAssistant) return false
  if (message.block) return false
  return message.author?.principalId === principalId
}
