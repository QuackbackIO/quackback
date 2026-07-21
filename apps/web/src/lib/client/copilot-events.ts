/**
 * Fire-and-forget client seam for Copilot usage events (inserts + thumbs
 * feedback), wrapping `recordCopilotEventFn`. Logging must NEVER block or
 * break the insert/feedback UI, so every failure is swallowed here — call
 * sites just fire and move on. The input shape is re-exported from its owner
 * (the server fn module), never retyped here.
 */
import { recordCopilotEventFn, type CopilotEventInput } from '@/lib/server/functions/copilot-events'
import type { InboxItemRef } from '@/lib/shared/inbox/items'

export type { CopilotEventInput }

/** The item-ref body fragment every Copilot request and usage event carries
 *  (unified inbox §2.9's `withAssistantItemRef` union) — `{ conversationId }`
 *  or `{ ticketId }`, exactly one. Used by the Copilot panel, which pairs it
 *  with `recordCopilotEvent`. */
export function itemRefBody(item: InboxItemRef): { conversationId: string } | { ticketId: string } {
  return item.kind === 'conversation' ? { conversationId: item.id } : { ticketId: item.id }
}

/** The item-ref body's shape, named once here so consumers don't re-declare
 *  the union by hand. */
export type AssistantItemRef = ReturnType<typeof itemRefBody>

export function recordCopilotEvent(input: CopilotEventInput): void {
  void recordCopilotEventFn({ data: input }).catch(() => {})
}
