/** Ticket-family event declarations (WO-2). created/status_changed are workflow triggers. */
import { decl } from './helpers'

const S = 'support'

export const ticketCreated = decl(
  'ticket.created',
  'ticket',
  { webhook: true, workflow: true, notification: 'ticket_created' },
  S
)
export const ticketStatusChanged = decl(
  'ticket.status_changed',
  'ticket',
  { webhook: true, workflow: true, notification: 'ticket_status_changed' },
  S
)
export const ticketAssigned = decl(
  'ticket.assigned',
  'ticket',
  { webhook: true, notification: 'ticket_assigned' },
  S
)
export const ticketReplied = decl(
  'ticket.replied',
  'ticket',
  { webhook: true, notification: 'ticket_replied' },
  S
)
export const ticketNoteAdded = decl(
  'ticket.note_added',
  'ticket',
  { webhook: true, notification: 'ticket_note_added' },
  S
)
