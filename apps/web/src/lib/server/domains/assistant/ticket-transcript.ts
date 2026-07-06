/**
 * Render a ticket thread (oldest-first, customer-visible turns only —
 * internal notes are excluded, mirroring `assistant.thread.ts`'s
 * `loadConversationThread` for conversations: even the teammate-facing
 * copilot surface never grounds Quinn on internal notes) as plain
 * "Speaker: content" lines. Mirrors `conversation-summary.service.ts`'s
 * `buildTranscript` shape.
 *
 * Shared by `assistant.runtime.ts` (the copilot turn's ticket-grounding
 * block) and `conversation-summary.service.ts` (the ticket on-demand
 * Summarize chip) — both rendered the exact same lines from the exact same
 * DTO shape, so this is the one definition both import.
 */
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'

export function buildTicketTranscript(messages: ConversationMessageDTO[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const content = m.content?.trim()
    if (!content) continue
    lines.push(`${m.senderType === 'visitor' ? 'Customer' : 'Agent'}: ${content}`)
  }
  return lines.join('\n')
}
