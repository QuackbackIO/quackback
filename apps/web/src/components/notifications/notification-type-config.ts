import {
  CheckCircleIcon,
  ChatBubbleLeftEllipsisIcon,
  SparklesIcon,
  BellIcon,
} from '@heroicons/react/24/solid'
import type { NotificationType } from '@/lib/server/domains/notifications/notification.types'

export interface NotificationTypeConfig {
  icon: typeof BellIcon
  iconClass: string
  bgClass: string
}

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
    icon: SparklesIcon,
    iconClass: 'text-amber-500',
    bgClass: 'bg-amber-500/10',
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
