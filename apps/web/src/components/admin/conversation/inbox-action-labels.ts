import type { MessageDescriptor } from 'react-intl'
import type { InboxActionGroup, InboxActionId } from '@/lib/shared/conversation/inbox-actions'

/** The inbox actions' names in the teammate's language, by id (the registry keeps its English). */
export const INBOX_ACTION_LABELS: Record<InboxActionId, MessageDescriptor> = {
  reply: { id: 'admin.inbox.actions.reply', defaultMessage: 'Reply' },
  note: { id: 'admin.inbox.actions.note', defaultMessage: 'Add internal note' },
  copilot: { id: 'admin.inbox.actions.copilot', defaultMessage: 'Ask Copilot' },
  macro: { id: 'admin.inbox.actions.macro', defaultMessage: 'Reply with macro' },
  assign: { id: 'admin.inbox.actions.assign', defaultMessage: 'Assign to teammate' },
  assign_team: { id: 'admin.inbox.actions.assignTeam', defaultMessage: 'Assign to team' },
  snooze: { id: 'admin.inbox.actions.snooze', defaultMessage: 'Snooze' },
  priority: { id: 'admin.inbox.actions.priority', defaultMessage: 'Set priority' },
  close: { id: 'admin.inbox.actions.close', defaultMessage: 'Close conversation' },
  reopen: { id: 'admin.inbox.actions.reopen', defaultMessage: 'Reopen conversation' },
  create_ticket: { id: 'admin.inbox.actions.createTicket', defaultMessage: 'Create ticket' },
  open_ticket: { id: 'admin.inbox.actions.openTicket', defaultMessage: 'Open ticket' },
  next: { id: 'admin.inbox.actions.next', defaultMessage: 'Next conversation' },
  prev: { id: 'admin.inbox.actions.prev', defaultMessage: 'Previous conversation' },
  toggle_select: { id: 'admin.inbox.actions.toggleSelect', defaultMessage: 'Select conversation' },
}

export const INBOX_ACTION_GROUP_LABELS: Record<InboxActionGroup, MessageDescriptor> = {
  Reply: { id: 'admin.inbox.actions.group.reply', defaultMessage: 'Reply' },
  Assign: { id: 'admin.inbox.actions.group.assign', defaultMessage: 'Assign' },
  Status: { id: 'admin.inbox.actions.group.status', defaultMessage: 'Status' },
  Navigate: { id: 'admin.inbox.actions.group.navigate', defaultMessage: 'Navigate' },
}
