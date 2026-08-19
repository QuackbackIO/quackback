import type { TicketDTO } from '@/lib/server/domains/tickets/ticket.types'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'

/** Public, stable ticket shape for the read API. Nested refs collapse to ids;
 *  status reports its human name + the stable category, stage the public slot. */
export function serializeTicket(dto: TicketDTO) {
  return {
    id: dto.id,
    number: dto.number,
    reference: dto.reference,
    type: dto.type,
    // The Phase 4 registry type (name/slug/category/icon/color), null on
    // legacy typeless rows. `type` above stays the behavior-axis category.
    ticketType: dto.ticketType,
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

/** Public, stable ticket-message shape for the read API. `content` prefers the
 *  stored markdown but restores image nodes from `contentJson` (mirrors the
 *  posts/changelog read-path fix) — a plain message passes through verbatim. */
export function serializeTicketMessage(dto: ConversationMessageDTO) {
  return {
    id: dto.id,
    ticketId: dto.ticketId,
    senderType: dto.senderType,
    isInternal: dto.isInternal,
    authorPrincipalId: dto.author?.principalId ?? null,
    authorName: dto.author?.displayName ?? null,
    content: contentJsonToMarkdown(dto.contentJson, dto.content),
    contentJson: dto.contentJson ?? null,
    attachments: dto.attachments?.length ? dto.attachments : null,
    createdAt: dto.createdAt,
  }
}
