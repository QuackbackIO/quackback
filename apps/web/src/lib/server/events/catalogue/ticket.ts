/** Ticket-family event declarations (WO-2). created/status_changed are workflow triggers. */
import { decl } from './helpers'

const S = 'conversations:read'

export const ticketCreated = decl('ticket.created', 'ticket', { webhook: true, workflow: true }, S)
export const ticketStatusChanged = decl(
  'ticket.status_changed',
  'ticket',
  { webhook: true, workflow: true },
  S
)
export const ticketAssigned = decl('ticket.assigned', 'ticket', { webhook: true }, S)
export const ticketReplied = decl('ticket.replied', 'ticket', { webhook: true }, S)
export const ticketNoteAdded = decl('ticket.note_added', 'ticket', { webhook: true }, S)
