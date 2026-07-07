import {
  CheckCircleIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftRightIcon,
  NewspaperIcon,
  BellIcon,
  TicketIcon,
  AtSymbolIcon,
  SignalIcon,
} from '@heroicons/react/24/solid'
import type { NotificationType } from '@/lib/shared/types'

export interface NotificationTypeConfig {
  icon: typeof BellIcon
  iconClass: string
  bgClass: string
}

// Color-coding strategy: @ symbol marks mention types (amber for posts, rose for conversations);
// teal for support conversation; indigo separates ticket stage changes from blue post status changes.
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
}

export const defaultNotificationTypeConfig: NotificationTypeConfig = {
  icon: BellIcon,
  iconClass: 'text-muted-foreground',
  bgClass: 'bg-muted',
}

export function getNotificationTypeConfig(type: string): NotificationTypeConfig {
  return notificationTypeConfigs[type as NotificationType] ?? defaultNotificationTypeConfig
}
