/**
 * Bulk due-date targets: a selected ticket row is its own target, a selected
 * conversation stands in for its linked customer ticket, and a conversation
 * with no linked ticket is skipped and counted for the toast.
 */
import { describe, it, expect } from 'vitest'
import type { ConversationId, TicketId } from '@quackback/ids'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'
import { dueTargetTicketIds } from '../due-targets'

// Real TypeIDs: the helper discriminates selections by prefix.
const CONV_LINKED = 'conversation_01h455vb4pex5vsknk084sn02q' as ConversationId
const CONV_PLAIN = 'conversation_01h455vb4pex5vsknk084sn02r' as ConversationId
const CONV_OFF_PAGE = 'conversation_01h455vb4pex5vsknk084sn02s' as ConversationId
const LINKED_TICKET = 'ticket_01h455vb4pex5vsknk084sn02t' as TicketId
const TICKET_ROW = 'ticket_01h455vb4pex5vsknk084sn02v' as TicketId

function conversationRow(id: ConversationId, linkedTicketId: TicketId | null): InboxItemDTO {
  return {
    kind: 'conversation',
    conversation: { id } as never,
    linkedTicket: linkedTicketId
      ? {
          id: linkedTicketId,
          number: 7,
          title: 'Linked',
          statusName: 'Open',
          statusCategory: 'open',
          dueAt: null,
        }
      : null,
    searchSnippet: null,
  }
}

function ticketRow(id: TicketId): InboxItemDTO {
  return { kind: 'ticket', ticket: { id } as never, unreadCount: 0 }
}

const ITEMS: InboxItemDTO[] = [
  conversationRow(CONV_LINKED, LINKED_TICKET),
  conversationRow(CONV_PLAIN, null),
  ticketRow(TICKET_ROW),
]

describe('dueTargetTicketIds', () => {
  it('keeps a selected ticket row as-is', () => {
    expect(dueTargetTicketIds([TICKET_ROW], ITEMS)).toEqual({
      ticketIds: [TICKET_ROW],
      skipped: 0,
    })
  })

  it('resolves a selected conversation to its linked customer ticket', () => {
    expect(dueTargetTicketIds([CONV_LINKED], ITEMS)).toEqual({
      ticketIds: [LINKED_TICKET],
      skipped: 0,
    })
  })

  it('skips and counts a conversation with no linked ticket', () => {
    expect(dueTargetTicketIds([CONV_PLAIN], ITEMS)).toEqual({ ticketIds: [], skipped: 1 })
  })

  it('counts a selected conversation missing from the loaded rows as skipped', () => {
    expect(dueTargetTicketIds([CONV_OFF_PAGE], ITEMS)).toEqual({ ticketIds: [], skipped: 1 })
  })

  it('resolves a mixed selection in selection order, without duplicates', () => {
    const selected = new Set<string>([TICKET_ROW, CONV_PLAIN, CONV_LINKED])
    expect(dueTargetTicketIds(selected, ITEMS)).toEqual({
      ticketIds: [TICKET_ROW, LINKED_TICKET],
      skipped: 1,
    })
    // The linked ticket selected directly and through its conversation counts once.
    expect(dueTargetTicketIds([LINKED_TICKET, CONV_LINKED], ITEMS).ticketIds).toEqual([
      LINKED_TICKET,
    ])
  })

  it('ignores an id that is neither a conversation nor a ticket', () => {
    expect(dueTargetTicketIds(['not-an-id'], ITEMS)).toEqual({ ticketIds: [], skipped: 0 })
  })
})
