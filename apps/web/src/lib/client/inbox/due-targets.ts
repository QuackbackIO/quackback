/**
 * Bulk "set due date" targets for the inbox selection. A due date lives on a
 * ticket, but most customer tickets list as their linked conversation's row
 * (the one-row rule), so a selected conversation stands in for its linked
 * customer ticket. A conversation with no linked ticket has nothing to date:
 * it is skipped and counted, so the toast can say so.
 */
import type { TicketId } from '@quackback/ids'
import { inboxItemRefFromId, type InboxItemDTO } from '@/lib/shared/inbox/items'

export interface DueTargets {
  /** Distinct tickets to update, in selection order. */
  ticketIds: TicketId[]
  /** Selected conversations without a linked ticket. */
  skipped: number
}

/**
 * Resolve a selection to the tickets a bulk due-date change applies to:
 * selected ticket rows as-is, selected conversation rows through their linked
 * customer ticket (read from the loaded list rows). A conversation that is not
 * in `items` or has no linked ticket counts as skipped.
 */
export function dueTargetTicketIds(selected: Iterable<string>, items: InboxItemDTO[]): DueTargets {
  const linked = new Map<string, TicketId>()
  for (const item of items) {
    if (item.kind === 'conversation' && item.linkedTicket) {
      linked.set(item.conversation.id, item.linkedTicket.id)
    }
  }
  const ticketIds = new Set<TicketId>()
  let skipped = 0
  for (const id of selected) {
    const ref = inboxItemRefFromId(id)
    if (ref?.kind === 'ticket') {
      ticketIds.add(ref.id)
    } else if (ref?.kind === 'conversation') {
      const ticketId = linked.get(ref.id)
      if (ticketId) ticketIds.add(ticketId)
      else skipped++
    }
  }
  return { ticketIds: [...ticketIds], skipped }
}
