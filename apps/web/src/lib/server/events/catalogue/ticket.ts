/** Ticket-family event declarations (WO-2). created/status_changed and the three
 *  due-date events are workflow triggers. */
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
// The linked-issue close-the-loop signal. Webhook-exposed like the rest of the
// ticket family (the family drift gate pins this); loop-safe because outbound
// tracker hooks only ever fire on post.created.
export const ticketExternalStatusChanged = decl(
  'ticket.external_status_changed',
  'ticket',
  { webhook: true, notification: 'ticket_external_status_changed' },
  S
)
// The due date was set, moved or cleared. A workflow trigger, never a
// notification (the teammate who changed it already knows; the alerts below
// are the notification surface).
export const ticketDueChanged = decl(
  'ticket.due_changed',
  'ticket',
  { webhook: true, workflow: true },
  S
)
// Timer-driven by the ticket-due sweep: once per ticket per due date.
export const ticketDueSoon = decl(
  'ticket.due_soon',
  'ticket',
  { webhook: true, workflow: true, notification: 'ticket_due_soon' },
  S
)
export const ticketOverdue = decl(
  'ticket.overdue',
  'ticket',
  { webhook: true, workflow: true, notification: 'ticket_overdue' },
  S
)
// A watch changed by hand. The bell on an add tells the person a teammate
// added them (never on their own watch); the webhook lets an integration keep
// its own follower list in step.
export const ticketSubscriberAdded = decl(
  'ticket.subscriber_added',
  'ticket',
  { webhook: true, notification: 'ticket_subscriber_added' },
  S
)
export const ticketSubscriberRemoved = decl(
  'ticket.subscriber_removed',
  'ticket',
  { webhook: true },
  S
)
// The title was renamed. `changedKeys` leaves room for further editable
// ticket fields without a new event per field. Webhook-only: the teammate
// who renamed it already knows, and the inbox re-renders off realtime.
export const ticketUpdated = decl('ticket.updated', 'ticket', { webhook: true }, S)
// Triage priority moved (mirrors conversation.priority_changed).
export const ticketPriorityChanged = decl('ticket.priority_changed', 'ticket', { webhook: true }, S)
// A public reply on the ticket thread was edited or deleted (internal notes are
// never announced, as with message.updated/deleted). Lets integrations that
// mirror the thread (a linked issue's comments) follow the change.
export const ticketReplyUpdated = decl('ticket.reply_updated', 'ticket', { webhook: true }, S)
export const ticketReplyDeleted = decl('ticket.reply_deleted', 'ticket', { webhook: true }, S)
// A file was added to or removed from a public reply already sent (same
// audience rule as reply_updated).
export const ticketAttachmentAdded = decl('ticket.attachment_added', 'ticket', { webhook: true }, S)
export const ticketAttachmentRemoved = decl(
  'ticket.attachment_removed',
  'ticket',
  { webhook: true },
  S
)
