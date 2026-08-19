import { isToday, isYesterday } from 'date-fns'
import type { SerializedNotification } from '@/lib/client/hooks/use-notifications-queries'

export type NotificationDateGroupKey = 'today' | 'yesterday' | 'earlier'

export interface NotificationDateGroup {
  label: NotificationDateGroupKey
  notifications: SerializedNotification[]
}

/** Group notifications by time period for better scannability */
export function groupNotificationsByDate(
  notifications: SerializedNotification[]
): NotificationDateGroup[] {
  const groups: NotificationDateGroup[] = []
  const today: SerializedNotification[] = []
  const yesterday: SerializedNotification[] = []
  const earlier: SerializedNotification[] = []

  for (const notification of notifications) {
    const date = new Date(notification.createdAt)
    if (isToday(date)) {
      today.push(notification)
    } else if (isYesterday(date)) {
      yesterday.push(notification)
    } else {
      earlier.push(notification)
    }
  }

  if (today.length > 0) groups.push({ label: 'today', notifications: today })
  if (yesterday.length > 0) groups.push({ label: 'yesterday', notifications: yesterday })
  if (earlier.length > 0) groups.push({ label: 'earlier', notifications: earlier })

  return groups
}
