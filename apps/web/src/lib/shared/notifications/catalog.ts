/**
 * Notification catalog
 *
 * Client-safe metadata describing every `NotificationType` — label, group,
 * and which settings surface(s) should render a row for it. Consumed by the
 * notification-preferences UI to render grouped, per-surface settings tabs.
 *
 * The `NotificationType` import is type-only and erased at compile time, so
 * importing it here does not pull the server domain module into the client
 * bundle.
 */
import type { NotificationType } from '@/lib/server/domains/notifications/notification.types'

export type NotificationChannel = 'inApp' | 'email' | 'push'

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['inApp', 'email', 'push']

export type NotificationGroup = 'feedback' | 'support' | 'changelog'

export interface NotificationTypeMeta {
  type: NotificationType
  /** Short human label, e.g. "New comment". */
  label: string
  /** One-line description for settings rows. */
  description?: string
  group: NotificationGroup
  /** Which settings surface(s) show this row. */
  surfaces: ('admin' | 'portal')[]
}

export const NOTIFICATION_CATALOG: readonly NotificationTypeMeta[] = [
  // Feedback
  {
    type: 'post_status_changed',
    label: 'Status changed',
    description: 'A post you follow changes status',
    group: 'feedback',
    surfaces: ['admin', 'portal'],
  },
  {
    type: 'comment_created',
    label: 'New comment',
    description: 'Someone comments on a post you follow',
    group: 'feedback',
    surfaces: ['admin', 'portal'],
  },
  {
    type: 'post_mentioned',
    label: 'Mentioned in a post',
    description: 'Someone @-mentions you in a post',
    group: 'feedback',
    surfaces: ['admin', 'portal'],
  },
  {
    type: 'comment_mentioned',
    label: 'Mentioned in a comment',
    description: 'Someone @-mentions you in a comment',
    group: 'feedback',
    surfaces: ['admin', 'portal'],
  },
  // Support
  {
    type: 'chat_message',
    label: 'New message',
    description: 'A new message arrives in a conversation you follow',
    group: 'support',
    surfaces: ['admin'],
  },
  {
    type: 'conversation_assigned',
    label: 'Conversation assigned',
    description: 'A conversation is assigned to you or your team',
    group: 'support',
    surfaces: ['admin'],
  },
  {
    type: 'chat_mention',
    label: 'Mentioned in a conversation',
    description: 'Someone @-mentions you in a conversation',
    group: 'support',
    surfaces: ['admin'],
  },
  {
    type: 'assistant_handed_off',
    label: 'AI handed off to you',
    description: 'The AI assistant hands a conversation to the human inbox',
    group: 'support',
    surfaces: ['admin'],
  },
  {
    type: 'ticket_status_changed',
    label: 'Ticket status changed',
    description: 'A ticket you own changes status',
    group: 'support',
    surfaces: ['admin', 'portal'],
  },
  {
    type: 'ticket_assigned',
    label: 'Ticket assigned',
    description: 'A ticket is assigned to you or your team',
    group: 'support',
    surfaces: ['admin'],
  },
  // Changelog
  {
    type: 'changelog_published',
    label: 'Changelog published',
    description: 'A new changelog entry is published',
    group: 'changelog',
    surfaces: ['admin', 'portal'],
  },
  {
    type: 'status_incident',
    label: 'Status incident',
    description: 'A status incident or maintenance window is posted',
    group: 'changelog',
    surfaces: ['admin', 'portal'],
  },
]

/** Filters the catalog down to the rows a given settings surface should render. */
export function catalogForSurface(surface: 'admin' | 'portal'): NotificationTypeMeta[] {
  return NOTIFICATION_CATALOG.filter((meta) => meta.surfaces.includes(surface))
}

/** Buckets catalog entries by group, e.g. for rendering grouped settings tabs. */
export function catalogByGroup(
  metas: readonly NotificationTypeMeta[] = NOTIFICATION_CATALOG
): Record<NotificationGroup, NotificationTypeMeta[]> {
  const grouped: Record<NotificationGroup, NotificationTypeMeta[]> = {
    feedback: [],
    support: [],
    changelog: [],
  }
  for (const meta of metas) {
    grouped[meta.group].push(meta)
  }
  return grouped
}
