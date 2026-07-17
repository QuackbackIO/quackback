import {
  CheckCircleIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftRightIcon,
  NewspaperIcon,
  BellIcon,
  TicketIcon,
  AtSymbolIcon,
  SignalIcon,
  InboxArrowDownIcon,
  SparklesIcon,
} from '@heroicons/react/24/solid'
import type { NotificationType } from '@/lib/shared/types'

export interface NotificationTypeConfig {
  icon: typeof BellIcon
  iconClass: string
  bgClass: string
}

// Color-coding strategy: @ symbol marks mention types (amber for posts, rose for chat,
// fuchsia for comments); teal for support conversation, cyan for conversation assignment;
// indigo separates ticket stage changes from violet ticket assignment and blue post status
// changes; yellow marks AI-assistant handoffs as high-signal.
export const notificationTypeConfigs: Record<NotificationType, NotificationTypeConfig> = {
  post_status_changed: {
    icon: CheckCircleIcon,
    iconClass: 'text-blue-500',
    bgClass: 'bg-blue-500/10',
  },
  comment_created: {
    icon: ChatBubbleLeftEllipsisIcon,
    iconClass: 'text-purple-500',
    bgClass: 'bg-purple-500/10',
  },
  post_mentioned: {
    icon: AtSymbolIcon,
    iconClass: 'text-amber-500',
    bgClass: 'bg-amber-500/10',
  },
  changelog_published: {
    icon: NewspaperIcon,
    iconClass: 'text-green-500',
    bgClass: 'bg-green-500/10',
  },
  chat_message: {
    icon: ChatBubbleLeftRightIcon,
    iconClass: 'text-teal-500',
    bgClass: 'bg-teal-500/10',
  },
  chat_mention: {
    icon: AtSymbolIcon,
    iconClass: 'text-rose-500',
    bgClass: 'bg-rose-500/10',
  },
  ticket_status_changed: {
    icon: TicketIcon,
    iconClass: 'text-indigo-500',
    bgClass: 'bg-indigo-500/10',
  },
  status_incident: {
    icon: SignalIcon,
    iconClass: 'text-orange-500',
    bgClass: 'bg-orange-500/10',
  },
  conversation_assigned: {
    icon: InboxArrowDownIcon,
    iconClass: 'text-cyan-500',
    bgClass: 'bg-cyan-500/10',
  },
  ticket_assigned: {
    icon: TicketIcon,
    iconClass: 'text-violet-500',
    bgClass: 'bg-violet-500/10',
  },
  ticket_replied: {
    icon: TicketIcon,
    iconClass: 'text-sky-500',
    bgClass: 'bg-sky-500/10',
  },
  ticket_note_added: {
    icon: TicketIcon,
    iconClass: 'text-amber-500',
    bgClass: 'bg-amber-500/10',
  },
  // Email-only types (never rendered as bells today; entries satisfy the
  // exhaustive map and future-proof an in-app channel).
  ticket_created: {
    icon: TicketIcon,
    iconClass: 'text-emerald-500',
    bgClass: 'bg-emerald-500/10',
  },
  sla_warning: {
    icon: TicketIcon,
    iconClass: 'text-orange-500',
    bgClass: 'bg-orange-500/10',
  },
  sla_breach: {
    icon: TicketIcon,
    iconClass: 'text-red-500',
    bgClass: 'bg-red-500/10',
  },
  comment_mentioned: {
    icon: AtSymbolIcon,
    iconClass: 'text-fuchsia-500',
    bgClass: 'bg-fuchsia-500/10',
  },
  assistant_handed_off: {
    icon: SparklesIcon,
    iconClass: 'text-yellow-500',
    bgClass: 'bg-yellow-500/10',
  },
}

export const defaultNotificationTypeConfig: NotificationTypeConfig = {
  icon: BellIcon,
  iconClass: 'text-muted-foreground',
  bgClass: 'bg-muted',
}

export function getNotificationTypeConfig(type: string): NotificationTypeConfig {
  return notificationTypeConfigs[type as NotificationType] ?? defaultNotificationTypeConfig
}
