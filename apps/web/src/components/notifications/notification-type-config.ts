import {
  CheckCircleIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftRightIcon,
  SparklesIcon,
  NewspaperIcon,
  BellIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  UserPlusIcon,
  UserMinusIcon,
  ArrowPathIcon,
  ShareIcon,
  NoSymbolIcon,
} from '@heroicons/react/24/solid'
import type { NotificationType } from '@/lib/shared/types'

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
  changelog_published: {
    icon: NewspaperIcon,
    iconClass: 'text-green-500',
    bgClass: 'bg-green-500/10',
  },
  ticket_sla_warning: {
    icon: ClockIcon,
    iconClass: 'text-amber-500',
    bgClass: 'bg-amber-500/10',
  },
  ticket_sla_breach: {
    icon: ExclamationTriangleIcon,
    iconClass: 'text-red-500',
    bgClass: 'bg-red-500/10',
  },
  ticket_assigned: {
    icon: UserPlusIcon,
    iconClass: 'text-blue-500',
    bgClass: 'bg-blue-500/10',
  },
  ticket_unassigned: {
    icon: UserMinusIcon,
    iconClass: 'text-slate-500',
    bgClass: 'bg-slate-500/10',
  },
  ticket_thread_added: {
    icon: ChatBubbleLeftEllipsisIcon,
    iconClass: 'text-indigo-500',
    bgClass: 'bg-indigo-500/10',
  },
  ticket_status_changed: {
    icon: ArrowPathIcon,
    iconClass: 'text-emerald-500',
    bgClass: 'bg-emerald-500/10',
  },
  ticket_participant_added: {
    icon: UserPlusIcon,
    iconClass: 'text-cyan-500',
    bgClass: 'bg-cyan-500/10',
  },
  ticket_participant_removed: {
    icon: UserMinusIcon,
    iconClass: 'text-zinc-500',
    bgClass: 'bg-zinc-500/10',
  },
  ticket_shared: {
    icon: ShareIcon,
    iconClass: 'text-fuchsia-500',
    bgClass: 'bg-fuchsia-500/10',
  },
  ticket_unshared: {
    icon: NoSymbolIcon,
    iconClass: 'text-stone-500',
    bgClass: 'bg-stone-500/10',
  },
  chat_message: {
    icon: ChatBubbleLeftRightIcon,
    iconClass: 'text-teal-500',
    bgClass: 'bg-teal-500/10',
  },
  chat_mention: {
    icon: ChatBubbleLeftRightIcon,
    iconClass: 'text-teal-500',
    bgClass: 'bg-teal-500/10',
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
