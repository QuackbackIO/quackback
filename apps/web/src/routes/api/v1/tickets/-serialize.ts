import type { TicketDTO } from '@/lib/server/domains/tickets/ticket.types'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'

/** Public, stable ticket shape for the read API. Nested refs collapse to ids;
 *  status reports its human name + the stable category, stage the public slot. */
export function serializeTicket(dto: TicketDTO) {
  return {
    id: dto.id,
    number: dto.number,
    reference: dto.reference,
    type: dto.type,
    title: dto.title,
    status: { name: dto.status.name, category: dto.status.category },
    stage: dto.stage.slot,
    priority: dto.priority,
    requesterPrincipalId: dto.requester?.principalId ?? null,
    assigneePrincipalId: dto.assignee.principalId,
    assigneeTeamId: dto.assignee.teamId,
    companyId: dto.company?.id ?? null,
    firstResponseAt: dto.firstResponseAt,
    dueAt: dto.dueAt,
    resolvedAt: dto.resolvedAt,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    reopenedCount: dto.reopenedCount,
  }
}

/** Public, stable ticket-message shape for the read API. */
export function serializeTicketMessage(dto: ConversationMessageDTO) {
  return {
    id: dto.id,
    ticketId: dto.ticketId,
    senderType: dto.senderType,
    isInternal: dto.isInternal,
    authorPrincipalId: dto.author?.principalId ?? null,
    authorName: dto.author?.displayName ?? null,
    content: dto.content,
    createdAt: dto.createdAt,
  }
}
