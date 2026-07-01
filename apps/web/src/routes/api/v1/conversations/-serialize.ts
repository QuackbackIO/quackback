import type { ConversationDTO, ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { realEmail } from '@/lib/shared/anonymous-email'

/** Public, stable conversation shape for the read API. */
export function serializeConversation(dto: ConversationDTO) {
  return {
    id: dto.id,
    status: dto.status,
    channel: dto.channel,
    priority: dto.priority,
    subject: dto.subject,
    visitorPrincipalId: dto.visitor.principalId,
    visitorEmail: realEmail(dto.visitorEmail),
    assignedAgentPrincipalId: dto.assignedAgent?.principalId ?? null,
    lastMessageAt: dto.lastMessageAt,
    resolvedAt: dto.resolvedAt,
    createdAt: dto.createdAt,
  }
}

/** Public, stable message shape for the read API. */
export function serializeMessage(dto: ConversationMessageDTO) {
  return {
    id: dto.id,
    conversationId: dto.conversationId,
    senderType: dto.senderType,
    isInternal: dto.isInternal,
    authorPrincipalId: dto.author?.principalId ?? null,
    authorName: dto.author?.displayName ?? null,
    content: dto.content,
    createdAt: dto.createdAt,
  }
}
