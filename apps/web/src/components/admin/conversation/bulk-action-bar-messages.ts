/** The bulk action bar's words (admin inbox area). */
export const MESSAGES = {
  dismiss: { id: 'admin.inbox.bulkActionBar.dismiss', defaultMessage: 'Dismiss' },
  clearSelection: {
    id: 'admin.inbox.bulkActionBar.clearSelection',
    defaultMessage: 'Clear selection',
  },
  notForTickets: {
    id: 'admin.inbox.bulkActionBar.notForTickets',
    defaultMessage: 'Not available for tickets',
  },
  bulkActions: {
    id: 'admin.inbox.bulkActionBar.bulkActions',
    defaultMessage: 'Bulk actions',
  },
  thisConversation: {
    id: 'admin.inbox.bulkActionBar.thisConversation',
    defaultMessage: 'This conversation',
  },
  selected: { id: 'admin.inbox.bulkActionBar.selected', defaultMessage: '{count} selected' },
  restore: {
    id: 'admin.inbox.bulkActionBar.restore',
    defaultMessage: 'Restore',
  },
  deleteForever: {
    id: 'admin.inbox.bulkActionBar.deleteForever',
    defaultMessage: 'Delete forever',
  },
  deleteForeverTitle: {
    id: 'admin.inbox.bulkActionBar.deleteForeverTitle',
    defaultMessage:
      '{count, plural, =0 {Delete this conversation forever?} one {Delete # conversation forever?} other {Delete # conversations forever?}}',
  },
  thisPermanentlyDeletesThe: {
    id: 'admin.inbox.bulkActionBar.thisPermanentlyDeletesThe',
    defaultMessage:
      'This permanently deletes the conversation and its entire history. This action cannot be undone.',
  },
  deletePermanently: {
    id: 'admin.inbox.bulkActionBar.deletePermanently',
    defaultMessage: 'Delete permanently',
  },
  bulkActions2: {
    id: 'admin.inbox.bulkActionBar.bulkActions',
    defaultMessage: 'Bulk actions',
  },
  macro: {
    id: 'admin.inbox.bulkActionBar.macro',
    defaultMessage: 'Macro',
  },
  noMacros: {
    id: 'admin.inbox.bulkActionBar.noMacros',
    defaultMessage: 'No macros',
  },
  assign: {
    id: 'admin.inbox.bulkActionBar.assign',
    defaultMessage: 'Assign',
  },
  team: { id: 'admin.inbox.bulkActionBar.team', defaultMessage: 'Team' },
  noTeams: {
    id: 'admin.inbox.bulkActionBar.noTeams',
    defaultMessage: 'No teams',
  },
  priority: {
    id: 'admin.inbox.bulkActionBar.priority',
    defaultMessage: 'Priority',
  },
  tag: { id: 'admin.inbox.bulkActionBar.tag', defaultMessage: 'Tag' },
  noTags: {
    id: 'admin.inbox.bulkActionBar.noTags',
    defaultMessage: 'No tags',
  },
  snooze: {
    id: 'admin.inbox.bulkActionBar.snooze',
    defaultMessage: 'Snooze',
  },
  snoozeUntil: {
    id: 'admin.inbox.bulkActionBar.snoozeUntil',
    defaultMessage: 'Snooze until',
  },
  laterToday: {
    id: 'admin.inbox.bulkActionBar.laterToday',
    defaultMessage: 'Later today',
  },
  tomorrow: {
    id: 'admin.inbox.bulkActionBar.tomorrow',
    defaultMessage: 'Tomorrow',
  },
  nextWeek: {
    id: 'admin.inbox.bulkActionBar.nextWeek',
    defaultMessage: 'Next week',
  },
  untilTheyReply: {
    id: 'admin.inbox.bulkActionBar.untilTheyReply',
    defaultMessage: 'Until they reply',
  },
  close: { id: 'admin.inbox.bulkActionBar.close', defaultMessage: 'Close' },
} as const
